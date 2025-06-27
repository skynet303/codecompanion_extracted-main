const { v4: uuidv4 } = require('uuid');
const fs = require('graceful-fs');
const pathModule = require('path');
const JSONStream = require('JSONStream');
const { app } = require('@electron/remote');

const saveChatModal = new bootstrap.Modal(document.getElementById('saveChatModal'));

class ChatHistory {
  constructor() {
    this.historyPath = pathModule.join(app.getPath('userData'), 'chat_history.json');
    this.chatHistory = {};
    this.migrateFromLocalStorage();
  }

  async migrateFromLocalStorage() {
    try {
      const oldHistory = localStorage.get('chatHistory', {});
      if (Object.keys(oldHistory).length > 0) {
        await this.saveToFile(oldHistory);
        localStorage.set('chatHistory', {});
      }
    } catch (error) {
      console.error('Error migrating chat history:', error);
    }
  }

  async saveToFile(data) {
    try {
      const writeStream = fs.createWriteStream(this.historyPath);
      const stringifier = JSONStream.stringify();
      stringifier.pipe(writeStream);

      for (const [id, record] of Object.entries(data)) {
        stringifier.write({ id, ...record });
      }
      stringifier.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  }

  async loadFromFile() {
    this.chatHistory = {};
    if (fs.existsSync(this.historyPath)) {
      try {
        const parser = JSONStream.parse('*');
        const readStream = fs.createReadStream(this.historyPath);

        await new Promise((resolve, reject) => {
          parser.on('data', (record) => {
            this.chatHistory[record.id] = record;
          });

          parser.on('end', resolve);
          parser.on('error', reject);

          readStream.pipe(parser);
        });
      } catch (error) {
        console.error('Error loading chat history:', error);
      }
    }
  }

  async save() {
    const id = uuidv4();
    const date = new Date().toISOString();
    const titleElement = document.getElementById('chatTitle');
    const title = titleElement.value || 'Untitled';
    titleElement.value = '';

    const record = {
      id,
      title,
      date,
      chat: {
        frontendMessages: chatController.chat.frontendMessages,
        backendMessages: chatController.chat.backendMessages,
        currentId: chatController.chat.currentId,
        lastBackendMessageId: chatController.chat.lastBackendMessageId,
        taskTitle: chatController.chat.taskTitle,
        task: chatController.chat.task,
        taskContext: chatController.chat.taskContext,
        taskContextFiles: chatController.chat.chatContextBuilder.contextFiles.files,
      },
      workingDir: chatController.agent.currentWorkingDir,
      selectedModel: chatController.settings.selectedModel,
    };

    this.chatHistory[id] = record;
    await this.saveToFile(this.chatHistory);
    saveChatModal.hide();
    viewController.updateFooterMessage('Chat saved.');
  }

  async delete(id) {
    delete this.chatHistory[id];
    await this.saveToFile(this.chatHistory);
    await this.load(); 
  }

  retrieveAll() {
    const records = Object.values(this.chatHistory);
    return records.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async restoreChat(id) {
    const record = this.chatHistory[id];
    if (record) {
      chatController.saveSetting('selectedModel', record.selectedModel);
      Object.assign(chatController.chat, record.chat);
      chatController.chat.chatContextBuilder.contextFiles.files = record.chat.taskContextFiles;
      chatController.chat.chatContextBuilder.lastMessageIdForRelevantFiles =
        chatController.chat.backendMessages[chatController.chat.backendMessages.length - 1].id;
      await chatController.agent.projectController.openProject(record.workingDir);
      chatController.chat.updateUI();
      chatController.taskTab.render();
      chatController.chat.chatContextBuilder.contextReducer.reset();
    } else {
      console.error('Chat not found');
    }
  }

  async deleteAll() {
    this.chatHistory = {};
    await this.saveToFile(this.chatHistory);
    await this.load(); 
  }

  renderUI() {
    const records = this.retrieveAll();

    if (!records.length) {
      return '<div class="text-muted">No history records found.</div>';
    }

    const recordRows = records
      .map(
        (record) => `
        <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
          <a href="#" onclick="event.preventDefault(); chatController.chat.history.restoreChat('${record.id}')" class="text-decoration-none text-body text-truncate">
            <i class="bi bi-chat-left me-2"></i>
            ${record.title}
          </a>
          <button class="btn btn-sm" onclick="event.preventDefault(); chatController.chat.history.delete('${record.id}')"><i class="bi bi-trash"></i></button>
        </div>
    `
      )
      .join('');

    return `
    <div class="d-flex justify-content-end mb-3">
      <button onclick="chatController.chat.history.deleteAll()" class="btn btn-sm btn-outline-secondary"><i class="bi bi-trash"></i> Delete all</button>
    </div>
    ${recordRows}
  `;
  }

  async load() {
    await this.loadFromFile();
    document.getElementById('chatHistory').innerHTML = this.renderUI();
  }

  showModal() {
    if (chatController.chat.isEmpty()) {
      viewController.updateFooterMessage('Nothing to save.');
      return;
    }
    saveChatModal.show();
    const chatTitleInput = document.getElementById('chatTitle');
    chatTitleInput.value = chatController.chat.taskTitle || '';
    chatTitleInput.focus();
  }
}

module.exports = ChatHistory;