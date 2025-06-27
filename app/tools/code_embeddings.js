const fs = require('graceful-fs');
const pathModule = require('path');
const JSONStream = require('JSONStream');
const { app } = require('@electron/remote');
const CryptoJS = require('crypto-js');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { VoyageEmbeddings } = require("@langchain/community/embeddings/voyage");
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const detect = require('language-detect');
const { normalizedFilePath } = require('../utils');
const VoyageAIReranker = require('../models/voyageRerank');
const { isTextFile } = require('../utils');
const { relativePath } = require('../lib/fileOperations');
const { EMBEDDINGS_VERSION } = require('../static/models_config');

const detectedLanguageToSplitterMapping = {
  'C++': 'cpp',
  Go: 'go',
  Java: 'java',
  JavaScript: 'js',
  PHP: 'php',
  'Protocol Buffers': 'proto',
  Python: 'python',
  reStructuredText: 'rst',
  Ruby: 'ruby',
  Rust: 'rust',
  Scala: 'scala',
  Swift: 'swift',
  Markdown: 'markdown',
  LaTeX: 'latex',
  HTML: 'html',
  Solidity: 'sol',
};

const MAX_FILE_SIZE = 100000;

class CodeEmbeddings {
  constructor(projectName, projectController) {
    this.projectController = projectController;
    const config = {
      apiKey: 'pa-eNGJmpuqIX15Q0BFy2Ui-u26cuuxz0v8KfGiLGE3iXB',
      modelName: 'voyage-code-3',
      outputDimension: 256,
    };
    this.projectName = projectName;
    this.vectorStore = new MemoryVectorStore(new VoyageEmbeddings(config, {
      signal: chatController.abortController.signal,
      outputDimension: 256,
    }));
    const projectDir = pathModule.join(app.getPath('userData'), "projects", projectName);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    this.embeddingsPath = pathModule.join(projectDir, 'vector_embeddings.json');
    this.reranker = new VoyageAIReranker();
  }

