const path = require('path');

class RelevantFilesFinder {
  constructor() {}

  async search() {
    const message = document.getElementById('messageInput').value;
    if (!message || message.trim().length < 4) {
      document.getElementById('relevantFilesContainer').innerHTML = '';
      return;
    }

    const filesMap = await this.getRelevantFiles(message);
    this.renderRelevantFiles(filesMap);
  }

  async renderRelevantFiles(filesMap) {
    const relevantFilesContainer = document.getElementById('relevantFilesContainer');
    relevantFilesContainer.innerHTML = '';
    if (!filesMap || filesMap.size === 0) return;

    filesMap.forEach((fullPath, basename) => {
      const container = document.createElement('span');
      container.className = 'border rounded me-2 d-inline-flex align-items-center';
      container.style.fontSize = '0.65rem';

      const relativePath = fullPath.replace(chatController.agent.projectController.currentProject.path + path.sep, '');

      const button = document.createElement('button');
      button.className = 'btn btn-link btn-sm p-0 m-0 text-decoration-none d-inline-flex align-items-center';
      button.innerHTML = `${basename} <i class="bi bi-plus ms-1"></i>`;
      button.onclick = async () => {
        await chatController.chat.chatContextBuilder.contextFiles.add([fullPath], true);
        viewController.activateTab('task-tab');
        container.remove();
      };

      container.appendChild(button);
      relevantFilesContainer.appendChild(container);
    });
  }

  async getRelevantFiles(message) {
    const searchResults = await chatController.agent.projectController.searchEmbeddings({
      query: message + ' relevant files', count: 6, filenamesOnly: true,
    });

    if (!searchResults || searchResults.length === 0) {
      return [];
    }

    let fileMap = new Map();
    searchResults.forEach((filePath) => {
      const basename = path.basename(filePath);
      fileMap.set(basename, filePath);
    });

    fileMap = await this.excludeAlreadyIncludedFiles(fileMap);
    return fileMap;
  }

  async excludeAlreadyIncludedFiles(fileMap) {
    if (!fileMap) {
      return fileMap;
    }
    const includedFiles = await chatController.chat.chatContextBuilder.contextFiles.getEnabled();
    fileMap.forEach((fullPath, basename) => {
      if (includedFiles.includes(fullPath)) {
        fileMap.delete(basename);
      }
    });
    return fileMap;
  }
}

module.exports = RelevantFilesFinder;