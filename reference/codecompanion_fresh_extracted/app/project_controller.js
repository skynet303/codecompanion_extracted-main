const fs = require('graceful-fs');
const CryptoJS = require('crypto-js');
const pathModule = require('path');
const Store = require('electron-store');
const CodeEmbeddings = require('./tools/code_embeddings');
const { EMBEDDINGS_VERSION } = require('./static/models_config');
const CheckpointManager = require('./lib/CheckpointManager');
const fileOperations = require('./lib/fileOperations');
const ResearchAgent = require('./chat/planner/researchAgent');
const { researchItems } = require('./chat/planner/researchItems');
const LARGE_FILE_SIZE = 50000;
const PROJECT_STRUCTURE_ROWS_COUNT = 50;
const addInstructionsModal = new bootstrap.Modal(document.getElementById('addInstructionsModal'));

class ProjectController {
  constructor(currentProject) {
    this.currentProject = null;
    this.getProjects();
    this.openProject(currentProject?.path);
    this.filesList = [];
    this.shadowGit = null;
    this.projectOverview = null;
  }

  async openProject(path) {
    this.currentProject = null;
    this.projectOverview = null;
    this.embeddings = null;
    this.filesList = [];
    this.checkpoints = null;
    if (!path) {
      return;
    }

    chatController.abortAllProcesses();

    if (!fs.existsSync(path)) {
      chatController.chat.addFrontendMessage('error', `The path '${path}' does not exist.`);
      return;
    }

    let project = this.projects.find((project) => project.path === path);
    if (!project) {
      let projectName = pathModule.basename(path);
      if (this.projects.find((project) => project.name === projectName)) {
        let i = 1;
        while (this.projects.find((project) => project.name === `${projectName} (${i})`)) {
          i++;
        }
        projectName = `${projectName} (${i})`;
      }
      project = this.saveProject(projectName, path, '');
    } else {
      this.updateProject(project);
    }

    this.currentProject = project;
    this.checkpoints = new CheckpointManager(project);
    this.checkpoints.init().catch(err => {
      console.error('Failed to initialize CheckpointManager:', err);
    });
    if (chatController.terminalSession.terminal) {
      await chatController.terminalSession.navigateToDirectory(path);
      chatController.terminalSession.clearTerminal();
    } else {
      console.error('No terminal session');
    }
    document.title = project.name + ' - CodeCompanion';
    viewController.showWelcomeContent();
    viewController.toogleChatInputContainer();
    await this.createEmbeddings();
    this.getProjectOverview();
  }

  async getProjectOverview() {
    const researchAgent = new ResearchAgent(chatController, '');
    const projectOverview = researchItems.find((item) => item.name === 'project_overview');
    const result = await researchAgent.executeResearch(projectOverview);
    this.projectOverview = result;
  }

  getProjects() {
    this.projects = [];
    const projects = localStorage.get('projects', []);
    projects.forEach((project) => {
      if (fs.existsSync(pathModule.normalize(project.path))) {
        this.projects.push(project);
      } else {
        localStorage.delete(`project.${project.name}`);
        this.embeddings?.delete();
      }
    });
    this.projects = this.projects.sort((a, b) => new Date(b.lastOpened) - new Date(a.lastOpened));
    localStorage.set('projects', this.projects);
    this.clearOldEmbeddings();
    return this.projects;
  }

