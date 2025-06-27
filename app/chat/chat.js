const { clipboard } = require('electron');

const ChatHistory = require('./chat_history');
const ContextBuilder = require('./context/contextBuilder.js');
const { debounce, throttle } = require('lodash');

class Chat {
  constructor(chatController) {
    this.chatController = chatController;
    this.frontendMessages = [];
    this.backendMessages = [];
    this.currentId = 1;
    this.lastBackendMessageId = 0;
    this.history = new ChatHistory();
    this.chatContextBuilder = new ContextBuilder(this);
    this.task = null;
    this.shellType = null;
    this.startTimestamp = Date.now();
    this.debouncedScrollToBottom = debounce(() => viewController.scrollToBottom(), 100);
    this.userDecision = null;
    this.throttledFormatResponse = throttle((role, content, streamingOutput) => {
      const formattedResponse = viewController.formatResponse({ role, content });
      if (streamingOutput && formattedResponse) {
        streamingOutput.innerHTML = formattedResponse;
      }
      return formattedResponse;
    }, 50);
    this.pendingContent = '';
  }

  isEmpty() {
    return this.backendMessages.length === 0;
  }

  onlyHasImages() {
    if (this.backendMessages.length === 0) {
      return false;
    }

    return this.backendMessages.every((message) => {
      if (Array.isArray(message.content)) {
        return message.content.some((item) => item.type === 'image_url');
      }
    });
  }

  getNextId() {
    this.currentId += 1;
    return this.currentId;
  }

  async addTask(task) {
    this.task = task;
    chatController.taskTab.renderTask(task);
    viewController.activateTab('task-tab');
  }

  getLastUserMessage() {
    const userMessages = this.frontendMessages.filter((message) => message.role === 'user');
    return userMessages[userMessages.length - 1]?.content;
  }

  countOfUserMessages() {
    return this.frontendMessages.filter((message) => message.role === 'user').length;
  }

  addFrontendMessage(role, content) {
    const message = {
      id: this.getNextId(),
      role,
      content,
      backendMessageId: this.lastBackendMessageId,
    };
    this.frontendMessages.push(message);
    this.updateUI();
    return message;
  }

  addBackendMessage(role, content, toolCalls = null, name = null, toolCallId = null) {
    this.lastBackendMessageId = this.getNextId();
    const message = {
      id: this.lastBackendMessageId,
      role,
      content,
    };
    if (toolCalls) {
      message.tool_calls = toolCalls;
    }
    if (name) {
      message.name = name;
    }
    if (toolCallId) {
      message.tool_call_id = toolCallId;
    }
    this.backendMessages.push(message);
    return message;
  }

  addProjectStateMessage(content) {
    const message = {
      id: 1,
      role: 'system',
      content,
    };
    // insert this message right before last assistant or user message
    const insertIndex = this.findLastIndex(
      this.backendMessages,
      (msg) => msg.role === 'assistant' || msg.role === 'user'
    );
    this.backendMessages.splice(insertIndex, 0, message);
  }

  findLastIndex(arr, predicate) {
    let index = arr.length;
    while (index--) {
      if (predicate(arr[index])) return index;
    }
    return -1;
  }

  addMessage(role, content) {
    const backendMessage = this.addBackendMessage(role, content);
    this.addFrontendMessage(role, content, backendMessage.id);
  }

  copyFrontendMessage(id) {
    const message = this.frontendMessages.find((msg) => msg.id === id);
    if (message) {
      clipboard.writeText(message.content);
    }
  }

  deleteMessagesThatStartWith(pattern) {
    this.backendMessages = this.backendMessages.filter(
      (msg) => !(typeof msg.content === 'string' && msg.content && msg.content.startsWith(pattern))
    );
  }

  deleteMessagesAfterId(frontendMessageId) {
    const messageIndex = this.frontendMessages.findIndex((msg) => msg.id === frontendMessageId);
    if (messageIndex !== -1) {
      const message = this.frontendMessages[messageIndex];
      this.frontendMessages = this.frontendMessages.slice(0, messageIndex);
      const backendMessageIndex = this.backendMessages.findIndex((msg) => msg.id === message.backendMessageId);
      if (backendMessageIndex !== -1) {
        this.backendMessages = this.backendMessages.slice(0, backendMessageIndex);
      }
      // Clear output and re-render all remaining messages
      const output = document.getElementById('output');
      output.innerHTML = '';
      this.updateUI(true);
      this.chatContextBuilder.contextReducer.reset();
    }
  }

  deleteAfterToolCall(toolCallId) {
    const messageIndex = this.backendMessages.findIndex((msg) => msg.tool_call_id === toolCallId);
    if (messageIndex === -1) {
      return;
    }

    // Delete one message higher than the current one (messageIndex - 2 instead of messageIndex - 1)
    const targetIndex = messageIndex - 2;
    
    // Make sure we don't go out of bounds
    if (targetIndex < 0) {
      return;
    }

    const priorMessage = this.backendMessages[targetIndex];
    const frontendMessage = this.frontendMessages.find((msg) => msg.backendMessageId === priorMessage.id);
    this.deleteMessagesAfterId(frontendMessage.id);
    chatController.taskTab.render();
  }

  updateUI() {
    viewController.updateLoadingIndicator(false);
    document.getElementById('streaming_output').innerHTML = '';
    const output = document.getElementById('output');
    viewController.cleanupTooltips(document.getElementById('streaming_output'));
    
    // Get last rendered message ID
    const lastRenderedId = output.lastElementChild ? 
      parseInt(output.lastElementChild.dataset.messageId) : 0;
    
    // If output is empty or messages were deleted, render all messages
    if (lastRenderedId === 0 || lastRenderedId > Math.max(...this.frontendMessages.map(m => m.id))) {
      viewController.cleanupTooltips(output);
      output.innerHTML = this.frontendMessages
        .map(msg => `<div data-message-id="${msg.id}">${viewController.formatResponse(msg)}</div>`)
        .join('');
      viewController.activateTooltips();
    } else {
      // Only append new messages
      const newMessages = this.frontendMessages.filter(msg => msg.id > lastRenderedId);
      if (newMessages.length > 0) {
        const formattedNewMessages = newMessages
          .map(msg => `<div data-message-id="${msg.id}">${viewController.formatResponse(msg)}</div>`)
          .join('');
        output.insertAdjacentHTML('beforeend', formattedNewMessages);
        viewController.activateTooltips(newMessages.length);
      }
    }
    viewController.userHasScrolled = false;
    this.debouncedScrollToBottom();
    viewController.showWelcomeContent();
  }
  
  updateStreamingMessage(message, delta) {
    const streamingOutput = document.getElementById('streaming_output');
    
    if (delta) {
      this.pendingContent = message + delta;
    } else {
      this.pendingContent = message;
    }
    
    this.throttledFormatResponse('assistant', this.pendingContent, streamingOutput);
    
    this.debouncedScrollToBottom();
    viewController.userHasScrolled = false;
  }
}

module.exports = Chat;
