const fs = require('graceful-fs');
const ProjectController = require('../project_controller');
const { toolDefinitions, previewMessageMapping, getCodeToReplace } = require('../tools/tools');
const { isFileExists, isFileEmpty, normalizedFilePath } = require('../utils');
const { applyChanges } = require('../tools/apply_changes');


const TOOL_CALL_FRIENDLY_NAMES = {
  'file_operation': 'file update',
  'search': 'search',
  'web_browser': 'web browser',
  'run_shell_command': 'terminal command'
}

class Agent {
  constructor(currentProject) {
    this.currentWorkingDir = os.homedir();
    this.projectState = {};
    this.projectController = new ProjectController(currentProject);
    this.userDecision = null;
    this.lastToolCall = null;
  }

  async runAgent(apiResponseMessage) {
    if (chatController.stopProcess || !apiResponseMessage) {
      return;
    }

    try {
      const toolCalls = apiResponseMessage.tool_calls;
      if (apiResponseMessage.content) {
        chatController.chat.addFrontendMessage('assistant', apiResponseMessage.content);
      }
      chatController.chat.addBackendMessage('assistant', apiResponseMessage.content, toolCalls);

      if (toolCalls && toolCalls.length > 0) {
        const { decision } = await this.runTools(toolCalls);
        this.userDecision = null;

        if (decision === 'approve') {
          await chatController.process('', false);
        }
      }
    } catch (error) {
      chatController.handleError(error);
    }
  }

