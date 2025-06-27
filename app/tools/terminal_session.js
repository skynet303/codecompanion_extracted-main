const path = require('path');
const fs = require('graceful-fs');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const { ipcRenderer, shell } = require('electron');
const { debounce } = require('lodash');
const { withTimeout, log } = require('../utils');
const RealtimeTerminalMonitor = require('../lib/realtime-terminal-monitor');

let FIXED_PROMPT = '\x91\x91\x91';
const PROMPT_TIMEOUT = 1000;

class TerminalSession {
  constructor() {
    this.terminal = null;
    this.outputData = '';
    this.commandBuffer = '';
    this.previousBuffer = '';
    this.fitAddon = new FitAddon();
    this.shellType = null;
    this.needToUpdateWorkingDir = false;
    this.sendToChatButton = null;
    this.debouncedSelectionHandler = this.debounce(this.handleSelectionChange.bind(this), 300);
    
    // Initialize missing properties
    this.terminalSessionDataListeners = [];
    this.endMarker = '<<<END_COMMAND_OUTPUT>>>';
    
    // Initialize real-time monitor
    this.realtimeMonitor = new RealtimeTerminalMonitor();
    
    // Set up event listeners for monitoring events
    this.realtimeMonitor.on('errorsDetected', ({ commandId, command, errors, immediate }) => {
      console.error(`[Terminal Monitor] Errors detected in command: ${command}`);
      errors.forEach(error => {
        console.error(`  - ${error.type}: ${error.message}`);
      });
      
      // Update UI with real-time error status
      if (viewController && immediate) {
        viewController.updateLoadingIndicator(true, 
          `⚠️ Error detected: ${errors[0].message.substring(0, 50)}...`
        );
      }
    });
    
    this.realtimeMonitor.on('commandComplete', ({ commandId, command, analysis }) => {
      if (analysis.hasErrors) {
        console.error(`[Terminal Monitor] Command failed: ${command}`);
        console.error(`  Summary: ${analysis.summary}`);
      }
    });
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  createShellSession() {
    if (!this.terminal) {
      this.createTerminal();
      this.handleTerminalResize();
    } else {
      this.interruptShellSession();
      this.clearTerminal();
    }
  }

  createTerminal() {
    this.terminal = new Terminal({
      fontFamily: 'FiraCodeNerdFont, monospace',
      fontWeight: 'normal',
      fontSize: 12,
      letterSpacing: 0,
      lineHeight: 1.25,
      rows: 48,
      windowsMode: isWindows,
      allowProposedApi: true,
      overviewRulerWidth: 20,
      theme: {
        foreground: '#c0c0c0',
        background: '#111111',
        black: '#000000',
        red: '#C51E14',
        green: '#DAA520',
        yellow: '#C7C329',
        blue: '#0A2FC4',
        magenta: '#C839C5',
        cyan: '#20C5C6',
        white: '#C7C7C7',
        lightRed: '#c0c0c0',
        lightGreen: '#20B2AA',
        lightYellow: '#708090',
        lightBlue: '#ba0e2e',
        lightMagenta: '#DAA520',
        lightCyan: '#008b8b',
        lightWhite: '#ba0e2e',
        lightBlack: '#708090',
      },
    });

    this.terminal.open(document.getElementById('terminal_output'));
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        chatController.browser.loadUrl(uri);
      }),
    );
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = '11';

    ipcRenderer.send('start-shell', {
      cwd: chatController.agent.currentWorkingDir,
    });
    ipcRenderer.on('shell-type', (event, data) => {
      this.shellType = data;
      this.setPrompt();
    });
    ipcRenderer.on('shell-data', (event, data) => {
      this.writeToTerminal(data);
    });
    this.terminal.onData((data) => this.writeToShell(data));
    
    this.createSendToChatButton();
    this.terminal.onSelectionChange(this.debouncedSelectionHandler);
  }

  clearTerminal() {
    this.writeToShell('clear\r');
    this.terminal.clear();
  }

  async setPrompt(doNotClear = false) {
    switch (this.shellType) {
      case 'bash':
        this.writeToShell(`PROMPT_COMMAND='echo -n "${FIXED_PROMPT}"'\r`);
        this.writeToShell('export BROWSER=none\r');
        break;
      case 'zsh':
        this.writeToShell(`precmd() { echo -n "${FIXED_PROMPT}"; }\r`);
        this.writeToShell('export BROWSER=none\r');
        break;
      case 'fish':
        this.writeToShell('functions --copy fish_prompt original_fish_prompt\r');
        this.writeToShell(`function fish_prompt; original_fish_prompt; echo -n "${FIXED_PROMPT}"; end\r`);
        this.writeToShell('set -x BROWSER none\r');
        break;
      case 'powershell.exe':
        FIXED_PROMPT = 'CodeCompanion.AI: ';
        this.writeToShell(`function prompt { '${FIXED_PROMPT}' + (Get-Location) + '> ' }\r`);
        this.writeToShell('$env:BROWSER = "none"\r');
        break;
      default:
        console.error(`Unsupported shell ${this.shellType}`);
    }
    if (!doNotClear) {
      setTimeout(() => {
        this.clearTerminal();
        this.resizeTerminalWindow();
      }, PROMPT_TIMEOUT);
    }
  }

  resizeTerminalWindow() {
    setTimeout(() => {
      if (this.terminal) {
        this.fitAddon.fit();
        ipcRenderer.send('resize-shell', {
          cols: this.terminal.cols,
          rows: this.terminal.rows,
        });
      }
    }, 400);
  }

  handleTerminalResize() {
    this.debounceResizeTerminalWindow = debounce(this.resizeTerminalWindow.bind(this), 200);
  }

  interruptShellSession() {
    return new Promise((resolve, reject) => {
      this.outputData = '';

      const shellDataListener = (event, data) => {
        this.outputData += data;

        if (this.isCommandFinishedExecuting(`\x03`)) {
          ipcRenderer.removeListener('shell-data', shellDataListener);

          const bufferCheckInterval = setInterval(() => {
            const currentBuffer = this.terminal.buffer.active;
            if (currentBuffer === this.previousBuffer) {
              clearInterval(bufferCheckInterval);
              resolve();
            } else {
              this.previousBuffer = currentBuffer;
            }
          }, 300);
        }
      };

      ipcRenderer.on('shell-data', shellDataListener);
      this.writeToShell(`\x03`);
    });
  }

  writeToShell(data) {
    ipcRenderer.send('write-shell', data);
  }

  writeToTerminal(data) {
    this.terminal.write(data);
    this.checkIfUserNavigatedToDifferentDirectory(data);
  }

  checkIfUserNavigatedToDifferentDirectory(data) {
    this.commandBuffer += this.removeASCII(data);
    if (data.toString().endsWith('\r') || data.toString().endsWith('\n') || data.toString().endsWith('\r\n')) {
      if (this.commandBuffer.includes(FIXED_PROMPT)) {
        const command = this.commandBuffer.split(FIXED_PROMPT).pop();
        if (command.match(/cd\s+(\S+)/i)) {
          this.needToUpdateWorkingDir = true;
        } else {
          this.needToUpdateWorkingDir = false;
        }
      }
      this.commandBuffer = '';
    }
  }

  executeCommandWithoutOutput(command) {
    ipcRenderer.send('execute-command', command, { 
      cwd: chatController.agent.currentWorkingDir 
    });
  }

  getTerminalOutput(command) {
    const buffer = this.terminal.buffer.active;
    const startLine = Math.max(buffer.length - 200, 0);
    let lines = [];
    let commandLine = 0;
    let lineNumber = 0;

    for (let i = startLine; i < buffer.length; i++) {
      const lineContent = buffer.getLine(i).translateToString(true);
      if (lineContent.trim() !== '') {
        lines.push(lineContent);
        lineNumber++;
        if (lineContent.endsWith(command)) {
          commandLine = lineNumber;
        }
      }
    }
    lines = lines.slice(commandLine, lines.length - 1);
    return lines.join('\n');
  }

  async executeShellCommand(command) {
    return new Promise((resolve, reject) => {
      let output = '';
      
      // Generate unique command ID
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Start monitoring
      this.realtimeMonitor.startMonitoring(commandId, command);
      
      const executeTimeStamp = Date.now();
      
      // Write command and end marker
      this.terminal.write(command + '\r');
      this.terminal.write(`echo "${this.endMarker}"\r`);

      const dataListener = (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Process output through real-time monitor
        this.realtimeMonitor.processOutput(commandId, chunk);
        
        if (output.includes(this.endMarker)) {
          this.terminalSessionDataListeners = this.terminalSessionDataListeners.filter(
            (listener) => listener !== dataListener
          );
          output = output.slice(0, output.lastIndexOf(this.endMarker));
          output = this.postProcessOutput(output, command, executeTimeStamp);
          
          // Complete monitoring and get final analysis
          const analysis = this.realtimeMonitor.completeMonitoring(commandId);
          
          // Store the analysis for later retrieval
          this.lastCommandAnalysis = analysis;
          
          resolve(output);
        }
      };

      this.terminalSessionDataListeners.push(dataListener);
      this.terminal.onData(dataListener);
      
      // Timeout handling with monitoring cleanup
      setTimeout(() => {
        this.terminalSessionDataListeners = this.terminalSessionDataListeners.filter(
          (listener) => listener !== dataListener
        );
        
        // Abort monitoring on timeout
        this.realtimeMonitor.abortMonitoring(commandId);
        
        reject(new Error('Command execution timeout'));
      }, 30000); // 30 second timeout
    });
  }
  
  /**
   * Post-process command output to clean up prompts and formatting
   */
  postProcessOutput(output, command, executeTimeStamp) {
    // Remove the command itself from the output
    const commandIndex = output.indexOf(command);
    if (commandIndex !== -1) {
      output = output.substring(commandIndex + command.length);
    }
    
    // Remove any prompt markers
    output = output.replace(new RegExp(FIXED_PROMPT, 'g'), '');
    
    // Clean up extra whitespace and newlines
    output = output.trim();
    
    // Handle timestamp-based filtering if needed
    return output;
  }
  
  /**
   * Get the error analysis from the last executed command
   */
  getLastCommandAnalysis() {
    return this.lastCommandAnalysis || null;
  }
  
  /**
   * Get current monitoring status
   */
  getMonitoringStatus() {
    return this.realtimeMonitor.getStatus();
  }

  isCommandFinishedExecuting(command) {
    const lastOutputDataAfterCommand = this.removeASCII(this.outputData).split(command).pop();
    return lastOutputDataAfterCommand.includes(FIXED_PROMPT);
  }

  removeASCII(data) {
    return data ? data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') : '';
  }

  async navigateToDirectory(dir) {
    await this.executeShellCommand(`cd "${dir}"`);
    chatController.agent.currentWorkingDir = dir;
    this.needToUpdateWorkingDir = false;
  }

  async getCurrentDirectory() {
    if (!this.needToUpdateWorkingDir) {
      return chatController.agent.currentWorkingDir;
    }

    let dir;
    try {
      dir = await withTimeout(await this.executeShellCommand('pwd'), 500);
    } catch (error) {
      // attempt to cancel running command first
      try {
        this.interruptShellSession();
        dir = await withTimeout(await this.executeShellCommand('pwd'), 500);
      } catch (error) {
        try {
          this.setPrompt(true);
        } catch (error) {
          chatController.chat.addFrontendMessage('error', 'Error occured when checking current directory path');
          return;
        }
      }
    }

    const lines = dir.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (this.directoryExists(lines[i])) {
        chatController.agent.currentWorkingDir = lines[i];
        this.needToUpdateWorkingDir = false;
        return chatController.agent.currentWorkingDir;
      }
    }

    chatController.chat.addFrontendMessage('error', 'Error occured when checking current directory path');
  }

  directoryExists(dirPath) {
    try {
      return fs.existsSync(path.normalize(dirPath));
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  createSendToChatButton() {
    if (this.sendToChatButton) {
      this.sendToChatButton.remove();
    }

    this.sendToChatButton = document.createElement('button');
    this.sendToChatButton.className = 'btn btn-primary btn-sm position-absolute';
    this.sendToChatButton.style.cssText = 'z-index: 1000; display: none; pointer-events: auto;';
    this.sendToChatButton.innerHTML = '<i class="bi bi-chat-dots me-1"></i>Send to Chat';
    
    this.sendToChatButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.sendSelectedTerminalToChat();
    });

    const container = document.getElementById('terminal_output');
    if (container) {
      container.style.position = 'relative';
      container.appendChild(this.sendToChatButton);
    }
  }

  handleSelectionChange() {
    if (!this.terminal || !this.sendToChatButton) return;

    const hasSelection = this.terminal.hasSelection();

    if (hasSelection) {
      const terminalElement = this.terminal.element;
      if (terminalElement) {
        const containerRect = terminalElement.getBoundingClientRect();
        const parentRect = document.getElementById('terminal_output').getBoundingClientRect();
        
        const relativeTop = containerRect.top - parentRect.top;
        const relativeLeft = containerRect.left - parentRect.left;

        this.sendToChatButton.style.top = `${Math.max(0, relativeTop + 10)}px`;
        this.sendToChatButton.style.left = `${Math.min(parentRect.width - 150, relativeLeft + 10)}px`;
        this.sendToChatButton.style.display = 'block';
      }
    } else {
      this.sendToChatButton.style.display = 'none';
    }
  }

  sendSelectedTerminalToChat() {
    if (!this.terminal) return;

    const selectedText = this.terminal.getSelection();
    if (!selectedText.trim()) return;

    const message = `Selected terminal output:\n\n\`\`\`\n${selectedText}\n\`\`\``;

    chatController.chat.addMessage('user', message);
    this.sendToChatButton.style.display = 'none';
    this.terminal.clearSelection();
  }
}

module.exports = TerminalSession;
