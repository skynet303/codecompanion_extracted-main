const fs = require('graceful-fs');
const { normalizedFilePath } = require('../../utils');
const CoEditedFilesFinder = require('../../lib/CoEditedFiles');
const MAX_FILE_SIZE = 50 * 1024; // 50 KB

const toolDefinitions = [
  {
    name: 'read_files',
    description: 'Read files.',
    parameters: {
      type: 'object',
      properties: {
        filePaths: {
          type: 'array',
          items: {
            type: 'string',
            description: 'Path to the files to be read.',
          },
        },
      },
      required: ['filePaths'],
    },
    executeFunction: readFiles,
  },
  {
    name: 'search_codebase',
    description: 'Semantic search that can perform codebase search',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `Long, descriptive natural language search query`,
        },
        filenamesOnly: {
          type: 'boolean',
          description: 'If true, only return the filenames of the results, otherwise return relevant code snippets',
        },
      },
      required: ['query'],
    },
    executeFunction: searchCode,
  },
  {
    name: 'output',
    description: 'Output the result of the task',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

async function readFiles({ filePaths }) {
  if (typeof filePaths === 'string') {
    try {
      const normalizedString = filePaths.replace(/\\\\/g, '/').replace(/\\/g, '/');
      filePaths = JSON.parse(normalizedString);
    } catch (error) {
      console.error(`Error parsing string filePaths: ${filePaths}`);
    }
  }

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    console.error(`Invalid filePaths: ${filePaths}`);
    return '';
  }

  const fileContents = await Promise.all(
    filePaths.map(async (targetFile) => {
      try {
        const filePath = await normalizedFilePath(targetFile);
        
        if (!fs.existsSync(filePath)) {
          return `File with filepath '${targetFile}' does not exist`;
        }
        
        const stats = fs.statSync(filePath);

        if (stats.size > MAX_FILE_SIZE) {
          return `File '${targetFile}' is too large to read`;
        }

        if (stats.isDirectory()) {
          return `'${targetFile}' is a directory, not a file`;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        return `<filecontent filename="${filePath}">\n${content}\n</filecontent>`;
      } catch (error) {
        if (error.code === 'ENOENT') {
          return `File with filepath '${targetFile}' does not exist`;
        }
        return `Error reading '${targetFile}': ${error.message}`;
      }
    })
  );

  let result = fileContents.join('\n');
  if (fileContents.length > 0) {
    const coEditedFilesFinder = new CoEditedFilesFinder();
    const coEditedFiles = await coEditedFilesFinder.findCoEditedFiles(filePaths);
    if (coEditedFiles.length > 0) {
      result += '\n\nThese files are very related and often updated together, consider including them in the task:\n' + coEditedFiles.join('\n');
    }
  }

  return result;
}

async function searchCode({ query, filenamesOnly = false }) {
  const count = filenamesOnly ? 30 : 10;

  let results = await chatController.agent.projectController.searchEmbeddings({ query, count, filenamesOnly });
  if (results && results.length > 0) {
    if (filenamesOnly) {
      return [...new Set(results.map((result) => result.filePath))].join('\n');
    }
    return results.map((result) => result.fileContent).join('\n\n');
  }

  return `No results found`;
}

function tools(outputFormat) {
  return toolDefinitions.map((tool) => {
    if (tool.name === 'output') {
      return {
        ...tool,
        parameters: {
          type: 'object',
          properties: outputFormat,
          required: Object.keys(outputFormat),
        },
      };
    }
    return tool;
  });
}

module.exports = {
  toolDefinitions,
  tools,
};