  async splitCodeIntoChunks(metadata, fileContent, language) {
    let splitter;
    if (!language || language === 'other') {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 0,
        keepSeparator: true,
      });
    } else {
      splitter = RecursiveCharacterTextSplitter.fromLanguage(language, {
        chunkSize: 1000,
        chunkOverlap: 0,
        keepSeparator: true,
      });
    }
    const documents = await splitter.createDocuments([fileContent], [metadata], {
      chunkHeader: `File name: ${metadata.filePath}\n---\n\n`,
      appendChunkOverlapHeader: true,
    });
    return documents;
  }

  async updateEmbeddingsForFiles(filesList) {
    if (filesList.length === 0) {
      this.save();
      return;
    }

    const filesNeedingReembedding = (
      await Promise.all(
        filesList.map(async (filePath) => {
          return (await this.needsReembedding(filePath)) ? filePath : null;
        })
      )
    ).filter((filePath) => filePath !== null);

    const totalFiles = filesNeedingReembedding.length;

    viewController.updateLoadingIndicator(true, `Indexing ${totalFiles} files with vector embeddings...`);
    let processedFiles = 0;
    const updatePromises = filesNeedingReembedding.map((file) => {
      return (async () => {
        const baseName = pathModule.basename(file);
        await this.updateEmbedding(file);
        processedFiles++;
        viewController.updateLoadingIndicator(
          true,
          `Indexing files: ${processedFiles}/${totalFiles} completed. (${baseName})`
        );
      })();
    });
    await Promise.allSettled(updatePromises);
    this.save();
    viewController.updateLoadingIndicator(false);
  }

  async needsReembedding(filePath) {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    const stats = await fs.promises.stat(filePath);

    if (!isTextFile(filePath) || stats.size > MAX_FILE_SIZE) {
      return false;
    }

    const fileRecords = this.findRecords(filePath);
    if (fileRecords.length === 0) return true;
    const hash = CryptoJS.SHA256(fileContent).toString() + EMBEDDINGS_VERSION;
    return fileRecords[0].metadata.hash !== hash;
  }

  async updateEmbedding(filePath) {
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');

    if (!isTextFile(filePath)) {
      return;
    }

    const hash = CryptoJS.SHA256(fileContent).toString() + EMBEDDINGS_VERSION;
    this.deleteRecords(filePath);

    const metadata = {
      filePath,
      hash,
    };

    let language;
    try {
      language = detect.sync(filePath);
    } catch (error) {
      // ignore
    }

    const mappedLanguage = detectedLanguageToSplitterMapping[language] || 'other';
    const documents = await this.splitCodeIntoChunks(metadata, fileContent, mappedLanguage);
    if (documents && documents.length > 0) {
      await this.vectorStore.addDocuments(documents);
    }
  }

  async deleteEmbeddingsForFilesThatNoLongerExist() {
    if (!this.vectorStore.memoryVectors) return;

    const existenceChecks = this.vectorStore.memoryVectors.map(async (record) => {
      try {
        const filePath = record.metadata.filePath;
        const projectPath = this.projectController.currentProject.path;
        
        if (!filePath.startsWith(projectPath)) {
          return { record, exists: false };
        }
        
        const exists = await fs.promises.access(filePath)
          .then(() => true)
          .catch(() => false);
        return { record, exists };
      } catch (error) {
        return { record, exists: false };
      }
    });

    const results = await Promise.all(existenceChecks);
    this.vectorStore.memoryVectors = results
      .filter(result => result.exists)
      .map(result => result.record);
  }

  findRecords(filePath) {
    if (!this.vectorStore.memoryVectors) return [];

    return this.vectorStore.memoryVectors.filter((record) => record.metadata.filePath === filePath);
  }

  deleteRecords(filePath) {
    if (!this.vectorStore.memoryVectors) return;

    this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.filter(
      (record) => record.metadata.filePath !== filePath
    );
  }

  async search({ query, limit = 50, rerank = true, filenamesOnly = false }) {
    const results = await this.vectorStore.similaritySearchWithScore(query, 50);
    if (!results) return [];

    if (filenamesOnly) {
      const filePaths = results.map((result) => {
        const [record, _score] = result;
        return relativePath(record.metadata.filePath);
      });
      const filenames = await Promise.all(filePaths).then((paths) => [...new Set(paths)]);
      if (rerank) {
        let rerankedFilenames = await this.reranker.rerank(query, filenames);
        if (!rerankedFilenames || rerankedFilenames.length === 0) {
          return [];
        }
        rerankedFilenames = rerankedFilenames.slice(0, limit);
        return rerankedFilenames;
      }
      return filenames.slice(0, limit);
    }

    const filteredResults = results.filter((result) => {
      const [record, score] = result;
      return record.pageContent.length > 5;
    });

    const formattedResults = await Promise.all(
      filteredResults.map(async (result) => {
        const [record, _score] = result;
        return {
          filePath: await normalizedFilePath(record.metadata.filePath),
          fileContent: record.pageContent,
          lines: record.metadata.loc.lines,
        };
      })
    );

    if (!rerank) {
      return formattedResults.slice(0, limit);
    }
    const documents = formattedResults.map((result) => result.fileContent);
    const rerankedIndexes = await this.reranker.rerank(query, documents, true);
    return rerankedIndexes.map(index => formattedResults[index]).slice(0, limit);
  }

  async save() {
    try {
      const writeStream = fs.createWriteStream(this.embeddingsPath);
      const stringifier = JSONStream.stringify('[', ',', ']');
      stringifier.pipe(writeStream);

      for (const vector of this.vectorStore.memoryVectors) {
        stringifier.write(vector);
      }
      stringifier.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (error) {
      console.error('Error saving embeddings:', error);
    }
  }

  async load() {
    if (fs.existsSync(this.embeddingsPath)) {
      try {
        const parser = JSONStream.parse('*');
        const readStream = fs.createReadStream(this.embeddingsPath);

        this.vectorStore.memoryVectors = [];

        await new Promise((resolve, reject) => {
          readStream
            .pipe(parser)
            .on('data', (data) => {
              this.vectorStore.memoryVectors.push(data);
            })
            .on('error', reject)
            .on('end', resolve);
        });
      } catch (error) {
        console.error('Error loading embeddings:', error);
        this.vectorStore.memoryVectors = [];
      }
    } else {
      this.vectorStore.memoryVectors = [];
    }
    await this.deleteEmbeddingsForFilesThatNoLongerExist();
  }

  delete() {
    if (fs.existsSync(this.embeddingsPath)) {
      fs.unlinkSync(this.embeddingsPath);
    }
  }
}

module.exports = CodeEmbeddings;
