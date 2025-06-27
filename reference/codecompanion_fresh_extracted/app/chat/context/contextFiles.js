const fs = require('graceful-fs');
const CoEditedFilesFinder = require('../../lib/CoEditedFiles');
const { isFileExists, normalizedFilePath, getTokenCount, readCodeFile } = require('../../utils');

const MESSAGE_COUNT_BETWEEN_SUMMARIZATIONS = 24;
const MIN_FILES = 5;

class ContextFiles {
  constructor() {
    this.files = {};
    this.lastMessageIdForRelevantFiles = 0;
    this.lastEditedFilesTimestamp = Date.now();
    this.reduceRelevantFilesContextMessageId = 0;
    this.coEditedFilesFinder = new CoEditedFilesFinder();
  }

  async add(fileNames, enabled = true) {
    if (!Array.isArray(fileNames)) {
      fileNames = [fileNames];
    }

    const normalizedFilePaths = await this.normalizeAndCheckExistence(fileNames);
    normalizedFilePaths?.forEach((fileName) => {
      this.files[fileName] = enabled;
    });

    if (fileNames.length === 1 && normalizedFilePaths.length > 0 && (Object.keys(this.files).length < 10)) {
      await this.getCoEditedFiles(normalizedFilePaths[0]);
    }
    chatController.taskTab.renderContextFiles();
  }

  async normalizeAndCheckExistence(fileNames) {
    const normalizedFilePaths = await Promise.all(fileNames.map((file) => normalizedFilePath(file)));
    
    const existenceChecks = await Promise.all(
      normalizedFilePaths.map(async (fileName) => {
        const fileExists = await isFileExists(fileName);
        return fileExists ? fileName : null;
      })
    );

    return existenceChecks.filter(fileName => fileName !== null);
  }

  async disableAll() {
    await this.add(Object.keys(this.files), false);
  }

  async getEnabled() {
    await this.removeNonExistent();
    const result = {};
    Object.entries(this.files).forEach(([fileName, enabled]) => {
      if (enabled) {
        result[fileName] = true;
      }
    });
    return Object.keys(result);
  }

  async getDisabled() {
    await this.removeNonExistent();
    return Object.keys(this.files).filter(file => !this.files[file]);
  }

  async getAll() {
    await this.removeNonExistent();
    return this.files;
  }

  isEnabled(fileName) {
    return this.files[fileName] || false;
  }

  async updateFromChat(messageHistory) {
    await this.removeNonExistent();
    const chatInteractionFiles = await this.getChatInteractionFiles();
    
    // Add tracking of edited files
    const editedFiles = await chatController.agent.projectController.getRecentModifiedFiles(this.lastEditedFilesTimestamp);
    this.lastEditedFilesTimestamp = Date.now();

    // Add chat interaction files
    await this.add(chatInteractionFiles, true);

    // Handle edited files
    if (editedFiles && editedFiles.length > 0) {
      const newEditedFiles = editedFiles.filter(file => !this.isEnabled(file));
      if (newEditedFiles.length > 0) {
        const relevantNewEditedFiles = await this.selectImportantFiles(messageHistory, newEditedFiles.join('\n'));
        await this.add(relevantNewEditedFiles, true);
      }
    }

    const orderedFiles = await this.reorderMostRecentLast(chatInteractionFiles);
    this.files = Object.fromEntries([
      ...Object.entries(this.files).filter(([file]) => !orderedFiles.includes(file)),
      ...orderedFiles.map(file => [file, this.files[file] || false])
    ]);

    // Re-render the task tab
    chatController.taskTab.renderContextFiles();

    return orderedFiles;
  }

