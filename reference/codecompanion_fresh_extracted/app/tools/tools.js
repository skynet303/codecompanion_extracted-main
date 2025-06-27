const path = require('path');
const fs = require('graceful-fs');
const GoogleSearch = require('./google_search');
const { contextualCompress } = require('./contextual_compressor');
const { normalizedFilePath, openFileLink, getTokenCount, isFileExists, readCodeFile } = require('../utils');
const { relativePath, getDirectoryFiles } = require('../lib/fileOperations');
const { generateDiff } = require('./code_diff');
const { applyChanges, clearCache } = require('./apply_changes');
const { researchItems } = require('../chat/planner/researchItems');
const ResearchAgent = require('../chat/planner/researchAgent');
const CommitSearcher = require('../lib/CommitSearcher');
const { grepSearch } = require('./grep_search');
const TerminalErrorMonitor = require('../lib/terminal-error-monitor');

let toolDefinitions = [
  {
    name: 'web_browser',
    description: `Opens URL or a local file in a web browser. Browser will provide text content or console output back to you. To check errors during development use console_output result type, to get documentation use webpage_text_content`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: `Use full URL, including protocol (e.g., http://, https://). For local files like index.html, use file:// protocol and absolute file path. Leave "url" empty to get results for currently opened url`,
        },
        result_type: {
          type: 'string',
          enum: ['webpage_text_content', 'console_output'],
          description:
            'Type of result you need back from the web browser. Use "webpage_text_content" to get text content of the webpage or documentation.',
          default: 'console_output',
        },
      },
    },
    executeFunction: browser,
    enabled: true,
    approvalRequired: false,
  },
  {
    name: 'file_operation',
    description: 'Perform file operations (create, read or update files)',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'read'],
          description: 'Type of file operation to perform',
        },
        targetFile: {
          type: 'string',
          description: 'File path',
        },
        content: {
          type: 'string',
          description: "For 'create' operation:\n - Provide the entire file content.\nFor 'update' operation:\n - Provide only the changed lines of code.\n - When providing changed line of code, DO NOT include unchanged code. Instead, for all unchanged code sections use comment like '// existing code' to indicate what code to keep.",
        },
        isEntireFileContentProvided: {
          type: 'boolean',
          description: 'Set to true when using update operation and providing entire file content.',
          default: false,
        },
      },
      required: ['operation', 'targetFile'],
    },
    executeFunction: fileOperation,
    enabled: true,
    approvalRequired: true,
  },
  {
    name: 'run_shell_command',
    description: 'Execute command in {shellType} shell. Use correct syntax for {shellType} shell. Example: "&&" is not supported in powershell.exe, use ";" instead.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run',
        },
        background: {
          type: 'boolean',
          description: 'Default is false. Set to true when webserver is required and need to be running in the background.',
          default: false,
        },
      },
    },
    executeFunction: shell,
    enabled: true,
    approvalRequired: true,
  },
  {
    name: 'research',
    description: 'Research necessary information',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'database_schema',
                  'search_filenames',
                  'search_codesnippets',
                  'google_search',
                  'list_files_in_directory',
                  'find_sample_code',
                  'find_testing_setup',
                  'find_ui_components',
                  'grep_search',
                  'find_code_changes'
                ]
              },
              query: {
                type: 'string',
                description: 'For "list_files_in_directory" use absolute path to the directory. For "grep_search" use format "pattern file_pattern" where pattern is regex to search for and file_pattern is glob pattern for files to search in. Examples: "TODO *.js" (search TODO in JS files), "function.*name **/*.ts" (regex in TypeScript files), "console.log" (search all files), "import.*react src/**/*.jsx" (imports in JSX files under src). For everything else provide a 3-10 word search query in natural language. Do not use search_codesnippets to get content of one file, instead use file_operation tool with operation set to "read"'
              }
            },
            required: ['type', 'query']
          },
          description: 'List of research items to execute',
        },
      },
      required: ['items'],
    },
    executeFunction: research,
    enabled: true,
    approvalRequired: false,
  },
  {
    name: 'think',
    description: 'Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed. For example, if you explore the repo and discover the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective. Alternatively, if you receive some test results, call this tool to brainstorm ways to fix the failing tests.',
    parameters: {
      type: 'object',
      properties: {
        thought: {
          type: 'string',
          description: 'Your thoughts.'
        }
      },
      required: ['thought'],
    },
    enabled: true,
    approvalRequired: true,
    executeFunction: think,
  },
];

