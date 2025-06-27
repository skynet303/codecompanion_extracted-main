const { tools } = require('./tools');
const { log } = require('../../utils');

const MAX_STEPS = 2;

const SYSTEM_MESSAGE_TEMPLATE = `
{description}

Use the available tools to gather information.
Call multiple tools/functions in a single step (example read many files, and perform a search)

Output your findings using the 'output' tool when done or there is no more information to gather.
Respond with 'null' for items that you couldn't find or were not able to research.


Here is helpful information about the project and files:
---

{additionalInformation}

Current directory is '{currentDirectory}'.
`;

class ResearchAgent {
  constructor(chatController, taskDescription) {
    this.chatController = chatController;
    this.taskDescription = taskDescription;
  }

  async executeResearch(researchItem, taskContext) {
    if (researchItem.cache && this.getCache(researchItem.name)) {
      return this.getCache(researchItem.name);
    }
    this.taskContext = taskContext;

    this.model = researchItem.model === 'large' ? chatController.model : chatController.smallModel;
    if (!this.model) return;
    const messages = await this.initializeMessages(researchItem);
    const availableTools = tools(researchItem.outputFormat);
    const formattedTools = availableTools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
    const maxSteps = researchItem.maxSteps || MAX_STEPS;

    for (let i = 0; i < maxSteps; i++) {
      log('ResearchAgent:');
      const callParams = {
        messages,
        cache: false,
      };

      if (i === maxSteps - 1) {
        const outputTool = formattedTools.find((tool) => tool.name === 'output');
        callParams.tool = outputTool;
      } else {
        callParams.tools = formattedTools;
        callParams.tool_choice = 'required';
      }
      const response = await this.model.call(callParams);
      if (response.tool_calls) {
        const result = await this.handleToolCalls(response.tool_calls, availableTools, messages);
        if (result) {
          if (researchItem.cache) {
            this.setCache(researchItem.name, result);
          }
          return result;
        }
      } else if (response.content) {
        messages.push({
          role: 'assistant',
          content: response.content,
        });
      }
    }
    return null;
  }

  async initializeMessages(researchItem) {
    const currentDirectory = await this.chatController.terminalSession.getCurrentDirectory();
    const additionalInformation = await this.extractAdditionalInformation(researchItem);

    let content = SYSTEM_MESSAGE_TEMPLATE.replace('{description}', researchItem.description)
      .replace('{currentDirectory}', currentDirectory)
      .replace('{additionalInformation}', additionalInformation);

    const systemMessage = {
      role: 'system',
      content,
    };

    const userMessage = {
      role: 'user',
      content: researchItem.prompt,
    };

    return [systemMessage, userMessage];
  }

  async extractAdditionalInformation(researchItem) {
    let additionalInformation = '';

    if (researchItem.additionalInformation) {
      if (Array.isArray(researchItem.additionalInformation)) {
        additionalInformation = await Promise.all(researchItem.additionalInformation.map((item) => this[item]()));
        additionalInformation = additionalInformation.filter(Boolean).join('\n\n');
      } else {
        additionalInformation = await this[researchItem.additionalInformation]();
      }
    }

    return additionalInformation;
  }

  async handleToolCalls(toolCalls, availableTools, messages) {
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'output') {
        return toolCall.function.arguments;
      } else {
        await this.executeToolAndUpdateMessages(toolCall, availableTools, messages);
      }
    }
  }

  async executeToolAndUpdateMessages(toolCall, availableTools, messages) {
    const tool = availableTools.find((t) => t.name === toolCall.function.name);
    if (tool && tool.executeFunction) {
      const result = await tool.executeFunction(toolCall.function.arguments);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        }],
      });
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  async projectStructure() {
    const projectStructure = await this.chatController.agent.projectController.getFolderStructure(4);
    return projectStructure ? `<projectStructure depth="2">\n${projectStructure}\n</projectStructure>` : '';
  }

  async userSelectedFiles() {
    const filesList = await this.chatController.chat.chatContextBuilder.contextFiles.getEnabled();
    if (!filesList) return '';

    if (filesList.length === 0) return '';

    return `These files are directly relevant:\n<userSelectedFiles>\n${filesList.join('\n')}\n</userSelectedFiles>`;
  }

  getTaskDescription() {
    return `Find information for the following task:\n<taskDescription>\n${this.taskDescription}\n</taskDescription>`;
  }

  additionalContext() {
    const additionalContext = this.chatController.chat.taskContext;
    if (!additionalContext) return '';

    return `<additionalContext>\n${this.chatController.chat.taskContext}\n</additionalContext>`;
  }

  async taskRelevantFilesContent() {
    return await this.chatController.chat.chatContextBuilder.getRelevantFilesContents(false);
  }

  potentiallyRelevantFiles() {
    const potentiallyRelevantFiles = this.taskContext?.['task_relevant_files']?.potentially_relevant_files || [];
    if (potentiallyRelevantFiles && potentiallyRelevantFiles.length === 0) return '';

    return `<potentiallyRelevantFiles>\n${potentiallyRelevantFiles.join('\n')}\n</potentiallyRelevantFiles>`;
  }

  setCache(key, value) {
    const projectKey = this.chatController.agent.projectController.currentProject.path + '-' + key;
    cache.set(projectKey, value);
  }

  getCache(key) {
    const projectKey = this.chatController.agent.projectController.currentProject.path + '-' + key;
    return cache.get(projectKey);
  }
}

module.exports = ResearchAgent;