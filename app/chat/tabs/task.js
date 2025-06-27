const path = require('path');
const marked = require('marked');
const { openFileLink } = require('../../utils');
const { encode } = require('html-entities');

class TaskTab {
  constructor(chatController) {
    this.chatController = chatController;
    this.contextFilesContainer = document.getElementById('contextFilesContainer');
    this.filesContextLabel = document.getElementById('filesContextLabel');
  }

  render() {
    const taskContext = this.chatController.chat.taskContext;
    this.renderTask(this.chatController.chat.task, this.chatController.chat.taskTitle);
    this.renderContextFiles();
  }

  async renderContextFiles() {
    const taskContextFiles = await this.chatController.chat.chatContextBuilder.contextFiles.getAll();
    if (!taskContextFiles) return;

    const enabledFiles = await this.chatController.chat.chatContextBuilder.contextFiles.getEnabled();
    if (!taskContextFiles || Object.keys(taskContextFiles).length === 0) {
      this.filesContextLabel.innerText = 'Files context (0)';
      this.contextFilesContainer.innerHTML =
        '<span class="text-secondary">No files have been added to the chat context</span>';
      return;
    }

    const baseDirectory = this.chatController.agent.projectController.currentProject.path;
    const relativePaths = this.getRelativePaths(taskContextFiles, baseDirectory);

    this.contextFilesContainer.innerHTML = await this.generateContextFilesHTML(relativePaths);
    this.filesContextLabel.innerText = `Files context (${enabledFiles.length})`;
    this.setupContextFilesEventListener();
  }

  getRelativePaths(taskContextFiles, baseDirectory) {
    return Object.entries(taskContextFiles)
      .map(([file, enabled]) => ({
        path: path.relative(baseDirectory, file),
        enabled,
        fullPath: file,
      }));
  }

  async generateContextFilesHTML(relativePaths) {
    const reversedPaths = [...relativePaths].reverse();
    const listItems = [];
    
    for (const { path: relativePath, enabled, fullPath } of reversedPaths) {
      const item = `
        <li class="list-group-item d-flex justify-content-between align-items-center px-0">
          <div class="text-truncate mw-75">
            ${await openFileLink(relativePath)}
          </div>
          <div class="form-check form-switch">
            <input class="form-check-input context-file-checkbox" type="checkbox" role="switch" 
              data-full-path="${fullPath}" ${enabled ? 'checked' : ''}>
          </div>
        </li>
      `;
      listItems.push(item);
    }

    return `
    <ul class="list-group list-group-flush">
      ${listItems.join('')}
    </ul>
  `;
  }

  setupContextFilesEventListener() {
    this.contextFilesContainer.removeEventListener('change', this.handleContextFileChange);
    this.contextFilesContainer.addEventListener('change', this.handleContextFileChange);
  }

  handleContextFileChange = async (event) => {
    if (event.target.classList.contains('context-file-checkbox')) {
      const fullPath = event.target.dataset.fullPath;
      this.chatController.chat.chatContextBuilder.contextFiles.add(fullPath, event.target.checked);
    }
  };

  renderTask(task, taskTitle) {
    if (!task) {
      document.getElementById('taskTitle').innerText = 'New task';
      document.getElementById('taskContainer').innerHTML = `
      <div class="text-secondary">
        <ol>
          <li>Open a project work folder</li>
          <li>Provide task details in the chat input to start a new task</li>
          <li>Keep the task small</li>
        </ol>
      </div>`;
      this.contextFilesContainer.innerHTML = '';
      return;
    }

    const displayTitle =
      taskTitle || (task.split(' ').length > 4 ? task.split(' ').slice(0, 4).join(' ') + '...' : task);
    document.getElementById('taskTitle').innerHTML = displayTitle;
    document.getElementById('taskContainer').innerHTML = marked.parse(encode(task));
  }
}

module.exports = TaskTab;
