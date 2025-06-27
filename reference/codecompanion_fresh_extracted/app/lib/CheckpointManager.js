const fs = require('graceful-fs');
const path = require('path');
const { app } = require('@electron/remote');

const ccignoreTemplate = require('../static/embeddings_ignore_patterns');
const { getDirectorySize } = require('./fileOperations');

const MAXIMUM_ALLOWED_PROJECT_SIZE = 1 * 1024 * 1024 * 1024; // 5GB in bytes

class CheckpointManager {
  constructor(project) {
    this.folderPath = path.resolve(project.path);
    if (!fs.existsSync(this.folderPath)) {
      throw new Error(`Folder "${this.folderPath}" does not exist.`);
    }
    
    this.shadowDir = path.join(app.getPath('userData'), 'projects', project.name, 'checkpoints');
    if (!fs.existsSync(this.shadowDir)) {
      fs.mkdirSync(this.shadowDir, { recursive: true });
    }
    this.gitDir = path.join(this.shadowDir, '.git');
    this.initialized = false;
    this._simpleGit = null;
    this.isAllowedForProject = null;
  }

  get simpleGit() {
    if (!this._simpleGit) {
      this._simpleGit = require('simple-git');
    }
    return this._simpleGit;
  }

  async isEnabled() {
    if (!chatController.settings.enableCheckpoints) {
      return false;
    }

    if (this.isAllowedForProject !== null) {
      return this.isAllowedForProject;
    }
    
    const homedir = require('os').homedir();
    const sensitiveDirectories = [
      homedir,
      path.join(homedir, 'Desktop'),
      path.join(homedir, 'Documents'),
      path.join(homedir, 'Downloads')
    ];
    
    const isSensetiveDierectory = sensitiveDirectories.includes(this.folderPath);
    const size = await getDirectorySize(this.folderPath);
    this.isAllowedForProject = !isSensetiveDierectory && (size < MAXIMUM_ALLOWED_PROJECT_SIZE);
    return this.isAllowedForProject;
  }

  async getGitignore() {
    let gitignoreContent = '';
    
    if (fs.existsSync(path.join(this.folderPath, '.gitignore'))) {
      gitignoreContent = fs.readFileSync(path.join(this.folderPath, '.gitignore'), 'utf8');
    }

    // Add LFS patterns to gitignore
    const attributesPath = path.join(this.folderPath, '.gitattributes');
    if (fs.existsSync(attributesPath)) {
      const attributesContent = fs.readFileSync(attributesPath, 'utf8');
      const lfsPatterns = attributesContent
        .split('\n')
        .filter(line => line.includes('filter=lfs'))
        .map(line => line.split(' ')[0].trim());
      
      // Add LFS patterns to gitignore
      if (lfsPatterns.length > 0) {
        gitignoreContent += '\n' + lfsPatterns.join('\n');
      }
    }   

    return gitignoreContent + '\n' + ccignoreTemplate;
  }

  async init() {
    if (!(await this.isEnabled())) {
      return;
    }

    try {
      await this.simpleGit().version();
    } catch (error) {
      throw new Error('Git must be installed to use checkpoints.');
    }

    if (!fs.existsSync(this.shadowDir)) {
      await fs.promises.mkdir(this.shadowDir, { recursive: true });
    }

    // do this every time
    const ignoreContent = await this.getGitignore();
    await fs.promises.writeFile(path.join(this.shadowDir, '.gitignore'), ignoreContent, 'utf8');
    
    const git = this.simpleGit(this.shadowDir);
    this.git = git;
    
    if (!fs.existsSync(this.gitDir)) {
      await git.init();
      await git.addConfig('core.worktree', this.folderPath);
      await git.addConfig('commit.gpgSign', 'false');
      await git.addConfig('user.name', 'CodeCompanion');
      await git.addConfig('user.email', 'hello@codecompanion.ai');
      await this.create('Initial commit');
    }
    
    this.initialized = true;
  }

  async create(toolId) {
    if (!(await this.isEnabled())) {
      return;
    }
    if (!this.initialized) await this.init();

    try {
      await this.git.add('.');
      const commitResult = await this.git.commit(toolId, { '--allow-empty': null });
      return commitResult.commit;
    } catch (err) {
      console.error('Error creating checkpoint:', err);
      // Handle the specific error about no commits yet
      if (err.message && err.message.includes("does not have any commits yet")) {
        try {
          // Force an initial commit with --allow-empty flag
          console.log('Attempting to create initial commit...');
          const commitResult = await this.git.commit(toolId, { '--allow-empty': null });
          return commitResult.commit;
        } catch (retryErr) {
          throw new Error('Failed to create initial commit: ' + retryErr.message);
        }
      } else {
        throw new Error('Error creating checkpoint: ' + err.message);
      }
    }
  }

  async restore(toolId) {
    if (!(await this.isEnabled())) {
      return;
    }
    
    if (!this.initialized) await this.init();
    
    try {
      // First check if we have any commits
      try {
        await this.git.raw(['rev-parse', '--verify', 'HEAD']);
      } catch (error) {
        if (error.message && (
            error.message.includes("does not have any commits yet") || 
            error.message.includes("unknown revision") || 
            error.message.includes("ambiguous argument 'HEAD'"))) {
          throw new Error('Cannot restore: repository has no commits yet');
        }
        throw error;
      }

      const logResult = await this.git.log();
      const targetCommit = logResult.all.find(entry => entry.message === toolId);
      
      if (!targetCommit) {
        throw new Error(`No checkpoint found for tool ${toolId}`);
      }

      await this.git.clean('f', ['-d', '-f']);
      await this.git.reset(['--hard', targetCommit.hash]);
      
      // Delete one message higher than the current one
      chatController.chat.deleteAfterToolCall(toolId);
    } catch (err) {
      console.error('Error restoring checkpoint:', err);
      throw new Error('Error restoring checkpoint: ' + err.message);
    }
  }

  async list() {
    if (!this.initialized) await this.init();
    try {
      // First check if we have any commits
      try {
        await this.git.raw(['rev-parse', '--verify', 'HEAD']);
      } catch (error) {
        if (error.message && (
            error.message.includes("does not have any commits yet") || 
            error.message.includes("unknown revision") || 
            error.message.includes("ambiguous argument 'HEAD'"))) {
          return "No checkpoints available yet. Repository has no commits.";
        }
        throw error;
      }

      const logResult = await this.git.log();
      return logResult.all
        .map(entry => `${entry.hash.substring(0, 7)} ${entry.message}`)
        .join('\n');
    } catch (err) {
      console.error('Error listing checkpoints:', err);
      throw new Error('Error listing checkpoints: ' + err.message);
    }
  }

  async cleanup() {
    if (fs.existsSync(this.shadowDir)) {
      try {
        await fs.promises.rm(this.shadowDir, { recursive: true, force: true });
      } catch (err) {
        await fs.promises.rmdir(this.shadowDir, { recursive: true });
      }
    }
  }
}

module.exports = CheckpointManager;