// Create a singleton instance of the error monitor
const terminalErrorMonitor = new TerminalErrorMonitor();

function think({ thought }) {
  return 'User approves. Please continue with the task.';
}

async function previewMessageMapping(functionName, args, toolId) {
  let code = '';
  if (functionName === 'file_operation' && args.operation !== 'read') {
    const fileExists = await isFileExists(args.targetFile);
    const relativeFilePath = relativePath(args.targetFile);
    if (!fileExists) {
      code = `\n\`\`\` toolId="${toolId}" targetFile="${relativeFilePath}"\n${args.content}\n\`\`\``
    } else {
      const { codeDiff } = await applyChanges(args);
      code = `\n\`\`\`diff toolId="${toolId}" targetFile="${relativeFilePath}"\n${codeDiff}\n\`\`\``
    }
  }

  const mapping = {
    web_browser: {
      message: '',
      code: '',
    },
    file_operation: {
      message: '',
      code: code,
    },
    run_shell_command: {
      message: 'Executing:',
      code: `\n\n\`\`\`console toolId="${toolId}"\n${args.command}\n\`\`\``,
    },
    research: {
      message: `Researching...`,
      code: '',
    },
    think: {
      message: `Thoughts: \n\n ${args.thought}`,
      code: '',
    },
  };
  return mapping[functionName];
}

async function fileOperation({ operation, targetFile, content, isEntireFileContentProvided }) {
  switch (operation) {
    case 'create':
      return createFile({ targetFile, content });
    case 'update':
      return updateFile({ targetFile, content, isEntireFileContentProvided });
    case 'read':
      return readFile({ targetFile });
    default:
      return 'Invalid operation specified';
  }
}

async function createFile({ targetFile, content }) {
  if (!content) {
    return 'File content was not provided';
  }

  let codeDiff = '';

  if (!targetFile || !content) {
    return respondTargetFileNotProvided();
  }

  const filePath = await normalizedFilePath(targetFile);
  const fileLink = await openFileLink(filePath);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } else {
    return `File '${targetFile}' already exists. Use update operation to update existing file.`;
  }
  fs.writeFileSync(filePath, content);
  chatController.chat.addFrontendMessage('function', `${fileLink} created`);
  return `Wrote to file '${targetFile}' successfully\n${codeDiff}`;
}

async function updateFile({ targetFile, content, isEntireFileContentProvided }) {
  const filePath = await normalizedFilePath(targetFile);
  const { newContent, codeDiff } = await applyChanges({ targetFile, content, isEntireFileContentProvided });
  const fileLink = await openFileLink(filePath);
  fs.writeFileSync(filePath, newContent);
  clearCache(targetFile, content);
  chatController.chat.addFrontendMessage('function', `${fileLink} updated`);
  return `Updated file '${targetFile}' successfully`;
}

async function readFile({ targetFile }) {
  if (!targetFile) {
    return respondTargetFileNotProvided();
  }
  
  const fileContent = await readCodeFile(targetFile);
  if (fileContent && typeof fileContent === 'object' && fileContent.error) {
    const errorMessage = `Unable to read file '${targetFile}': ${fileContent.error}`;
    chatController.chat.addFrontendMessage('function', errorMessage);
    return errorMessage;
  }

  chatController.chat.addFrontendMessage('function', `Read ${await openFileLink(targetFile)} file`);
  return `File "${targetFile}" was read.`;
}