  async clearOldEmbeddings() {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.projects.forEach((project) => {
          localStorage.delete(`project.${project.name}.embeddings`);
        });
        resolve();
      }, 0);
    });
  }

  saveProject(name, path, filesHash) {
    const project = { name, path, lastOpened: new Date(), filesHash };
    this.projects.push(project);
    localStorage.set('projects', this.projects);
    return project;
  }

  updateProject(project) {
    project.lastOpened = new Date();
    this.projects = this.projects.map((p) => (p.path === project.path ? project : p));
    localStorage.set('projects', this.projects);
  }

  async updateListOfFiles() {
    this.filesList = [];
    if (!this.currentProject?.path) return;
    
    try {
      this.filesList = await fileOperations.getDirectoryFiles(
        this.currentProject.path, 
        LARGE_FILE_SIZE
      );
    } catch (err) {
      console.error('Failed to update list of files:', err);
    }
  }

  showInstructionsModal(path) {
    let project = this.projects.find((project) => project.path === path);

    if (project) {
      addInstructionsModal.show();
      let instructions = localStorage.get(`project.${project.name}.instructions`, '');
      document.getElementById('customInstructions').value = instructions;
      this.instructionsProjectName = project.name;
    } else {
      viewController.updateFooterMessage('Project not found');
    }
  }

  saveInstructions() {
    const instructions = document.getElementById('customInstructions').value;
    localStorage.set(`project.${this.instructionsProjectName}.instructions`, instructions);
    addInstructionsModal.hide();
  }

  getCustomInstructions() {
    if (!this.currentProject) return;

    const instructions = localStorage.get(`project.${this.currentProject.name}.instructions`, '');
    
    let cursorRules = '';
    try {
      const cursorRulesPath = path.join(this.currentProject.path, '.cursorrules');
      if (fs.existsSync(cursorRulesPath)) {
        cursorRules = fs.readFileSync(cursorRulesPath, 'utf8');
      }
    } catch (err) {
      console.error('Error reading .cursorrules file:', err);
    }
    
    const combinedInstructions = [instructions, cursorRules].filter(Boolean).join('\n\n');
    return combinedInstructions ? '\n\n' + combinedInstructions : '';
  }

  async createEmbeddings() {
    if (!this.currentProject) return;

    if (!this.embeddings) {
      this.embeddings = new CodeEmbeddings(this.currentProject.name, this);
      await this.embeddings.load();
    }

    const filesHash = await this.getFilesHash();
    if (filesHash === this.currentProject.filesHash) {
      return;
    }

    const maxFilesToEmbed = chatController.settings.maxFilesToEmbed;

    if (this.filesList.length > maxFilesToEmbed) {
      this.filesList = this.filesList.slice(0, maxFilesToEmbed);
    }

    await this.embeddings.updateEmbeddingsForFiles(this.filesList);
    this.currentProject.filesHash = filesHash;
    this.updateProject(this.currentProject);
  }

  async searchEmbeddings({ query, count = 10, filenamesOnly = false }) {
    if (!this.currentProject) {
      chatController.chat.addFrontendMessage('error', `No project is open. To use search, open a project first.`);
      return;
    }

    const results = await this.embeddings.search({ query, limit: count, filenamesOnly });
    return results;
  }

  countFiles() {
    const pathSeparator = isWindows ? '\\' : '/';
    const folderCount = {};

    this.filesList.forEach((file) => {
      const formattedFilePath = pathModule.relative(this.currentProject.path, file);
      const pathParts = formattedFilePath.split(pathSeparator);

      let folderPath = '';
      for (let i = 0; i < pathParts.length - 1; i++) {
        // Iterate through all folders in the path
        folderPath += (i > 0 ? pathSeparator : '') + pathParts[i];
        folderCount[folderPath] = (folderCount[folderPath] || 0) + 1;
      }
    });

    return Object.entries(folderCount)
      .sort((a, b) => b[1] - a[1]) // Sort by count
      .map(([folder, count]) => `${folder}${count > 1 ? ` (${count} files)` : ''}`)
      .join('<br>');
  }

  async getFileHash(filePath) {
    const fileBuffer = await fs.promises.readFile(filePath);
    return (CryptoJS.SHA256(fileBuffer.toString()).toString() + EMBEDDINGS_VERSION);
  }

  async getFilesHash() {
    await this.updateListOfFiles();
    const hashes = await Promise.all(this.filesList.map((filePath) => this.getFileHash(filePath)));

    return (
      CryptoJS.SHA256(hashes.join('')).toString() +
      EMBEDDINGS_VERSION +
      chatController.settings.maxFilesToEmbed.toString()
    );
  }

  async getRecentModifiedFiles(sinceDateTime) {
    if (!this.currentProject) {
      return [];
    }

    const recentFiles = await fileOperations.getRecentModifiedFiles(this.currentProject.path, sinceDateTime);
    return recentFiles;
  }

  async getFolderStructure(maxDepth = 1) {
    if (!this.currentProject?.path) return;

    let structure = await fileOperations.getFolderStructure(this.currentProject.path, maxDepth);

    for (let i = 0; i < 5; i++) {
      const rowsCount = structure.split('\n').length;
      if (rowsCount < PROJECT_STRUCTURE_ROWS_COUNT) {
        structure = await fileOperations.getFolderStructure(this.currentProject.path, maxDepth + 1);
      } else {
        break;
      }
    }

    return structure;
  }
}

module.exports = ProjectController;