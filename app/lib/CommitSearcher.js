const fs = require('graceful-fs');
const path = require('path');
const { VoyageEmbeddings } = require("@langchain/community/embeddings/voyage");
const { MemoryVectorStore } = require('langchain/vectorstores/memory');

class CommitSearcher {
  constructor(options = {}) {
    this.git = null;
    this.initialized = false;
    this.embeddingsModel = new VoyageEmbeddings({
      apiKey: 'pa-eNGJmpuqIX15Q0BFy2Ui-u26cuuxz0v8KfGiLGE3iXB',
      modelName: 'voyage-code-3',
      output_dimension: 256,
    }, {
      signal: chatController.abortController.signal,
      output_dimension: 256,
    });
  }

  async initialize() {
    if (this.initialized) return true;
    const projectPath = chatController.agent.projectController.currentProject.path;
    const gitPath = path.join(projectPath, '.git');

    if (!fs.existsSync(gitPath)) {
      console.error('Git repository not found in project path:', projectPath);
      return false;
    }

    try {
      const simpleGit = require('simple-git');
      this.git = simpleGit(projectPath);
      await this.git.version();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize simple-git:', error);
      return false;
    }
  }

  async search(query) {
    if (!this.git && !(await this.initialize())) {
      console.error('CommitSearcher not initialized or failed to initialize.');
      return null;
    }

    try {
      const rawLog = await this.git.raw([
        'log',
        '--pretty=format:%H %s',
        '--no-merges'
      ]);
      
      const commits = rawLog.split('\n').filter(line => line.trim().length > 0);
      
      if (commits.length === 0) {
        return null;
      }
      
      const documents = commits.map((commitLine, index) => {
        const firstSpaceIndex = commitLine.indexOf(' ');
        if (firstSpaceIndex === -1) {
          return null;
        }

        const hash = commitLine.substring(0, firstSpaceIndex);
        const message = commitLine.substring(firstSpaceIndex + 1);

        if (!message || message.trim().length === 0) {
          return null;
        }

        return {
          pageContent: message,
          metadata: { hash: hash }
        };
      }).filter(doc => doc !== null);

      if (documents.length === 0) {
        return null;
      }

      const vectorStore = new MemoryVectorStore(this.embeddingsModel);
      await vectorStore.addDocuments(documents);
      const results = await vectorStore.similaritySearchWithScore(query, 1);

      if (!results || results.length === 0) {
        return null;
      }

      const [topResult, score] = results[0];
      const commitHash = topResult.metadata.hash;
      const commitMessage = topResult.pageContent;
      const diff = await this.git.show([commitHash]);

      return {
        commitMessage: commitMessage,
        commitHash: commitHash,
        diff: diff
      };

    } catch (error) {
      console.error('Error searching commit messages:', error);
      if (error.message && (
          error.message.includes("does not have any commits yet") ||
          error.message.includes("unknown revision") ||
          error.message.includes("ambiguous argument 'HEAD'"))) {
        return null;
      }
      return null;
    }
  }
}

module.exports = CommitSearcher;