async function shell({ command, background }) {
  viewController.updateLoadingIndicator(true, 'Executing shell command ...  (click Stop to cancel)');
  let commandResult;
  let errorAnalysis = null;
  
  if (background === true) {
    chatController.terminalSession.executeShellCommand(command);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return 'Command started in the background';
  } else {
    commandResult = await chatController.terminalSession.executeShellCommand(command);
  }
  
  // Analyze the command output for errors
  errorAnalysis = terminalErrorMonitor.analyzeOutput(commandResult || '', command);
  
  // Preserve first 5 lines and last 95 lines if more than 100 lines
  const lines = commandResult.split('\n');
  if (lines.length > 100) {
    const firstFive = lines.slice(0, 5);
    const lastNinetyFive = lines.slice(-95);
    commandResult = [...firstFive, '(some command output omitted)...', ...lastNinetyFive].join('\n');
  }
  if (commandResult.length > 5000) {
    commandResult = commandResult.substring(commandResult.length - 5000);
    commandResult = `(some command output omitted)...\n${commandResult}`;
  }
  commandResult = commandResult.replace(command, '');
  
  // Format the result with error analysis
  let result = `Command executed: '${command}'\nOutput:\n'${
    commandResult ? commandResult : 'command executed successfully. Terminal command output was empty.'
  }'`;
  
  // Add error analysis report if errors were detected
  if (errorAnalysis.hasErrors || errorAnalysis.warnings.length > 0) {
    const errorReport = terminalErrorMonitor.getFormattedReport(errorAnalysis);
    if (errorReport) {
      result += '\n' + errorReport;
      
      // Add visual indicators in the frontend
      if (errorAnalysis.hasErrors) {
        chatController.chat.addFrontendMessage('function', 
          `<div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle-fill"></i> <strong>Command failed with errors!</strong>
            <br>${errorAnalysis.summary}
            ${errorAnalysis.suggestions.length > 0 ? 
              '<br><br><strong>Suggestions:</strong><ul>' + 
              errorAnalysis.suggestions.map(s => `<li>${s}</li>`).join('') + 
              '</ul>' : ''}
          </div>`
        );
      } else if (errorAnalysis.warnings.length > 0) {
        chatController.chat.addFrontendMessage('function',
          `<div class="alert alert-warning">
            <i class="bi bi-exclamation-circle"></i> Command completed with ${errorAnalysis.warnings.length} warning(s)
          </div>`
        );
      }
    }
  }
  
  viewController.updateLoadingIndicator(false);
  
  // If critical errors detected, also trigger error recovery
  if (errorAnalysis.errors.some(e => e.severity === 'critical')) {
    const errorRecovery = require('../lib/error-recovery');
    const recovery = new errorRecovery.ErrorRecovery();
    const shouldRetry = await recovery.handleError(
      new Error(errorAnalysis.summary),
      'shell_command',
      { command, errors: errorAnalysis.errors }
    );
    
    if (shouldRetry) {
      result += '\n\n⚠️ Critical error detected. Consider retrying with suggested fixes.';
    }
  }

  return result;
}

async function browser({ url, result_type = 'console_output' }) {
  let consoleOutput = '';
  viewController.updateLoadingIndicator(true, 'Waiting for the page to load...');
  if (url) {
    consoleOutput = (await chatController.browser.loadUrl(url)) || 'Page was loaded successfully';
  }
  chatController.chat.addFrontendMessage('function', `Opened in browser: <a href="${chatController.browser.currentUrl}">${chatController.browser.currentUrl}</a>`);
  if (result_type === 'webpage_text_content') {
    let pageContent = await chatController.browser.getReadablePageContent();
    if (getTokenCount(pageContent) > 2000) {
      let domain;
      try {
        domain = new URL(url).hostname;
      } catch (error) {
        domain = url;
      }
      let query;
      if (chatController.chat.task && chatController.chat.task.includes(domain)) {
        query = chatController.chat.task;
      } else {
        const lastMessageWithLink = chatController.chat.backendMessages.findLast((message) =>
          message.content.includes(domain)
        );
        query = lastMessageWithLink
          ? lastMessageWithLink.content
          : chatController.chat.backendMessages[chatController.chat.backendMessages.length - 1].content;
      }
      pageContent = await contextualCompress(query, pageContent);
    }
    if (pageContent) {
      pageContent = `\n<webpage_content>${pageContent}</webpage_content>`;
    }
    return `Browser opened URL: ${chatController.browser.currentUrl}.${pageContent}`;
  } else {
    return `Browser opened URL: ${chatController.browser.currentUrl}.\n<console_output>${consoleOutput}</console_output>`;
  }
}

