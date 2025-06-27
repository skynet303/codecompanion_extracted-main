const { getTokenCount } = require('../utils');

const MIN_CACHE_SIZE = 1024;

class AnthropicCaching {
  constructor(cache = true) {
    this.cache = cache;
  }

  isCacheSupported(systemPrompt) {
    return (
      this.cache === true &&
      getTokenCount(systemPrompt) > MIN_CACHE_SIZE
    );
  }

  buildSystemPromptWithCache(messages) {
    const system = messages.find((message) => message.role === 'system');
    if (system) {
      const result = [
        {
          type: 'text',
          text: system.content,
        },
      ];
      result[0].cache_control = { type: 'ephemeral' };
      return result;
    }
    return null;
  }

  addCacheControlToMessages(messages) {
    messages.forEach(msg => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(item => {
          delete item.cache_control;
        });
      }
    });
    
    const lastUserIndex = messages.findLastIndex(msg => msg.role === 'user' && Array.isArray(msg.content) && msg.content.length > 0);
    
    if (lastUserIndex >= 0) {
      const lastMessage = messages[lastUserIndex];
      lastMessage.content[0].cache_control = { type: "ephemeral" };
    }
    
    return messages;
  }

  addCacheControlToTools(tools) {
    if (!tools || tools.length === 0) return tools;
    
    return tools.map((tool, index) => {
      const formattedTool = { ...tool };
      if (index === tools.length - 1) {
        formattedTool.cache_control = { type: "ephemeral" };
      }
      return formattedTool;
    });
  }
}

module.exports = AnthropicCaching;