  async runTools(toolCalls) {
    let isUserRejected = false;

    this.cacheApplyInParallel(toolCalls);

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const functionName = toolCall.function.name;

      const toolExists = toolDefinitions.some(tool => tool.name === functionName);
      if (!toolExists) {
        chatController.chat.addFrontendMessage('function', `Invalid tool call`);
        this.respontToToolCallWithMessage(
          `Tool call rejected. Tool ${functionName} does not exist.`,
          functionName, toolCall
        );
        continue;
      }

      if (functionName === 'file_operation') {
        const allowFileOperation = await this.allowFileOperation(toolCall);
        if (!allowFileOperation) {
          continue;
        }
      }

      await this.showToolCallPreview(toolCall);
      const decision = await this.waitForDecision(functionName, toolCall);
      this.lastToolCall = toolCall;

      if (decision === 'approve' || decision === 'approve_and_pause') {
        const functionCallResult = await this.callFunction(toolCall);
        if (functionCallResult) {
          chatController.chat.addBackendMessage('tool', functionCallResult, null, functionName, toolCall.id);
        } else {
          viewController.updateLoadingIndicator(false);
        }
        if (decision === 'approve_and_pause') {
          this.handleRemainingToolCalls(toolCalls.slice(i + 1), 'User paused tool calls');
          return { decision: 'approve_and_pause' };
        }
      } else if (decision === 'reject') {
        isUserRejected = true;
        chatController.chat.addFrontendMessage('function', 'Cancelled');
        chatController.chat.addFrontendMessage('info', 'Please provide feedback below how to improve and click send');
        this.handleRemainingToolCalls(toolCalls.slice(i), 'User rejected tool call');
        return { decision: 'reject' };
      }
    }
    return { decision: 'approve' };
  }

  cacheApplyInParallel(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) {
      return;
    }

    const fileOperationCalls = toolCalls.filter(
      toolCall => 
        toolCall.function.name === 'file_operation' && 
        this.parseArguments(toolCall.function.arguments).operation === 'update'
    );

    if (fileOperationCalls.length < 2) {
      return;
    }

    fileOperationCalls.slice(1).forEach(toolCall => {
      const args = this.parseArguments(toolCall.function.arguments);
      applyChanges(args);
    });
  }

  handleRemainingToolCalls(remainingTools, message) {
    for (const toolCall of remainingTools) {
      chatController.chat.addBackendMessage(
        'tool',
        message,
        null,
        toolCall.function.name,
        toolCall.id
      );
    }
  }

  async allowFileOperation(toolCall) {
    const args = this.parseArguments(toolCall.function.arguments);
    const operation = args.operation;

    if (operation === 'read') {
      return true;
    }
    
    const filePath = await normalizedFilePath(args.targetFile);
    const fileExists = await isFileExists(filePath);
    const fileIsEmpty = fileExists && (await isFileEmpty(filePath));
    const fileInChatContext = chatController.chat.chatContextBuilder.contextFiles.isEnabled(filePath);

    if (operation === 'update') {
      return this.shouldAllowFileUpdate(filePath, fileExists, fileInChatContext, toolCall);
    }

    if (operation === 'create') {
      return this.shouldAllowFileCreate(filePath, fileExists, fileIsEmpty, fileInChatContext, toolCall);
    }
    
    return false;
  }

  shouldAllowFileUpdate(filePath, fileExists, fileInChatContext, toolCall) {
    const toolName = toolCall.function.name;
    if (!fileExists) {
      this.respontToToolCallWithMessage(
        `Tool call rejected. File ${filePath} does not exist. Search for a correct file or create new one.`,
        toolName, toolCall
      );
      return false;
    }

    if (!fileInChatContext) {
      this.processFileNotInChatContext(toolName, toolCall, filePath);
      return false;
    }

    return true;
  }

  shouldAllowFileCreate(filePath, fileExists, fileIsEmpty, fileInChatContext, toolCall) {
    const toolName = toolCall.function.name;
    const content = this.parseArguments(toolCall.function.arguments).content;

    if (fileExists) {
      if (!fileInChatContext) {
        this.processFileNotInChatContext(toolName, toolCall, filePath);
        return false;
      }
      this.respontToToolCallWithMessage(
        `Tool call rejected. File ${filePath} already exists. Use update operation to update existing file if needed.`,
        toolName, toolCall
      );
      return false;
    }

    if (!content) {
      this.respontToToolCallWithMessage(
        'File content was not provided.',
        toolName, toolCall
      );
      return false;
    }

    return true;
  }

  processFileNotInChatContext(toolName, toolCall, filePath) {
    chatController.chat.addFrontendMessage(
      'function',
      `Read ${filePath}`
    );
    this.respontToToolCallWithMessage(
      `You tried to update file ${filePath} without knowing its content. Please try again now that file was read.`,
      toolName,
      toolCall
    );
    chatController.chat.chatContextBuilder.contextFiles.add(filePath, true);
  }

  respontToToolCallWithMessage(message, toolName, toolCall) {
    chatController.chat.addBackendMessage(
      'tool',
      message,
      null,
      toolName,
      toolCall.id
    );
  }

  async waitForDecision(functionName, toolCall) {
    if (
      this.isToolCallRepeated(toolCall) ||
      (chatController.settings.approvalRequired
        && toolDefinitions.find((tool) => tool.name === functionName).approvalRequired
        && !(functionName == 'file_operation' && toolCall.function.arguments.operation == 'read')
      )
    ) {
      return this.showApprovalButtons();
    } else {
      return Promise.resolve('approve');
    }
  }

  async showApprovalButtons() {
    this.userDecision = null;
    document.getElementById('messageInput').disabled = true;
    document.getElementById('approval_buttons').removeAttribute('hidden');
    document.getElementById('approve_button').focus();

    return new Promise((resolve) => {
      const checkDecision = setInterval(() => {
        if (this.userDecision !== null) {
          clearInterval(checkDecision);
          this.hideApprovalButtons();
          resolve(this.userDecision);
          this.userDecision = null;
        }
      }, 200);
    });
  }

  hideApprovalButtons() {
    document.getElementById('approval_buttons').setAttribute('hidden', true);
    document.getElementById('messageInput').disabled = false;
    document.getElementById('messageInput').focus();
  }

  isToolCallRepeated(toolCall) {
    if (!this.lastToolCall) return false;
    return JSON.stringify(toolCall) === JSON.stringify(this.lastToolCall);
  }

  async callFunction(toolCall) {
    viewController.updateLoadingIndicator(true);
    const functionName = toolCall.function.name;
    document.getElementById('messageInput').disabled = true;
    document.getElementById('messageInput').placeholder = `Waiting for ${TOOL_CALL_FRIENDLY_NAMES[functionName]} to finish... Click stop to interrupt`;
    
    const args = this.parseArguments(toolCall.function.arguments);
    let result = '';

    try {
      const tool = toolDefinitions.find((tool) => tool.name === functionName);
      if (tool) {
        await this.projectController.checkpoints.create(toolCall.id);
        result = await tool.executeFunction(args);
      } else {
        throw new Error(`Tool with name ${functionName} not found.`);
      }
    } catch (error) {
      console.error(error);
      chatController.chat.addFrontendMessage('error', `Error occurred. ${error.message}`);
      result = `Error: ${error.message}`;
    } finally {
      viewController.updateLoadingIndicator(false);
      document.getElementById('messageInput').disabled = false;
      document.getElementById('messageInput').placeholder = 'Send message...';
      return result;
    }
  }

  parseArguments(args) {
    if (typeof args === 'object' && args !== null) {
      return args;
    }

    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch (error) {
        console.warn('Failed to parse arguments:', error);
        return args; // Return original string if parsing fails
      }
    }

    console.warn('Unexpected argument type:', typeof args);
    return args; // Return original for any other type
  }

  async showToolCallPreview(toolCall) {
    const functionName = toolCall.function.name;
    const args = this.parseArguments(toolCall.function.arguments);
    const preview = await previewMessageMapping(functionName, args, toolCall.id);

    chatController.chat.addFrontendMessage('assistant', `${preview.message}\n${preview.code}`);
  }
}

module.exports = Agent;
