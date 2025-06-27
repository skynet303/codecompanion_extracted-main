const {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  dialog,
  shell,
  systemPreferences,
  nativeTheme,
} = require('electron');
const electronLocalShortcut = require('electron-localshortcut');

app.setName('CodeCompanion.AI');
// const { autoUpdater } = require('electron-updater'); // REMOVED: Auto-updater disabled
const path = require('path');
const ElectronStore = require('electron-store');
const pty = require('node-pty');
const { debounce } = require('lodash');
// const { initialize } = require('@aptabase/electron/main'); // REMOVED: DAU tracking disabled
const WindowManager = require('./app/window_manager');
const remoteMain = require('@electron/remote/main');

const MEMORY_LIMIT = 4096;

ElectronStore.initRenderer();
const localStorage = new ElectronStore();
remoteMain.initialize();

let win;
let isUpdateInProgress = false;
let terminal;
let windowManager;

if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
  setTimeout(() => {
    win.webContents.openDevTools();
  }, 3000);
}
// initialize('A-US-5249376059'); // REMOVED: Analytics disabled

// Setup local shortcuts
function setupLocalShortcuts() {
  const shortcuts = [
    { key: 'CmdOrCtrl+M', action: () => windowManager.minimize() },
    { key: 'CmdOrCtrl+Alt+F', action: () => windowManager.maximize() },
    { key: 'F11', action: () => windowManager.toggleFullScreen() },
    { key: 'CmdOrCtrl+W', action: () => windowManager.close() },
    { key: 'Alt+Space', action: () => win.show() },
    { key: 'CmdOrCtrl+R', action: () => win.webContents.send('refresh-browser') },
    { key: 'CmdOrCtrl+C', action: () => win.webContents.copy() },
    { key: 'CmdOrCtrl+X', action: () => win.webContents.cut() },
  ];

  // Add Mac-specific shortcuts
  if (process.platform === 'darwin') {
    shortcuts.push({ key: 'Cmd+Ctrl+F', action: () => windowManager.toggleFullScreen() });
  }

  // Add Windows-specific shortcuts
  if (process.platform === 'win32') {
    shortcuts.push({ key: 'Alt+Space', action: () => windowManager.showSystemMenu() });
  }

  function registerShortcuts() {
    shortcuts.forEach(({ key, action }) => {
      electronLocalShortcut.register(win, key, action);
    });
  }

  function unregisterShortcuts() {
    electronLocalShortcut.unregisterAll(win);
  }

  win.on('focus', registerShortcuts);
  win.on('blur', unregisterShortcuts);

  // Initial registration
  registerShortcuts();
}