  async getChatInteractionFiles(excludeProcessedFiles = true) {
    let chatMessagesWithFiles = chatController.chat.backendMessages.filter(
      (message) => message.role === 'assistant' && message.tool_calls
    );

    // Optionally filter out already processed messages
    if (excludeProcessedFiles) {
      chatMessagesWithFiles = chatMessagesWithFiles.filter(
        (message) => message.id > this.lastMessageIdForRelevantFiles
      );
      this.lastMessageIdForRelevantFiles =
        chatController.chat.backendMessages?.length > 0 
          ? chatController.chat.backendMessages[chatController.chat.backendMessages.length - 1].id 
          : 0;
    }

    // Extract file names from tool calls
    const chatFiles = chatMessagesWithFiles.flatMap((message) =>
      message.tool_calls
        .map((toolCall) => {
          const parsedArguments = chatController.agent.parseArguments(toolCall.function.arguments);
          return parsedArguments.hasOwnProperty('targetFile') ? parsedArguments.targetFile : null;
        })
        .filter(Boolean)
    );

    // Normalize file paths
    const normalizedFilePaths = await Promise.all(chatFiles.map((file) => normalizedFilePath(file)));
    return normalizedFilePaths;
  }

  async removeNonExistent() {
    const filesToCheck = Object.keys(this.files);
    const existenceChecks = await Promise.all(
      filesToCheck.map(async (fileName) => {
        const fileExists = await isFileExists(fileName);
        return { fileName, exists: fileExists };
      })
    );

    existenceChecks.forEach(({ fileName, exists }) => {
      if (!exists) {
        delete this.files[fileName];
      }
    });
  }

  async reorderMostRecentLast(recentlyAccessedFiles) {
    // To improve LLM ability to edit files, keep most relevant files at the bottom
    const enabledFiles = await this.getEnabled();
    const orderedEnabledFiles = recentlyAccessedFiles.filter((file) => enabledFiles.includes(file));
    const remainingEnabledFiles = enabledFiles.filter((file) => !recentlyAccessedFiles.includes(file));
    const reorderedFiles = [...remainingEnabledFiles, ...orderedEnabledFiles];

    // Remove duplicate entries, keeping the last occurrence of each file
    const uniqueFiles = reorderedFiles.reduce((acc, file) => {
      // Remove any previous occurrence of this file
      const index = acc.indexOf(file);
      if (index !== -1) {
        acc.splice(index, 1);
      }
      // Add the file to the end of the array
      acc.push(file);
      return acc;
    }, []);

    return uniqueFiles;
  }

  async getFileContents(fileList, messageHistory) {
    if (fileList.length === 0) {
      return '';
    }

    let fileContents = await this.readFiles(fileList);
    fileContents = await this.reduceRelevantFilesContext(fileContents, fileList, messageHistory);
    return fileContents;
  }

  async readFiles(fileList) {
    const fileReadPromises = fileList.map((file) => readCodeFile(file));
    const fileContents = await Promise.all(fileReadPromises);
    const result = fileList
      .map((file, index) => {
        if (fileContents[index] && typeof fileContents[index] === 'object' && fileContents[index].error) {
          return `\n<file_content file="${file}" error="${fileContents[index].error}">\n`;
        }
        return `\n<file_content file="${file}">\n${fileContents[index]}\n</file_content>`;
      }).join('\n\n');

    return result;
  }

  async reduceRelevantFilesContext(fileContents, fileList, messageHistory) {
    const tokenCount = getTokenCount(fileContents);
    const lastMessageId = chatController.chat.backendMessages[chatController.chat.backendMessages.length - 1]?.id || 0;

    if (
      tokenCount > chatController.settings.maxTaskContextFilesTokens &&
      fileList.length > MIN_FILES &&
      (lastMessageId - this.reduceRelevantFilesContextMessageId >= MESSAGE_COUNT_BETWEEN_SUMMARIZATIONS)
    ) {
      this.reduceRelevantFilesContextMessageId = lastMessageId;
      const mostImportantFiles = this.removeFilesToMeetTokenLimit();
      await this.disableAll();
      await this.add(mostImportantFiles, true);
      fileContents = await this.readFiles(mostImportantFiles);
    }

    return fileContents;
  }

