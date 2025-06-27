const fs = require('graceful-fs');
const path = require('path');

const { relativePath, buildIgnoreListFromDirectory } = require('./fileOperations');

const MIN_CO_EDIT_THRESHOLD = 2;

class CoEditedFilesFinder {
  constructor(options = {}) {
    this.minCoEditThreshold = options.minCoEditThreshold || MIN_CO_EDIT_THRESHOLD;
    this.git = null;
    this.totalCommits = new Map();
    this.initialized = false;
    this.ignoreList = null;
  }

  async initialize() {
    if (this.initialized) return true;
    
    const projectPath = chatController.agent.projectController.currentProject.path;
    const gitPath = path.join(projectPath, '.git');
    
    if (!fs.existsSync(gitPath)) {
      return false;
    }

    try {
      const simpleGit = require('simple-git');
      this.git = simpleGit(projectPath);
      await this.git.version();
      this.ignoreList = await buildIgnoreListFromDirectory(projectPath);
      this.initialized = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  shouldIgnoreFile(filePath) {
    if (!this.ignoreList) return false;
    return this.ignoreList.ignores(filePath);
  }

  async findCoEditedFiles(targetFiles) {
    targetFiles = targetFiles.map(file => relativePath(file));
    if (!this.git && !(await this.initialize())) {
      return [];
    }

    if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
      throw new Error('Target files must be a non-empty array');
    }

    const coEditMap = new Map();
    this.totalCommits.clear();

    try {
      // Check if repository has any commits first
      try {
        const hasCommits = await this.git.raw(['rev-parse', '--verify', 'HEAD']);
        if (!hasCommits) {
          console.log('Repository exists but has no commits yet');
          return [];
        }
      } catch (error) {
        // This will catch the "fatal: ambiguous argument 'HEAD': unknown revision" error
        // which indicates there are no commits yet
        if (error.message && (
            error.message.includes("does not have any commits yet") || 
            error.message.includes("unknown revision") || 
            error.message.includes("ambiguous argument 'HEAD'"))) {
          console.log('Repository has no commits yet');
          return [];
        }
        throw error; // Re-throw if it's a different error
      }

      const log = await this.git.raw([
        'log',
        '--name-only',
        '--no-merges',
        '--pretty=format:%H'
      ]);
      
      if (!log || log.trim() === '') {
        return [];
      }
      
      const commits = log.split('\n\n')
        .filter(Boolean)
        .map(commit => {
          const [hash, ...files] = commit.split('\n').filter(Boolean);
          return { 
            hash, 
            files: files
              .filter(f => f && f.trim())
              .filter(f => !this.shouldIgnoreFile(f)) // Filter out files that match ignore patterns
          };
        });
      
      if (commits.length === 0) {
        return [];
      }
      
      for (const commit of commits) {
        for (const file of commit.files) {
          this.totalCommits.set(file, (this.totalCommits.get(file) || 0) + 1);
        }
      }

      const totalCommitsCount = commits.length;

      for (const commit of commits) {
        const hasTargetFile = commit.files.some(f => targetFiles.includes(f));
        if (!hasTargetFile) continue;

        const coEditedFiles = commit.files.filter(f => !targetFiles.includes(f));
        for (const coEditedFile of coEditedFiles) {
          const fileCommits = this.totalCommits.get(coEditedFile);
          if (fileCommits) { // Only process if we have valid commit count
            const weight = Math.log(totalCommitsCount / fileCommits);
            coEditMap.set(coEditedFile, (coEditMap.get(coEditedFile) || 0) + weight);
          }
        }
      }

      return Array.from(coEditMap.entries())
        .filter(entry => entry[0] && entry[1] >= this.minCoEditThreshold) // Filter out undefined keys
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    } catch (error) {
      console.error('Error analyzing git history:', error);
      // Return empty array instead of throwing to gracefully handle git errors
      return [];
    }
  }
}

module.exports = CoEditedFilesFinder;
