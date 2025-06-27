const Anthropic = require('@anthropic-ai/sdk');
const { log, getTokenCount } = require('../utils');
const AnthropicCaching = require('./anthropic_caching');
const errorRecovery = require('../lib/error-recovery');
const progressTracker = require('../lib/progress-tracker');

const MAX_RETRIES = 5;
const DEFAULT_TEMPERATURE = 0.0;

class AnthropicModel {
  constructor({ model, apiKey, baseUrl, streamCallback, chatController }) {
    this.model = model;
    this.chatController = chatController;
    const config = {
      apiKey: apiKey,
      maxRetries: MAX_RETRIES,
      dangerouslyAllowBrowser: true,
    };
    this.options = {};
    this.maxTokens = 8192;
    if (baseUrl) {
      config.baseURL = baseUrl;
    }
    this.streamCallback = streamCallback;
    this.client = new Anthropic(config);
    this.cachingManager = new AnthropicCaching();
  }

  async call({
    messages,
    model,
    tool = null,
    tools = null,
    temperature = DEFAULT_TEMPERATURE,
    tool_choice = null,
    cache = true,
  }) {
    this.cachingManager.cache = cache;
    let response;
    const callParams = {
      model: model || this.model,
      system: this.cachingManager.buildSystemPromptWithCache(messages),
      messages: this.formatMessages(messages),
      temperature,
      max_tokens: this.maxTokens,
    };
    if (tool_choice) {
      callParams.tool_choice = tool_choice;
    }
    if (tool !== null || tool_choice === 'required') {
      response = await this.toolUse(callParams, [tool, ...(tools || [])].filter(Boolean), tool_choice);
    } else {
      if (tools) {
        const formattedTools = tools.map((tool) => this.anthropicToolFormat(tool));
        callParams.tools = this.cachingManager.addCacheControlToTools(formattedTools);
      }
      response = await this.stream(callParams);
    }
    return response;
  }



  formatMessages(messages) {
    const messagesWithoutSystem = messages.filter((message) => message.role !== 'system');
    // Group consecutive tool messages together
    const groupedMessages = [];
    let currentToolGroup = null;

    for (const message of messagesWithoutSystem) {
      if (message.role === 'tool') {
        if (!currentToolGroup) {
          currentToolGroup = {
            role: 'user',
            content: []
          };
          groupedMessages.push(currentToolGroup);
        }
        currentToolGroup.content.push({
          tool_use_id: message.tool_call_id,
          type: 'tool_result',
          content: message.content
        });
      } else {
        currentToolGroup = null;
        if (message.role === 'assistant' && message.tool_calls) {
          groupedMessages.push(this.formatAssistantMessage(message));
        } else if (Array.isArray(message.content)) {
          groupedMessages.push(this.formatMessageWithImage(message));
        } else {
          groupedMessages.push(message);
        }
      }
    }
    // Filter out empty messages
    const filteredMessages = groupedMessages.filter(
      message => {
        if (typeof message.content === 'string') {
          return message.content.trim() !== '';
        }
        return Array.isArray(message.content) && message.content.length > 0;
      }
    );
    return this.cachingManager.addCacheControlToMessages(filteredMessages);
  }

  formatAssistantMessage(message) {
    const content = [];
    if (message.content) {
      content.push({
        type: 'text',
        text: message.content
      });
    }
    if (message.tool_calls && message.tool_calls.length > 0) {
      message.tool_calls.forEach(toolCall => {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: toolCall.function.arguments
        });
      });
    }

    return {
      role: 'assistant',
      content
    };
  }

  formatMessageWithImage(message) {
    return {
      role: 'user', 
      content: message.content.map((item) => {
        if (item.type === 'image_url') {
          return this.formatImageUrlContent(item);
        }
        return item;
      }),
    };
  }

  formatImageUrlContent(item) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: item.image_url.media_type,
        data: item.image_url.url.split(',')[1], // Remove the "data:image/jpeg;base64," prefix
      },
    };
  }

  async stream(callParams) {
    const trackingId = `anthropic-${Date.now()}`;
    progressTracker.start(trackingId, 'Streaming from Anthropic API');
    
    try {
      log('Calling model API:', callParams);
      let message = '';
      let toolCall = '';
      this.options.signal = this.chatController.abortController.signal;
      const stream = await this.client.messages.stream(callParams, this.options)
      
      stream.on('text', (text) => {
        this.streamCallback(message, text);
        message += text;
      });

      stream.on('inputJson', (_patialJson, jsonSnapshot) => {
        if (jsonSnapshot) {
          if ((jsonSnapshot.operation === 'create' || jsonSnapshot.operation === 'update') && jsonSnapshot.targetFile) {
            viewController.updateLoadingIndicator(true, `Generating ${jsonSnapshot.targetFile}`);
            progressTracker.update(trackingId, 50, { log: `Generating ${jsonSnapshot.targetFile}` });
          }
          if (jsonSnapshot.thought) {
            viewController.updateLoadingIndicator(true, `Thinking...`);
            progressTracker.update(trackingId, 30, { log: 'Processing thoughts...' });
          }
        }
      });

      const finalMessage = await stream.finalMessage();
      this.streamCallback('');
      log('Raw response', finalMessage);
      const usage = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;
      const { cache_creation_input_tokens, cache_read_input_tokens } = finalMessage.usage;
      const cacheUsage = {
        creation_tokens: cache_creation_input_tokens,
        read_tokens: cache_read_input_tokens,
      };
      this.chatController.updateUsage(usage, callParams.model, cacheUsage);
      
      progressTracker.complete(trackingId, 'Stream completed successfully');
      
      return {
        content: finalMessage.content.find((item) => item.type === 'text')?.text || '',
        tool_calls: this.formattedToolCalls(finalMessage.content),
      };
    } catch (error) {
      progressTracker.fail(trackingId, error.message);
      
      // Handle error with recovery
      const recovery = await errorRecovery.handleError(error, {
        provider: 'anthropic',
        model: callParams.model,
        context: { messages: callParams.messages }
      });
      
      if (recovery.retry && recovery.success) {
        // Retry with updated parameters
        if (recovery.timeout) {
          this.options.timeout = recovery.timeout;
        }
        return this.stream(callParams);
      }
      
      throw error;
    }
  }

  async toolUse(callParams, tools, toolChoice) {
    callParams.tools = tools.map((tool) => this.anthropicToolFormat(tool));
    callParams.tool_choice = toolChoice === 'required' ? { type: 'any' } : { type: 'tool', name: tools[0].name };
    this.options.signal = this.chatController.abortController.signal;

    log('Calling model API:', callParams);
    const response = await this.client.messages.create(callParams, this.options);
    log('Raw response', response);
    const usage = response.usage.input_tokens + response.usage.output_tokens;
    this.chatController.updateUsage(usage, callParams.model);
    return {
      content: response.content.filter((item) => item.type === 'text')?.[0]?.text || '',
      tool_calls: this.formattedToolCalls(response.content),
    };
  }

  formattedToolCalls(content) {
    const toolCalls = content.filter((item) => item.type === 'tool_use');
    if (!toolCalls) return null;

    let parsedToolCalls = [];
    for (const toolCall of toolCalls) {
      parsedToolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.input,
        },
      });
    }
    return parsedToolCalls;
  }

  anthropicToolFormat(tool) {
    const { parameters, ...rest } = tool;
    return {
      ...rest,
      input_schema: parameters,
    };
  }

  hasApiKey() {
    return !!(this.client.apiKey);
  }
}

module.exports = AnthropicModel;