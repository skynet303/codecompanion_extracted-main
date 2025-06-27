const klaw = require('klaw');
const ignore = require('ignore');
const fs = require('graceful-fs');
const path = require('path');
const ccignoreTemplate = require('../static/embeddings_ignore_patterns');

function relativePath(filePath) {
  const normalizedPath = path.normalize(filePath);
  const normalizedProject = path.normalize(chatController.agent.projectController.currentProject.path);
  
  if (!path.isAbsolute(normalizedPath)) {
    return normalizedPath;
  }
  
  return path.relative(normalizedProject, normalizedPath);
}

function basename(filePath) {
  return path.basename(filePath);
}

async function buildIgnoreListFromDirectory(dirPath) {
  let ignorePatterns = '';

  // Read .gitignore if exists
  const gitignorePath = path.join(dirPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ignorePatterns += fs.readFileSync(gitignorePath, 'utf8') + '\n';
  }

  // Check for .gitattributes and add LFS patterns
  const gitAttributesPath = path.join(dirPath, '.gitattributes');
  if (fs.existsSync(gitAttributesPath)) {
    const attributesContent = fs.readFileSync(gitAttributesPath, 'utf8');
    const lfsPatterns = attributesContent
      .split('\n')
      .filter(line => line.includes('filter=lfs'))
      .map(line => line.split(' ')[0].trim());
      
    if (lfsPatterns.length > 0) {
      ignorePatterns += lfsPatterns.join('\n') + '\n';
    }
  }

  // Add ccignore template patterns
  ignorePatterns += ccignoreTemplate;

  return ignore().add(
    ignorePatterns
      .split('\n')
      .filter(line => line.trim() !== '' && !line.startsWith('#'))
  );
}

async function getDirectorySize(dirPath) {
  let totalSize = 0;
  const ignoreList = await buildIgnoreListFromDirectory(dirPath);

  return new Promise((resolve, reject) => {
    klaw(dirPath, {
      filter: (item) => {
        const relativePath = item.slice(dirPath.length + 1);
        return !relativePath || !ignoreList.ignores(relativePath);
      }
    })
      .on('data', (item) => {
        if (item.stats && !item.stats.isDirectory()) {
          totalSize += item.stats.size;
        }
      })
      .on('error', (err) => {
        // Skip inaccessible paths silently
      })
      .on('end', () => resolve(totalSize));
  });
}

async function getDirectoryFiles(dirPath, maxFileSize = null, maxResults = null) {
  let files = [];
  const ignoreList = await buildIgnoreListFromDirectory(dirPath);

  return new Promise((resolve, reject) => {
    klaw(dirPath, {
      filter: (item) => {
        const relativePath = item.slice(dirPath.length + 1);
        return !relativePath || !ignoreList.ignores(relativePath);
      }
    })
      .on('data', (item) => {
        if (item.stats && !item.stats.isDirectory()) {
          if (maxFileSize === null || item.stats.size <= maxFileSize) {
            files.push({
              path: item.path,
              mtime: item.stats.mtime
            });
            
            if (maxResults && files.length >= maxResults) {
              return false;
            }
          }
        }
      })
      .on('error', (err) => {
        // Skip inaccessible paths silently
      })
      .on('end', () => {
        files.sort((a, b) => b.mtime - a.mtime);
        resolve(files.map(file => file.path));
      });
  });
}

async function getFolderStructure(dirPath, maxDepth = 1) {
  const ignoreList = await buildIgnoreListFromDirectory(dirPath);
  
  return new Promise((resolve, reject) => {
    // Store complete tree structure
    const tree = {};
    
    klaw(dirPath, { 
      depthLimit: maxDepth,
      filter: (item) => {
        const relativePath = item.slice(dirPath.length + 1);
        return !relativePath || !ignoreList.ignores(relativePath);
      }
    })
      .on('data', (item) => {
        const relativePath = item.path.slice(dirPath.length + 1);
        if (relativePath) {
          const pathParts = relativePath.split(path.sep);
          let currentLevel = tree;
          
          // Build tree structure
          pathParts.forEach((part, index) => {
            if (!currentLevel[part]) {
              currentLevel[part] = {
                isDirectory: index === pathParts.length - 1 ? item.stats.isDirectory() : true,
                children: {}
              };
            }
            currentLevel = currentLevel[part].children;
          });
        }
      })
      .on('error', (err) => {
        // Skip inaccessible paths silently
      })
      .on('end', () => {
        const structure = [];
        
        // Recursive function to build the output
        function buildStructure(node, prefix = '', level = 0) {
          const entries = Object.entries(node)
            .sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
            
          for (const [name, data] of entries) {
            structure.push(`${prefix}- ${name}${data.isDirectory ? '/' : ''}`);
            if (Object.keys(data.children).length > 0) {
              buildStructure(data.children, prefix + '  ', level + 1);
            }
          }
        }
        
        buildStructure(tree);
        
        if (structure.length === 0) {
          resolve('The directory is empty.');
        } else {
          resolve(structure.join('\n'));
        }
      });
  });
}

async function getRecentModifiedFiles(dirPath, sinceDateTime) {
  const ignoreList = await buildIgnoreListFromDirectory(dirPath);
  const recentFiles = [];

  return new Promise((resolve, reject) => {
    klaw(dirPath, {
      filter: (item) => {
        const relativePath = item.slice(dirPath.length + 1);
        return !relativePath || !ignoreList.ignores(relativePath);
      }
    })
      .on('data', (item) => {
        if (!item.stats.isDirectory()) {
          if (item.stats.mtime > sinceDateTime) {
            recentFiles.push(item.path);
          }
        }
      })
      .on('error', (err) => {
        // Skip inaccessible paths silently
      })
      .on('end', () => {
        const sortedFiles = recentFiles.filter(filePath => {
          try {
            return fs.existsSync(filePath);
          } catch (error) {
            return false;
          }
        }).sort((a, b) => {
          try {
            return fs.statSync(b).mtime - fs.statSync(a).mtime;
          } catch (error) {
            return 0;
          }
        });
        resolve(sortedFiles);
      });
  });
}

async function findSymbolInFiles(dirPath, symbol) {
  const files = [];
  const ignoreList = await buildIgnoreListFromDirectory(dirPath);
  const regex = new RegExp(`\\b${symbol}\\b`, 'g');

  return new Promise((resolve, reject) => {
    klaw(dirPath, {
      filter: (item) => {
        const relativePath = item.slice(dirPath.length + 1);
        return !relativePath || !ignoreList.ignores(relativePath);
      }
    })
      .on('data', (item) => {
        if (!item.stats.isDirectory()) {
          if (/\.(js|jsx|ts|tsx|vue|py|rb|java|cpp|h|css|scss|json|html)$/.test(item.path)) {
            try {
              const content = fs.readFileSync(item.path, 'utf8');
              if (regex.test(content)) {
                files.push(item.path);
              }
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      })
      .on('error', (err) => {
        // Skip inaccessible paths silently
      })
      .on('end', () => resolve(files));
  });
}

module.exports = {
  getDirectorySize,
  getDirectoryFiles,
  buildIgnoreListFromDirectory,
  getFolderStructure,
  relativePath,
  basename,
  getRecentModifiedFiles,
  findSymbolInFiles,
};