async function searchCode({ query, count = 10, filenamesOnly = false }) {
  let frontendMessage = '';
  let backendMessage = '';
  let uniqueFiles = [];

  let results = await chatController.agent.projectController.searchEmbeddings({ query, count, filenamesOnly });
  console.log('results count', results.length);

  if (filenamesOnly) {
    return results.join('\n');
  }

  if (results && results.length > 0) {
    const files = results.map((result) => result.filePath);
    uniqueFiles = [...new Set(files)];
    // frontendMessage = `Checked ${uniqueFiles.length} files:<br>${await Promise.all(
    //   uniqueFiles.map(async (filePath) => await openFileLink(filePath))
    // ).then((fileLinks) => fileLinks.join('<br>'))}`;
    backendMessage = results.map((result) => result.fileContent).join('\n\n\n');
    backendMessage += `\n\n<search_results>${backendMessage}</search_results>\nif need to make changes to these files, first read files that need to be changed to get entire file content.`;
    // chatController.chat.addFrontendMessage('function', frontendMessage);
    return backendMessage;
  }

  const noResultsMessage = `No results found`;
  chatController.chat.addFrontendMessage('function', noResultsMessage);
  return noResultsMessage;
}

async function googleSearch({ query }) {
  const searchAPI = new GoogleSearch();
  // Get up to 100 search results for maximum coverage
  const googleSearchResults = await searchAPI.searchWithPagination(query, 100);
  let checkedUrls = [];
  let bestResults = [];

  viewController.updateLoadingIndicator(true, `Found ${googleSearchResults.length} search results, analyzing...`);

  const addFrontendMessage = (checkedUrls) => {
    chatController.chat.addFrontendMessage(
      'function',
      `Searched ${googleSearchResults.length} results, checked ${checkedUrls.length} websites:<br>${checkedUrls
        .slice(0, 10)
        .map((url) => `<a href="${url}" class="text-truncate ms-2">${url}</a>`)
        .join('<br>')}${checkedUrls.length > 10 ? `<br>... and ${checkedUrls.length - 10} more` : ''}`
    );
  };

  // Process results in batches for efficiency
  const batchSize = 10;
  for (let i = 0; i < Math.min(googleSearchResults.length, 30); i += batchSize) {
    const batch = googleSearchResults.slice(i, i + batchSize);
    const batchPromises = batch.map(async (result) => {
      try {
        const urlResult = await searchURL({ query, url: result.link, sendResultsToFrontend: false });
        const compressedResult = JSON.parse(urlResult);
        checkedUrls.push(result.link);
        
        if (await checkIfAnswersQuery(query, compressedResult)) {
          bestResults.push({ ...compressedResult, url: result.link, relevancy: result.relevancy_score });
        }
        
        return compressedResult;
      } catch (error) {
        console.error(`Error checking ${result.link}:`, error.message);
        return null;
      }
    });
    
    await Promise.all(batchPromises);
    
    // If we have enough good results, stop early
    if (bestResults.length >= 5) {
      break;
    }
  }

  viewController.updateLoadingIndicator(false);
  addFrontendMessage(checkedUrls);

  // Return the best results or fall back to first available
  if (bestResults.length > 0) {
    // Sort by relevancy and return top results
    bestResults.sort((a, b) => (b.relevancy || 0) - (a.relevancy || 0));
    return JSON.stringify({
      results: bestResults.slice(0, 5),
      totalSearched: googleSearchResults.length,
      totalChecked: checkedUrls.length
    });
  }

  // If no result meets the condition, return the first few results
  if (googleSearchResults.length > 0) {
    const fallbackResults = [];
    for (let i = 0; i < Math.min(3, googleSearchResults.length); i++) {
      try {
        const urlResult = await searchURL({ query, url: googleSearchResults[i].link, sendResultsToFrontend: false });
        fallbackResults.push(JSON.parse(urlResult));
      } catch (error) {
        console.error(`Error with fallback ${i}:`, error.message);
      }
    }
    
    if (fallbackResults.length > 0) {
      return JSON.stringify({
        results: fallbackResults,
        totalSearched: googleSearchResults.length,
        totalChecked: checkedUrls.length
      });
    }
  }

  return JSON.stringify({ error: 'No results found' });
}

async function listFilesInDirectory({ directory }) {
  const normalizedDirectory = path.normalize(directory);
  const projectPath = chatController.agent.projectController.currentProject.path;
  const absolutePath = path.isAbsolute(normalizedDirectory) ? normalizedDirectory : path.join(projectPath, normalizedDirectory);
  
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    return `Directory "${directory}" does not exist`;
  }

  const maxResults = 100;
  const files = await getDirectoryFiles(absolutePath, null, maxResults);
  
  if (files?.length === 0) {
    return `No files found in directory "${directory}"`;
  }
  
  if (files.length >= maxResults) {
    return `Files in directory "${directory}" (showing first ${maxResults} files, directory contains more files - be more specific):\n${files.join('\n')}`;
  }
  
  return `Files in directory "${directory}":\n${files.join('\n')}`;
}

