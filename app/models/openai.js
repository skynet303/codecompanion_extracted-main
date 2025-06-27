const { OpenAI } = require('openai');

const { log, getTokenCount } = require('../utils');
const { MODEL_OPTIONS } = require('../static/models_config');
const AnthropicCaching = require('./anthropic_caching');
const errorRecovery = require('../lib/error-recovery');
const progressTracker = require('../lib/progress-tracker');

const MAX_RETRIES = 5;
const DEFAULT_TEMPERATURE = 0.0;
const MODEL_WITH_PREDICTION = ['gpt-4o', 'gpt-4.1-nano'];

class OpenAIModel {
  constructor({ model, apiKey, baseUrl, streamCallback, chatController, defaultHeaders }) {
    this.model = model;
    this.chatController = chatController;
    const config = {
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: MAX_RETRIES,
    };
    if (baseUrl) {
      config.baseURL = baseUrl;
    }
    if (defaultHeaders) {
      config.defaultHeaders = defaultHeaders;
    }
    this.client = new OpenAI(config);
    this.streamCallback = streamCallback;
    this.cachingManager = new AnthropicCaching();
  }

  async call({
    messages,
    model,
    tool = null,
    tools = null,
    temperature = DEFAULT_TEMPERATURE,
    tool_choice = null,
    prediction = null,
  }) {
    let response;
    const modelName = model || this.model;
    const callParams = {
      model: modelName,
      messages: this.formatMessages(messages, modelName),
    };

    // Only add temperature if not explicitly unsupported for the model
    const modelConfig = MODEL_OPTIONS.find(opt => opt.model === modelName);
    if (modelConfig && !modelConfig.temperatureUnsupported) {
      callParams.temperature = temperature;
    }

    if (tool_choice) {
      callParams.tool_choice = tool_choice;
    }
    if (prediction && MODEL_WITH_PREDICTION.includes(modelName)) {
      callParams.prediction = {
        type: 'content',
        content: prediction,
      };
    }
    if (tool !== null || tool_choice === 'required') {
      response = await this.toolUse(callParams, [tool, ...(tools || [])].filter(Boolean), tool_choice, modelName);
    } else {
      if (tools) {
        const formattedTools = tools.map((tool) => this.openAiToolFormat(tool));
        callParams.tools = this.isAnthropicModel(modelName) ? 
          this.cachingManager.addCacheControlToTools(formattedTools) : 
          formattedTools;
      }
      response = await this.stream(callParams);
    }
    return response;
  }

  async stream(callParams) {
    const trackingId = `openai-${Date.now()}`;
    progressTracker.start(trackingId, `Streaming from ${callParams.model}`);
    
    try {
      callParams.stream = true;
      log('Calling model API:', callParams);
      const stream = await this.client.chat.completions.create(callParams, {
        signal: this.chatController.abortController.signal,
      });

      let fullContent = '';
      let toolCalls = [];
      let chunkCount = 0;

      for await (const part of stream) {
        chunkCount++;
        if (chunkCount % 10 === 0) {
          progressTracker.update(trackingId, Math.min(80, chunkCount), { 
            log: `Processing chunks...` 
          });
        }
        
        if (part.choices[0]?.delta?.content) {
          const delta = part.choices[0].delta.content;
          this.streamCallback(fullContent, delta);
          fullContent += delta;
        }
        if (part.choices[0]?.delta?.tool_calls) {
          toolCalls = this.accumulateToolCalls(toolCalls, part.choices[0].delta.tool_calls);
        }
      }
      log('Raw response', fullContent, toolCalls);
      this.streamCallback('');
      const usage = getTokenCount(callParams.messages) + getTokenCount(fullContent);
      this.chatController.updateUsage(usage, callParams.model);
      
      progressTracker.complete(trackingId, 'Stream completed successfully');
      
      return {
        content: fullContent,
        tool_calls: this.formattedToolCalls(toolCalls),
      };
    } catch (error) {
      progressTracker.fail(trackingId, error.message);
      
      // Handle error with recovery
      const recovery = await errorRecovery.handleError(error, {
        provider: 'openai',
        model: callParams.model,
        context: { messages: callParams.messages }
      });
      
      if (recovery.retry && recovery.success) {
        // Retry with updated parameters
        return this.stream(callParams);
      }
      
      throw error;
    }
  }

