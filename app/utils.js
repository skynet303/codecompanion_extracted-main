const isTextOrBinary = require('istextorbinary');
const readChunkSync = require('read-chunk').sync;
const { getEncoding } = require('js-tiktoken');
const path = require('path');
const fs = require('graceful-fs');
const tokenizer = getEncoding('cl100k_base');
const { relativePath } = require('./lib/fileOperations');
const contextCache = require('./lib/context-cache');
const { ipcRenderer } = require('electron');

const MAX_ALLOWED_FILE_SIZE = 100000;

async function readCodeFile(filePath) {
  try {
    const normalizedPath = await normalizedFilePath(filePath);
    
    // Try to get from cache first
    const cached = contextCache.get(normalizedPath);
    if (cached && cached.content) {
      // Verify file hasn't changed
      const stats = fs.statSync(normalizedPath);
      if (stats.mtime.getTime() === cached.mtime) {
        return cached.content;
      }
    }
    
    if (!fs.existsSync(normalizedPath)) {
      return {
        content: null,
        error: `File with filepath '${normalizedPath}' does not exist`
      };
    }
    
    if (!isTextFile(normalizedPath)) {
      return {
        content: null,
        error: `File with filepath '${normalizedPath}' is not a text file`
      };
    }

    const stats = fs.statSync(normalizedPath);
    if (stats.size > MAX_ALLOWED_FILE_SIZE) {
      return {
        content: null,
        error: `File with filepath '${normalizedPath}' is too large to read`
      };
    }
    
    // Use cached read method
    const fileData = await contextCache.readFile(normalizedPath);
    return fileData.content;
  } catch (error) {
    console.error(`Error reading code file: ${error.message}`);
    return {
      content: null,
      error: `Error reading code file: ${error.message}`
    };
  }
}

async function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Operation timed out after ${ms} ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

async function withErrorHandling(fn, ...args) {
  try {
    return await fn(...args);
  } catch (error) {
    console.error(error);
    const errorMessage =
      typeof error === 'object' && error !== null && 'message' in error
        ? error.message
        : typeof error === 'object'
        ? JSON.stringify(error)
        : String(error);

    chatController.chat.addFrontendMessage('error', `Error occurred. ${errorMessage}`);
  }
}

function getFriendlyOSName() {
  const osType = os.type();

  if (osType === 'Darwin') {
    return 'macOS';
  }
  if (osType === 'Windows_NT') {
    return 'Windows' + ` ${getWindowsVersion()}`;
  }
  if (osType === 'Linux') {
    return 'Linux';
  }
  return osType; // Default to the technical OS type name
}

function getWindowsVersion() {
  const release = os.release().split('.');
  // for Windows 10 and 11 the major version is 10
  if (parseInt(release[0]) === 10) {
    if (parseInt(release[2]) >= 22000) {
      // Windows 11
      return 'Windows 11';
    }
    // Windows 10
    return 'Windows 10';
  }
  if (parseInt(release[0]) === 6) {
    switch (parseInt(release[1])) {
      case 3:
        // Windows 8.1
        return 'Windows 8.1';
      case 2:
        // Windows 8
        return 'Windows 8';
      case 1:
        // Windows 7
        return 'Windows 7';
      case 0:
        // Windows Vista
        return 'Windows Vista';
      default:
        return 'Windows';
    }
  }
  // if the OS is not identified or it's not Windows, then return the full release version
  return '';
}

function getSystemInfo() {
  const osName = getFriendlyOSName();
  const osVersion = os.release(); // Returns the operating system version
  const osArch = os.arch(); // Returns the processor architecture

  const systemInfo = `${osName} (Release: ${osVersion}) architecture ${osArch}`;
  return systemInfo;
}

function isTextFile(fileName) {
  const buffer = readChunkSync(fileName, 0, 4100);
  return isTextOrBinary.isText(fileName, buffer);
}

async function normalizedFilePath(targetFile) {
  targetFile = path.normalize(targetFile);
  if (path.isAbsolute(targetFile)) {
    return targetFile;
  }
  await chatController.terminalSession.getCurrentDirectory();
  return path.resolve(chatController.agent.currentWorkingDir, targetFile);
}

async function isFileExists(filePath) {
  const normalizedPath = await normalizedFilePath(filePath);
  return fs.existsSync(normalizedPath);
}

async function isFileEmpty(filePath) {
  try {
    const normalizedPath = await normalizedFilePath(filePath);
    if (!fs.existsSync(normalizedPath)) {
      return false;
    }
    const stats = await fs.promises.stat(normalizedPath);
    return stats.size === 0;
  } catch (error) {
    return false;
  }
}

function log(...args) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (isDevelopment) {
    console.log(...args);
  }
  chatController.chatLogs.push(args);
}

// Terminal logging function - sends logs to main process to appear in terminal
function terminalLog(message, ...args) {
  // Also log to console for dev tools
  console.log(message, ...args);
  
  // Send to main process to appear in terminal
  ipcRenderer.send('terminal-log', {
    level: 'log',
    message: message,
    args: args
  });
}

// Terminal error logging
function terminalError(message, ...args) {
  console.error(message, ...args);
  
  ipcRenderer.send('terminal-log', {
    level: 'error',
    message: message,
    args: args
  });
}

// Terminal warning logging
function terminalWarn(message, ...args) {
  console.warn(message, ...args);
  
  ipcRenderer.send('terminal-log', {
    level: 'warn',
    message: message,
    args: args
  });
}

function getTokenCount(content) {
  return tokenizer.encode(JSON.stringify(content) || '').length;
}

async function openFileLink(filepath) {
  try {
    const filename = relativePath(filepath);
    const normalizedProject = path.normalize(chatController.agent.projectController.currentProject.path);
    const absolutePath = path.isAbsolute(filepath) ? filepath : path.join(normalizedProject, filename);
    const escapedPath = absolutePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<a href="#" 
      onclick="event.preventDefault(); viewController.openFileInIDE('${escapedPath}')"
      data-bs-toggle="tooltip"
      title="Click to open file in IDE"
      class="file-link">${filename}</a>`;
  } catch (error) {
    console.error(error);
    return filepath;
  }
}

function fromTemplate(content, placeholder, value) {
  const regex = new RegExp(placeholder, 'g');
  return content.replace(regex, value);
}

function getCountryFromLocale() {
  const locale = navigator.language || navigator.userLanguage
  const parts = locale.split('-')
  if (parts.length > 1) {
    return parts[1]
  }
  return null
}

module.exports = {
  withTimeout,
  withErrorHandling,
  log,
  terminalLog,
  terminalError,
  terminalWarn,
  getSystemInfo,
  isTextFile,
  normalizedFilePath,
  isFileExists,
  isFileEmpty,
  getTokenCount,
  openFileLink,
  fromTemplate,
  readCodeFile,
  getCountryFromLocale
};