function createWindow() {
  const { screen } = require('electron');
  let { width, height, x, y } = localStorage.get('windowBounds') || {};
  if (!width || !height) {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    screenWidth > 1400 ? (width = 1400) : (width = Math.floor(screenWidth * 0.8));
    screenHeight > 1080 ? (height = 1080) : (height = Math.floor(screenHeight * 0.8));
    localStorage.set('windowBounds', { width, height });
  }
  win = new BrowserWindow({
    show: false,
    width,
    height,
    x,
    y,
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile('index.html');
  remoteMain.enable(win.webContents);

  // Initialize WindowManager
  windowManager = new WindowManager(win);

  // Setup local shortcuts
  setupLocalShortcuts();

  win.once('ready-to-show', () => {
    win.show();
  });

  const menuTemplate = [
    {
      label: 'CodeCompanion.AI',
      submenu: [
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+O',
          click() {
            win.webContents.executeJavaScript('viewController.selectDirectory();');
          },
        },
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click() {
            win.webContents.executeJavaScript('chatController.clearChat()');
          },
        },
        {
          label: 'Save Chat',
          accelerator: 'CmdOrCtrl+S',
          click() {
            win.webContents.send('save-shortcut-triggered');
          },
        },
        {
          label: 'Download Logs',
          accelerator: 'CmdOrCtrl+L',
          click() {
            win.webContents.send('download-logs');
          },
        },
        // REMOVED: Check for Updates (auto-updater disabled)
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click() {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          click: () => windowManager.minimize(),
        },
        {
          label: 'Maximize',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => windowManager.maximize(),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => windowManager.toggleFullScreen(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  win.on('show', () => {
    win.webContents.executeJavaScript('viewController.onShow()');
    // REMOVED: Auto-updater check disabled
  });

  win.on('focus', () => {
    win.webContents.executeJavaScript('viewController.onShow()');
  });

  win.on('closed', () => {
    win = null;
  });

  function saveWindowState() {
    const { width, height, x, y } = win.getBounds();
    localStorage.set('windowBounds', {
      width,
      height,
      x,
      y,
    });
    win.webContents.executeJavaScript('chatController.terminalSession.resizeTerminalWindow()');
  }

  win.on(
    'resize',
    debounce(() => {
      saveWindowState();
    }, 200)
  );
  win.on(
    'move',
    debounce(() => {
      saveWindowState();
    }, 200)
  );

  win.webContents.on('did-finish-load', () => {
    const version = app.getVersion();
    const userDataPath = app.getPath('userData');
    win.webContents.send('app-info', { version, userDataPath });
    win.webContents.executeJavaScript('viewController.onShow()');
  });

  // REMOVED: All auto-updater functionality disabled
}

app.whenReady().then(() => {
  createWindow();
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Send URL to renderer to open in internal browser
    contents.send('open-url-in-browser', url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, navigationUrl) => {
    // Prevent navigation and handle in internal browser
    if (!navigationUrl.startsWith('file://')) {
      event.preventDefault();
      contents.send('open-url-in-browser', navigationUrl);
    }
  });

  contents.on('new-window', (event, url) => {
    event.preventDefault();
    contents.send('open-url-in-browser', url);
  });
});

async function openDirectory(sender) {
  try {
    const mainWindow = BrowserWindow.fromWebContents(sender);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });

    sender.send('directory-data', { filePaths: result.filePaths });
  } catch (err) {
    console.error(err);
  }
}

async function openFile(sender) {
  try {
    const mainWindow = BrowserWindow.fromWebContents(sender);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      sender.send('read-files', { filePaths: result.filePaths });
    }
  } catch (err) {
    console.error(err);
  }
}

app.on('window-all-closed', () => {
  // autoUpdater.removeAllListeners(); // REMOVED: Auto-updater disabled

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

ipcMain.on('open-file-dialog', (event) => {
  openFile(event.sender);
});

ipcMain.on('open-directory', (event) => {
  openDirectory(event.sender);
});

// Shell

ipcMain.on('start-shell', (event, args) => {
  if (terminal) {
    terminal.kill();
    terminal = null;
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'zsh' : 'bash';
  const shell_args = process.platform === 'win32' ? [] : ['-l'];

  terminal = pty.spawn(shell, shell_args, {
    name: 'xterm-256color',
    cwd: args.cwd,
    env: process.env,
  });

  const shellName = path.basename(shell);
  event.sender.send('shell-type', shellName);

  terminal.on('data', (data) => {
    event.sender.send('shell-data', data);
  });
});

ipcMain.on('kill-shell', () => {
  if (terminal) {
    terminal.kill();
    terminal = null;
  }
});

ipcMain.on('write-shell', (event, args) => {
  if (terminal) {
    terminal.write(args);
  }
});

ipcMain.on('execute-command', (event, command) => {
  let shell, shellArgs;

  if (process.platform === 'win32') {
    shell = 'powershell.exe';
    shellArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& {${command}}`];
  } else {
    shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
    shellArgs = ['-l', '-c', command];
  }

  const tempTerminal = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cwd: process.cwd(),
    env: process.env,
  });

  tempTerminal.on('data', (data) => {
    event.sender.send('command-output', data);
  });

  tempTerminal.on('exit', (exitCode) => {
    event.sender.send('command-exit', exitCode);
    tempTerminal.kill();
  });
});

ipcMain.on('resize-shell', (event, data) => {
  if (terminal) {
    terminal.resize(data.cols, data.rows);
  }
});

app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${MEMORY_LIMIT}`);
app.commandLine.appendSwitch('max-memory', MEMORY_LIMIT);
app.commandLine.appendSwitch('renderer-process-memory-limit', MEMORY_LIMIT);
app.commandLine.appendSwitch('renderer-js-flags', `--max-old-space-size=${MEMORY_LIMIT}`);

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Unhandled Error: ', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection: ', promise, ' reason: ', reason);
});