  accumulateToolCalls(existingCalls, newCalls) {
    newCalls.forEach((newCall) => {
      const index = newCall.index;
      if (!existingCalls[index]) {
        existingCalls[index] = {
          id: newCall.id,
          type: 'function',
          function: { name: '', arguments: '' }
        };
      }
      if (newCall.function?.name) {
        existingCalls[index].function.name = newCall.function.name;
      }
      if (newCall.function?.arguments) {
        existingCalls[index].function.arguments += newCall.function.arguments;
      }
    });
    return existingCalls;
  }

  async toolUse(callParams, tools, toolChoice, modelName) {
    const formattedTools = tools.map((tool) => this.openAiToolFormat(tool));
    callParams.tools = this.isAnthropicModel(modelName) ? 
      this.cachingManager.addCacheControlToTools(formattedTools) : 
      formattedTools;
    callParams.tool_choice = toolChoice ? toolChoice : { type: 'function', function: { name: tools[0].name } };
    log('Calling model API:', callParams);
    const chatCompletion = await this.client.chat.completions.create(callParams, {
      signal: this.chatController.abortController.signal,
    });
    log('Raw response', chatCompletion);
    if (!chatCompletion.choices) {
      throw new Error('Empty response from model. Please try again.');
    }
    const usage = chatCompletion.usage?.prompt_tokens + chatCompletion.usage?.completion_tokens;
    this.chatController.updateUsage(usage, callParams.model);

    return {
      content: chatCompletion.choices[0].message.content,
      tool_calls: this.formattedToolCalls(chatCompletion.choices[0].message.tool_calls),
    };
  }

  formatMessages(messages, modelName) {
    const result = messages.map(message => {
      if (message.role === 'assistant' && message.tool_calls) {
        return {
          ...message,
          tool_calls: message.tool_calls.map(toolCall => ({
            ...toolCall,
            function: {
              ...toolCall.function,
              arguments: JSON.stringify(toolCall.function.arguments)
            }
          }))
        };
      }
      return message;
    });

    const filteredMessages = result.filter(
      message => {
        if (message.role === 'assistant') {
          return message.content || message.tool_calls;
        }
        return true;
      }
    );

    if (this.isAnthropicModel(modelName)) {
      return this.cachingManager.addCacheControlToMessages(filteredMessages);
    }
    
    return filteredMessages;
  }

  formattedToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return null;

    return toolCalls
      .filter((call) => call !== null)
      .map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: this.parseJSONSafely(toolCall.function.arguments),
        },
      }));
  }

  parseJSONSafely(str) {
    const errorMessage = 'Failed to parse response from model, invalid response format. Click Retry to try again.';
    if (typeof str === 'object' && str !== null) {
      return str; // Already a JSON object, return as is
    }

    const trimmedStr = str.trim();
    if (trimmedStr && trimmedStr.startsWith('{') && !trimmedStr.endsWith('}')) {
      str = trimmedStr + '}';
    }

    try {
      return JSON.parse(str);
    } catch (error) {
      console.error('Error parsing JSON:', error, str);
      throw new Error(errorMessage);
    }
  }

  openAiToolFormat(tool) {
    return {
      type: 'function',
      function: tool,
    };
  }

  isAnthropicModel(modelName) {
    return modelName && modelName.toLowerCase().includes('anthropic');
  }

  hasApiKey() {
    return !!(this.client.apiKey);
  }
}

module.exports = OpenAIModel;
