const { getTokenCount, fromTemplate } = require('../../utils');

const { TASK_EXECUTION_PROMPT_TEMPLATE } = require('../../static/prompts');
const { getSystemInfo, isTextFile, getCountryFromLocale} = require('../../utils');
const ContextFiles = require('./contextFiles');
const ContextReducer = require('./contextReducer');

class ContextBuilder {
  constructor(chat) {
    this.chat = chat;
    this.contextFiles = new ContextFiles();
    this.contextReducer = new ContextReducer(this.chat.backendMessages);
  }

  async build(userMessage) {
    this.messages = [];
    this.backendMessages = this.chat.backendMessages;
    this.addSystemMessage();
    this.addTaskMessage(userMessage);
    await this.addChatHistory();
    await this.addCurrentState();
    return this.messages;
  }

   addSystemMessage() {
    let systemMessage;
    systemMessage = TASK_EXECUTION_PROMPT_TEMPLATE;
    systemMessage += this.taskContext();
    systemMessage += this.projectCustomInstructions();
    systemMessage = fromTemplate(systemMessage, '{osName}', getSystemInfo());
    systemMessage = fromTemplate(systemMessage, '{shellType}', chatController.terminalSession.shellType);
    systemMessage = fromTemplate(systemMessage, '{currentDate}', new Date().toISOString().split('T')[0]);
     systemMessage = fromTemplate(systemMessage, '{country}', getCountryFromLocale());
     
    this.messages.push({
      role: 'system',
      content: systemMessage,
    });
   }

  async addChatHistory() {
    let reducedBackendMessages = await this.contextReducer.reduce(this.backendMessages);
    reducedBackendMessages = reducedBackendMessages.map((message) => _.omit(message, ['id']))
    this.messages.push(...reducedBackendMessages);
  }

  async addTaskMessage() {
    this.messages.push({
      role: 'user',
      content: this.chat.task,
    });
  }

  async addCurrentState() {
    await this.contextFiles.updateFromChat(this.messages);
    const filesContents = await this.contextFiles.filesContents(this.messages);
    const projectState = await this.projectState();
    const clarifyingMessage = "This is for my own information:";
    const content = [clarifyingMessage, filesContents, projectState].join('\n\n').trim();
    
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      this.messages.splice(this.messages.length - 1, 0, {
        role: 'assistant',
        content: content,
      });
    } else {
      this.messages.push({
        role: 'assistant',
        content: content,
      });
    }
  }

  taskContext() {
    let projectOverview = chatController.agent.projectController.projectOverview;
    if (!projectOverview) return '';
    
    const projectOverviewText = JSON.stringify(projectOverview, null, 2);
    return `\n\n<project_overview>\n${projectOverviewText}\n</project_overview>\n`;
  }

  projectCustomInstructions() {
    const projectCustomInstructions = chatController.agent.projectController.getCustomInstructions();

    if (!projectCustomInstructions) {
      return '';
    } else {
      return `\n\n<project_user_instructions>\n${projectCustomInstructions}\n\n</project_user_instructions>`;
    }
  }

  async projectState() {
    await chatController.terminalSession.getCurrentDirectory();

    let projectStateText = '';
    projectStateText += `Current base directory is now: "${chatController.agent.currentWorkingDir}". Do not "cd" to this location since you are already here.\n`;
    if (chatController.agent.projectController.currentProject) {
      const filesInFolder = await chatController.agent.projectController.getFolderStructure();
      if (filesInFolder) {
        projectStateText += `\n<top_level_files>\n${filesInFolder}\n</top_level_files>\n`;
      }
    }

    return projectStateText ? `\n<current_project_state>\n${projectStateText}\n</current_project_state>\n` : '';
  }
}

module.exports = ContextBuilder;
