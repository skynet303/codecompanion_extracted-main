const { getTokenCount } = require('../../utils');
const LLMSummarize = require('./llmSummarize');
const MIN_MESSAGES_BETWEEN_SUMMARIZATIONS = 25;
const KEEP_LAST_N_MESSAGES = 25;

class ContextReducer {
  constructor(backendMessages) {
    this.backendMessages = backendMessages;
    this.llmSummarize = new LLMSummarize();
    this.reset();
  }

  async reduce(backendMessages) {
    if (!backendMessages) return [];

    this.backendMessages = backendMessages;
    this.maxChatHistoryTokens = chatController.settings.maxChatHistoryTokens;
    this.reduceFileOperations();
    return await this.summarize();
  }

  reset() {
    this.lastSummarizedMessageID = -1;
    this.pastSummarizedMessages = '';
  }

  reduceFileOperations() {
    this.backendMessages.forEach(message => {
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach(toolCall => {
          if (toolCall.function?.name === 'file_operation') {
            if (toolCall.function.arguments.operation === 'create') {
              toolCall.function.arguments.content = '// File content removed for conciseness. See file content below.';
            }
          }
        });
      }
    });
  }

  currentMessages() {
    if (this.lastSummarizedMessageID === -1) return this.backendMessages;

    let summaryMessage;
    const notSummarizedMessages = this.backendMessages.filter(msg => msg.id > this.lastSummarizedMessageID);
    
    if (this.pastSummarizedMessages && this.pastSummarizedMessages !== '' && this.pastSummarizedMessages !== null) {
      summaryMessage = {
        role: 'assistant',
        content: `This is for myself. Summary of the conversation so far and what was done:\n${this.pastSummarizedMessages}`,
      };
    }

    return [summaryMessage, ...notSummarizedMessages];
  }

  async summarize() {
    const messages = this.currentMessages();

    let splitIndex = messages.length - KEEP_LAST_N_MESSAGES;
    if (splitIndex <= 0) return messages;

    const lastMessageId = messages[messages.length - 1 - KEEP_LAST_N_MESSAGES].id;
    if (this.lastSummarizedMessageID !== -1 && (lastMessageId - this.lastSummarizedMessageID) < MIN_MESSAGES_BETWEEN_SUMMARIZATIONS) {
      return messages;
    }
    
    while (splitIndex < messages.length && messages[splitIndex].role !== 'assistant') {
      splitIndex++;
    }
    
    const messagesToSummarize = messages.slice(0, splitIndex);
    let lastSummarizedId = this.lastSummarizedMessageID;
    const messagesToSummarizeText = messagesToSummarize
      .reduce((acc, message) => {
        acc += `${this.formatMessageForSummary(message)},\n`;
        lastSummarizedId = message.id;
        return acc;
      }, '');
    const allMessagesText = this.pastSummarizedMessages + messagesToSummarizeText;

    const chatHistoryTokenCount = getTokenCount(allMessagesText);
    if (chatHistoryTokenCount > this.maxChatHistoryTokens) {
      const summarizedMessages = await this.summarizeMessages(allMessagesText);
      if (!summarizedMessages) {
        return messages;
      }
      this.pastSummarizedMessages = summarizedMessages;
      this.lastSummarizedMessageID = lastSummarizedId;
    }

    const summaryMessage = {
      role: 'assistant',
      content: `This is for myself. Summary of the conversation so far and what was done:\n${this.pastSummarizedMessages}`,
    };
    const recentMessages = messages.slice(splitIndex);
    return [summaryMessage, ...recentMessages];
  }

  formatMessageForSummary(message) {
    let content = [];

    if (Array.isArray(message.content)) {
      const textContent = message.content.filter(item => item.type !== 'image_url');
      if (textContent.length > 0) {
        content.push({
          type: message.role === 'tool' ? 'tool_result' : 'text',
          content: textContent,
        });
      }
    } else if (message.content) {
      content.push({
        type: message.role === 'tool' ? 'tool_result' : 'text',
        content: message.content,
      });
    }

    if (message.tool_calls) {
      message.tool_calls.forEach((toolCall) => {
        const toolCallContent = {
          type: 'tool_use',
          name: toolCall.function.name,
        };
        if (toolCall.function.arguments?.targetFile) {
          toolCallContent.targetFile = toolCall.function.arguments.targetFile;
        }
        content.push(toolCallContent);
      });
    }

    const role = message.role === 'tool' ? 'user' : message.role;
    const result = { role, content };
    return JSON.stringify(result, null, 2);
  }

  async summarizeMessages(messages) {
    return this.llmSummarize.summarize(messages);
  }
}

module.exports = ContextReducer;