  removeFilesToMeetTokenLimit() {
    let totalTokens = 0;
    const files = Object.keys(this.files);
    const keptFiles = files.slice(-MIN_FILES);

    for (const file of keptFiles) {
      try {
        if (fs.existsSync(file)) {
          const fileContent = fs.readFileSync(file, 'utf8');
          totalTokens += getTokenCount(fileContent);
        }
      } catch (error) {
        console.warn(`Error reading file for token calculation: ${file}`, error.message);
      }
    }

    for (let i = files.length - MIN_FILES - 1; i >= 0; i--) {
      const file = files[i];
      try {
        if (fs.existsSync(file)) {
          const fileContent = fs.readFileSync(file, 'utf8');
          const fileTokens = getTokenCount(fileContent);

          if (totalTokens + fileTokens <= chatController.settings.maxTaskContextFilesTokens) {
            keptFiles.unshift(file);
            totalTokens += fileTokens;
          } else {
            break;
          }
        }
      } catch (error) {
        console.warn(`Error reading file for token calculation: ${file}`, error.message);
      }
    }

    return keptFiles;
  }

  async filesContents(messageHistory) {
    const enabledFiles = await this.getEnabled();
    if (enabledFiles.length === 0) {
      return '';
    }

    let fileContents = await this.getFileContents(enabledFiles, messageHistory);
    const disabledFiles = await this.getDisabled();

    let result = '';
    if (disabledFiles.length > 0) {
      result += `\n
List of existing files that might be helpful (read them if needed):
<potentially_relevant_files>
${disabledFiles.join('\n')}
</potentially_relevant_files>\n`;
    }

    if (fileContents) {
      result += `\nCurrent content of the files (do not read files listed below and trust the content as the most current since it could have been modified outside of chat):\n<current_files_contents>\n${fileContents}\n</current_files_contents>`;
    }

    return result;
  }


  async getCoEditedFiles(toFile) {
    if (!toFile) return;

    const coEditedFiles = await this.coEditedFilesFinder.findCoEditedFiles([toFile]);
    let filteredCoEditedFiles = await this.normalizeAndCheckExistence(coEditedFiles);
    filteredCoEditedFiles = filteredCoEditedFiles.filter(file => !Object.keys(this.files).includes(file))
    if (filteredCoEditedFiles.length > 0) {
      if (filteredCoEditedFiles.length > 0) {
        filteredCoEditedFiles = filteredCoEditedFiles.slice(0, 3);
        this.files = { ...Object.fromEntries(filteredCoEditedFiles.map(file => [file, false])), ...this.files };
      }
    }
    return filteredCoEditedFiles;
  }


  async selectImportantFiles(messageHistory, fileContents) {
    const filteredHistory = messageHistory.filter(message => message.role !== 'system');
    const prompt = `
AI coding assistant is helping user with a task.
Here is a summary of the conversation and what was done:
<message_history>
${JSON.stringify(filteredHistory, null, 2)}
</message_history>

<list_of_edited_files>
${fileContents}
</list_of_edited_files>

Striclty from <list_of_edited_files> return only the files that are most relevant and important for the current task.
Exclude files that are not directly related or needed.

To determine which files to include, use this reasoning:
1. Files that were most recently accessed or mentioned in the conversation (check bottom of message_history)
2. Files that contain code or content directly related to what's being discussed/modified
3. Files that provide important context or dependencies for the current task
4. Source code files that contain functionality needed for the task
5. Configuration files only if they need to be modified for the task

Important:
- Only return files that are truly relevant and important for the current task from <list_of_edited_files>
- Return files in priority order (most important first)
- Do not modify, shorten or change file paths in any way
- Keep exact file paths as provided
- Exclude files that are only tangentially related or not needed
`;

    const format = {
      type: 'array', 
      description: 'Array of ALL file paths, ordered by priority (most relevant first)',
      items: {
        type: 'string',
      },
    };

    return await chatController.backgroundTask.run({
      prompt,
      format,
      model: chatController.settings.selectedModel,
    });
  }
}

module.exports = ContextFiles;