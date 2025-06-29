const { tools } = require('./tools');
const { log } = require('../../utils');

// Create a dedicated cache Map for research results with 10 minute TTL
const researchCache = new Map();
const RESEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Helper functions for research cache
const getCacheValue = (key) => {
  const cached = researchCache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.value;
  }
  researchCache.delete(key);
  return null;
};

const setCacheValue = (key, value) => {
  researchCache.set(key, {
    value,
    expiry: Date.now() + RESEARCH_CACHE_TTL
  });
};

const MAX_STEPS = 2;

const SYSTEM_MESSAGE_TEMPLATE = `
{description}

Use the available tools to gather information.
Call multiple tools/functions in a single step (example read many files, and perform a search)

Output your findings using the 'output' tool when done or there is no more information to gather.
Respond with 'null' for items that you couldn't find or were not able to research.

{contextSpecificInstructions}

{additionalInformation}

Current directory is '{currentDirectory}'.
`;

const WEB_RESEARCH_INSTRUCTIONS = `
You are performing web-based research. Focus on using web search tools to find information online.
DO NOT attempt to explore project files or use file-based tools unless specifically relevant to the research query.
`;

const PROJECT_RESEARCH_INSTRUCTIONS = `
You are researching within a project codebase. Here is helpful information about the project and files:
---
`;

class ResearchAgent {
  constructor(chatController, taskDescription) {
    this.chatController = chatController;
    this.taskDescription = taskDescription;
    this.progressCallback = null;
  }

  async executeResearch(researchItem, taskContext, progressCallback = null) {
    this.progressCallback = progressCallback;
    
    // Generate cache key including task context for uniqueness
    const cacheKey = this.generateCacheKey(researchItem, taskContext);
    
    if (researchItem.cache) {
      const cachedResult = getCacheValue(cacheKey);
      if (cachedResult) {
        console.log(`Using cached result for research item: ${researchItem.name}`);
        this._notifyProgress(`Using cached result for: ${researchItem.name}`);
        return cachedResult;
      }
    }
    this.taskContext = taskContext;

    this.model = researchItem.model === 'large' ? chatController.model : chatController.smallModel;
    if (!this.model) return;
    const messages = await this.initializeMessages(researchItem);
    
    // Determine if this is a web research task
    const isWebResearch = this.isWebResearchTask(researchItem);
    const availableTools = tools(researchItem.outputFormat, isWebResearch);
    
    const formattedTools = availableTools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
    const maxSteps = researchItem.maxSteps || MAX_STEPS;

    for (let i = 0; i < maxSteps; i++) {
      this._notifyProgress(`Research step ${i + 1}/${maxSteps}: ${researchItem.name}`);
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
      try {
        const response = await this.model.call(callParams);
        if (response.tool_calls) {
          const result = await this.handleToolCalls(response.tool_calls, availableTools, messages);
          if (result) {
            if (researchItem.cache) {
              setCacheValue(cacheKey, result);
            }
            return result;
          }
        } else if (response.content) {
          messages.push({
            role: 'assistant',
            content: response.content,
          });
        }
      } catch (error) {
        console.error(`Research step ${i + 1} failed:`, error);
        this._notifyProgress(`Error in step ${i + 1}: ${error.message}`);
        
        // Retry logic for specific errors
        if (this._isRetryableError(error) && i < maxSteps - 1) {
          this._notifyProgress(`Retrying step ${i + 1}...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          continue;
        }
        
        // For final step or non-retryable errors, return partial result
        if (i === maxSteps - 1) {
          return {
            error: `Research failed: ${error.message}`,
            partial: true,
            completedSteps: i
          };
        }
      }
    }
    return null;
  }

  async initializeMessages(researchItem) {
    const currentDirectory = await this.chatController.terminalSession.getCurrentDirectory();
    const additionalInformation = await this.extractAdditionalInformation(researchItem);
    
    // Determine context-specific instructions
    const isWebResearch = this.isWebResearchTask(researchItem);
    const contextSpecificInstructions = isWebResearch ? WEB_RESEARCH_INSTRUCTIONS : PROJECT_RESEARCH_INSTRUCTIONS;

    let content = SYSTEM_MESSAGE_TEMPLATE.replace('{description}', researchItem.description)
      .replace('{currentDirectory}', currentDirectory)
      .replace('{contextSpecificInstructions}', contextSpecificInstructions)
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
      try {
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
      } catch (error) {
        console.error(`Tool ${tool.name} failed:`, error);
        this._notifyProgress(`Tool ${tool.name} failed: ${error.message}`);
        
        // Add error message to conversation for model awareness
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
          content: `Error: ${error.message}. Please try a different approach or tool.`,
        });
      }
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

  generateCacheKey(researchItem, taskContext) {
    // Create a unique cache key based on research item and context
    const crypto = require('crypto');
    const projectPath = this.chatController.agent.projectController.currentProject.path;
    const contextHash = taskContext ? 
      crypto.createHash('md5').update(JSON.stringify(taskContext)).digest('hex').slice(0, 8) : 
      'no-context';
    return `${projectPath}:${researchItem.name}:${contextHash}`;
  }

  // Get cache statistics for debugging
  getCacheStats() {
    return {
      size: researchCache.size,
      entries: Array.from(researchCache.keys())
    };
  }

  _notifyProgress(message) {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
    // Also try to notify via frontend if available
    if (this.chatController?.chat?.addFrontendMessage) {
      this.chatController.chat.addFrontendMessage('info', `🔍 ${message}`);
    }
  }

  _isRetryableError(error) {
    // Define retryable error conditions
    const retryableMessages = [
      'timeout',
      'network',
      'ECONNRESET',
      'ETIMEDOUT',
      'rate limit',
      'too many requests'
    ];
    
    const errorMessage = (error.message || '').toLowerCase();
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  isWebResearchTask(researchItem) {
    // Check if this is a web research task based on various indicators
    if (researchItem.webResearch === true) return true;
    
    const webKeywords = [
      'google', 'search web', 'search online', 'internet', 
      'website', 'github repository', 'open source', 'popular',
      'trending', 'latest', 'news', 'article', 'blog'
    ];
    
    const prompt = (researchItem.prompt || '').toLowerCase();
    const description = (researchItem.description || '').toLowerCase();
    const taskDesc = (this.taskDescription || '').toLowerCase();
    
    return webKeywords.some(keyword => 
      prompt.includes(keyword) || 
      description.includes(keyword) || 
      taskDesc.includes(keyword)
    );
  }
}

module.exports = ResearchAgent;
