const os = require('os');
const fs = require('graceful-fs');
const path = require('path');
const { _, debounce } = require('lodash');
const { ipcRenderer, shell } = require('electron');
const ElectronStore = require('electron-store');

const ViewController = require('./app/view_controller');
const ChatController = require('./app/chat_controller');
const OnboardingController = require('./app/onboarding_controller');
// const AuthController = require('./app/auth/auth_controller'); // REMOVED: Auth disabled
// const AuthModal = require('./app/auth/auth_modal'); // REMOVED: Auth disabled

const { processFile, handleDrop } = require('./app/chat/file_handler');
const { MODEL_OPTIONS } = require('./app/static/models_config');

const localStorage = new ElectronStore();
const cache = new Map();
// const authController = new AuthController(); // REMOVED: Auth disabled
let chatController; // Will be initialized after DOM is ready
let viewController; // Will be initialized after DOM is ready  
let onboardingController; // Will be initialized after DOM is ready

// let authModal; // REMOVED: Auth disabled
let isAuthCheckComplete = false;

const isWindows = process.platform === 'win32';
const isDevelopment = process.env.NODE_ENV === 'development';
let dataPath;

// Register IPC events listeners
ipcRenderer.on('read-files', async (event, file) => {
  const { filePaths } = file;
  for (const filePath of filePaths) {
    processFile(filePath);
  }
});

ipcRenderer.on('directory-data', async (event, file) => {
  const { filePaths } = file;
  if (filePaths.length > 0 && chatController) {
    chatController.agent.projectController.openProject(filePaths[0]);
  }
});

ipcRenderer.on('app-info', (event, data) => {
  const { version, userDataPath } = data;
  dataPath = userDataPath;
  document.getElementById('appVersion').innerText = version;
});

ipcRenderer.on('file-error', (event, errMessage) => {
  alert(`An error occurred reading the file: ${errMessage}`);
});

ipcRenderer.on('save-shortcut-triggered', () => {
  if (chatController) {
    chatController.chat.history.showModal();
  }
});

ipcRenderer.on('refresh-browser', () => {
  if (chatController) {
    chatController.browser.reload();
  }
});

ipcRenderer.on('open-url-in-browser', (event, url) => {
  if (chatController) {
    chatController.browser.loadUrl(url);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize controllers after DOM is ready
  chatController = new ChatController();
  viewController = new ViewController();
  onboardingController = new OnboardingController();
  
  // Initialize UI components that depend on DOM
  chatController.initializeUIComponents();
  
  // Set up event listeners that depend on DOM elements
  const debouncedSubmit = debounce(chatController.processMessageChange, 100);
  document.getElementById('messageInput').addEventListener('keydown', debouncedSubmit);
  
  document.getElementById('reject_button').addEventListener('click', function () {
    chatController.agent.userDecision = 'reject';
  });

  document.getElementById('approve_button').addEventListener('click', function () {
    chatController.agent.userDecision = 'approve';
  });

  document.getElementById('approve_and_pause_button').addEventListener('click', function () {
    chatController.agent.userDecision = 'approve_and_pause';
  });
  
  // Set up paste handler
  document.getElementById('messageInput').addEventListener('paste', function(event) {
    event.preventDefault();
    
    const clipboardData = event.clipboardData || window.clipboardData;
    const pastedText = clipboardData.getData('text');
    
    if (pastedText && pastedText.trim()) {
      const textarea = event.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = textarea.value;
      
      const formattedText = pastedText.includes('\n') ? `\`\`\`\n${pastedText}\n\`\`\`` : pastedText;
      const newValue = currentValue.substring(0, start) + formattedText + currentValue.substring(end);
      
      textarea.value = newValue;
      
      const newCursorPosition = start + formattedText.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      
      const autosize = require('autosize');
      autosize.update(textarea);
    }
  });
  
  // Authentication bypassed - initialize app directly
  isAuthCheckComplete = true;
  initializeApp();
});

ipcRenderer.on('download-logs', () => {
  if (chatController) {
    const chatLogs = chatController.chatLogs;
    const chatLogsData = JSON.stringify(chatLogs, null, 2);
    const blob = new Blob([chatLogsData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chat_logs.json';
    link.click();
  }
});

// Open links in actual web browser not in app
document.addEventListener('click', (event) => {
  viewController.handleClick(event);
});

function initializeApp() {
  viewController.renderModelDropdowns();
  viewController.initializeUIFormatting();
  viewController.handlePanelResize();
  chatController.clearChat();
  onboardingController.showAllTips();
  chatController.customModelsManager.render();
}