async function searchURL({ query, url, sendResultsToFrontend = false }) {
  await chatController.browser.loadUrl(url);
  const content = await chatController.browser.getReadablePageContent();
  if (!content) {
    if (sendResultsToFrontend) {
      chatController.chat.addFrontendMessage('function', `Could not fetch content from ${url}`);
    }
    return 'Could not fetch content from the URL';
  }
  const compressedResult = await contextualCompress(query, content);
  if (sendResultsToFrontend) {
    chatController.chat.addFrontendMessage('function', `Checked URL: ${url}`);
  }
  return JSON.stringify(compressedResult);
}

async function checkIfAnswersQuery(query, searchResult) {
  const format = {
    type: 'boolean',
    result: 'true or false',
  };
  const prompt = `
I am searching the web for this query: '${query}'
The search result is:

${JSON.stringify(searchResult)}

Does this result answer the search query question?
Respond with a boolean value: "true" or "false"`;
  const result = await chatController.backgroundTask.run({ prompt, format });

  return result !== false;
}

async function unifiedSearch({ search_type, query, url }) {
  switch (search_type) {
    case 'codebase':
      const codebaseResult = await searchCode({ query });
      return `Codebase search result for "${query}":\n${codebaseResult}`;
    case 'google':
      const result = await googleSearch({ query });
      return `Google search result for "${query}":\n${result}`;
    case 'webpage':
      const urlResult = await searchURL({ query, url });
      return `URL search result for "${query}":\n${urlResult}`;
    default:
      return 'Invalid search type specified.';
  }
}

async function research({ items }) {
  console.log('research', items);
  const promises = items.map(async (item) => {
    let result;
    switch (item.type) {
      case 'search_filenames':
        result = await searchCode({ query: item.query, filenamesOnly: true });
        break;
      case 'search_codesnippets':
        result = await searchCode({ query: item.query });
        break;
      case 'google_search':
        result = await unifiedSearch({ search_type: 'google', query: item.query });
        break;
      case 'list_files_in_directory':
        result = await listFilesInDirectory({ directory: item.query });
        break;
      case 'grep_search':
        const projectPath = chatController.agent.projectController.currentProject.path;
        result = await grepSearch(item.query, projectPath);
        break;
      case 'find_code_changes':
        const commitSearcher = new CommitSearcher();
        const searchResult = await commitSearcher.search(item.query);
        if (searchResult) {
          result = `Found similar changes in commit ${searchResult.commitHash}:\nMessage: ${searchResult.commitMessage}\n\nDiff:\n\`\`\`diff\n${searchResult.diff}\n\`\`\``;
        } else {
          result = `No similar changes found for query: "${item.query}"`;
        }
        break;
      default:
        result = await researchAgent(item);
    }
    return {
      type: item.type,
      result
    };
  });

  const results = await Promise.all(promises);
  return JSON.stringify(results, null, 2);
}

async function researchAgent(item) {
  const agent = new ResearchAgent(chatController, item.query);
  const researchItem = researchItems.find((researchItem) => researchItem.name === item.type);
  return await agent.executeResearch(researchItem);
}

function respondTargetFileNotProvided() {
  chatController.chat.addFrontendMessage('function', 'File name or file content was not provided.');

  return 'Please provide a target file name in a correct format.';
}

function getEnabledTools(filterFn) {
  const shellType = chatController.terminalSession.shellType;

  return toolDefinitions.filter(filterFn).map(({ name, description, parameters }) => ({
    name,
    description: description.replace('{shellType}', shellType),
    parameters,
  }));
}

function allEnabledTools() {
  return getEnabledTools((tool) => tool.enabled);
}

function allEnabledExcept(toolNames) {
  return allEnabledTools().filter((tool) => !toolNames.includes(tool.name));
}

module.exports = {
  allEnabledTools,
  allEnabledExcept,
  toolDefinitions,
  respondTargetFileNotProvided,
  previewMessageMapping,
};