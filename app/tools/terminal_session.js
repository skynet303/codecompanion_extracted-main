const path = require('path');
const fs = require('graceful-fs');
const os = require('os');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const { ipcRenderer, shell } = require('electron');
const { debounce } = require('lodash');
const { withTimeout, log, terminalLog, terminalError } = require('../utils');
const RealtimeTerminalMonitor = require('../lib/realtime-terminal-monitor');

const isWindows = process.platform === 'win32';
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
    this.debouncedSelectionHandler = this.debounce(this.handleSelectionChange.bind(this), 100);
    
    // Initialize missing properties that were causing the "push" error
    this.terminalSessionDataListeners = [];
    this.endMarker = '<<<COMMAND_END_' + Date.now() + '>>>';
    this.lastCommandAnalysis = null;
    this.commandOutputCapture = null; // Track active command output capture
    
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
    
    // Ensure we navigate to the project directory after creating/clearing the terminal
    const projectDir = chatController.agent?.currentWorkingDir || 
                      chatController.agent?.projectController?.currentProject?.path;
    
    if (projectDir && projectDir !== os.homedir()) {
      console.log('[Terminal] Navigating to project directory:', projectDir);
      // Use a small delay to ensure the terminal is ready
      setTimeout(() => {
        this.navigateToDirectory(projectDir);
      }, 500);
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

    // Ensure we use the project directory if available
    const workingDir = chatController.agent?.currentWorkingDir || 
                      chatController.agent?.projectController?.currentProject?.path || 
                      process.cwd();
    
    terminalLog('[Terminal] Starting shell in directory:', workingDir);
    
    ipcRenderer.send('start-shell', {
      cwd: workingDir,
    });
    ipcRenderer.on('shell-type', (event, data) => {
      this.shellType = data;
      this.setPrompt();
    });
    // Keep track of shell data chunks for debugging
    let shellDataCount = 0;
    
    ipcRenderer.on('shell-data', (event, data) => {
      shellDataCount++;
      const dataStr = data.toString();
      
      // Debug: Log raw shell data with sequence number
      terminalLog(`[Shell Data #${shellDataCount}]:`, dataStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\x1b/g, '\\x1b'));
      
      // Check what's in this chunk
      if (dataStr.includes('<<<COMMAND_END')) {
        terminalLog('[Shell Data] This chunk contains END MARKER');
      }
      if (dataStr.match(/^\/.*$/m)) {
        terminalLog('[Shell Data] This chunk contains a PATH');
      }
      if (dataStr.match(/^(total|drwx|-.*)$/m)) {
        terminalLog('[Shell Data] This chunk contains directory listing');
      }
      
      // Write to terminal display
      this.writeToTerminal(data);
      
      // Also send to command output capture if active
      if (this.commandOutputCapture) {
        this.commandOutputCapture(data);
      }
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
    ipcRenderer.send('execute-command', command);
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
    // Debug: Check what command we received
    terminalLog('[Terminal Session] Received command:', command);
    terminalLog('[Terminal Session] Command type:', typeof command);
    
    return new Promise((resolve, reject) => {
      let output = '';
      
      // Generate unique command ID
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Start monitoring
      this.realtimeMonitor.startMonitoring(commandId, command);
      
      const executeTimeStamp = Date.now();
      
      // Construct command with end marker based on shell type
      let fullCommand;
      
      if (this.shellType === 'powershell.exe') {
        // PowerShell: Use semicolon separator
        fullCommand = `${command}; Write-Host "${this.endMarker}"`;
      } else {
        // Bash/Zsh/Fish: Use printf to avoid issues with echo and quotes
        // printf is more reliable than echo for special strings
        fullCommand = `${command}; printf '%s\\n' '${this.endMarker}'`;
      }
      
      terminalLog('[Terminal] Executing command:', fullCommand); // Debug log
      
      // Set up command output capture
      let allChunks = [];
      let commandEchoComplete = false;
      let lastChunkTime = Date.now();
      
      this.commandOutputCapture = (data) => {
        const chunk = data.toString();
        const chunkTime = Date.now();
        allChunks.push({ data: chunk, time: chunkTime });
        
        // Debug: Log each chunk received
        terminalLog('[Terminal] Chunk #' + allChunks.length + ':', chunk.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\x1b/g, '\\x1b'));
        
        // Build complete output
        const allData = allChunks.map(c => c.data).join('');
        const cleanData = this.removeASCII(allData);
        
        // Check if the command echo is complete (contains the full command including printf)
        if (!commandEchoComplete && cleanData.includes(fullCommand)) {
          commandEchoComplete = true;
          terminalLog('[Terminal] Full command echo detected, waiting for output...');
        }
        
        // Count how many times the end marker appears
        const endMarkerCount = (cleanData.match(new RegExp(this.escapeRegExp(this.endMarker), 'g')) || []).length;
        terminalLog('[Terminal] End marker count:', endMarkerCount);
        
        // We need at least 2 occurrences: one in echo, one from actual execution
        // OR if enough time has passed since command echo
        const timeSinceLastChunk = chunkTime - lastChunkTime;
        const enoughTimePassed = commandEchoComplete && timeSinceLastChunk > 100;
        
        if (commandEchoComplete && (endMarkerCount >= 2 || (endMarkerCount >= 1 && enoughTimePassed))) {
          terminalLog('[Terminal] Processing complete output...');
          
          // Clear the command output capture
          this.commandOutputCapture = null;
          
          // Split into lines and process
          const lines = cleanData.split(/\r?\n/);
          const outputLines = [];
          let skipNextLines = 0;
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (skipNextLines > 0) {
              skipNextLines--;
              continue;
            }
            
            // Skip empty lines
            if (!line) continue;
            
            // Skip the command echo line (which includes the full command with printf)
            if (line.includes(fullCommand) || line.includes(`${command}; printf`)) {
              terminalLog('[Terminal] Skipping command echo line:', line);
              // Also skip the next line if it's just control characters
              if (i + 1 < lines.length && lines[i + 1].trim().match(/^\??\d{4}[lh]?$/)) {
                skipNextLines = 1;
              }
              continue;
            }
            
            // Skip standalone end markers
            if (line === this.endMarker) {
              terminalLog('[Terminal] Skipping standalone end marker');
              break;
            }
            
            // Skip terminal control sequences
            if (line.match(/^\??\d{4}[lh]?$/)) {
              continue;
            }
            
            // This is actual output
            outputLines.push(line);
          }
          
          const finalOutput = outputLines.join('\n').trim();
          
          terminalLog('[Terminal] Total chunks:', allChunks.length);
          terminalLog('[Terminal] Output lines:', outputLines);
          terminalLog('[Terminal] Final output:', finalOutput || '(empty output)');
          
          // Complete monitoring and get final analysis
          const analysis = this.realtimeMonitor.completeMonitoring(commandId);
          
          // Store the analysis for later retrieval
          this.lastCommandAnalysis = analysis;
          
          resolve(finalOutput);
        }
        
        lastChunkTime = chunkTime;
        
        // Process output through real-time monitor
        this.realtimeMonitor.processOutput(commandId, chunk);
      };
      
      // Send command to shell for execution
      this.writeToShell(fullCommand + '\r');
      
      // Small delay to ensure command is processed before we start capturing
      setTimeout(() => {
        terminalLog('[Terminal] Command should be executing now');
      }, 100);
      
      // Timeout handling with monitoring cleanup
      setTimeout(() => {
        // Clear the command output capture
        this.commandOutputCapture = null;
        
        // If we have output but didn't detect end marker, still return what we have
        if (output && output.length > 0) {
          terminalLog('[Terminal] Timeout reached but have output, returning what we collected');
          output = this.postProcessOutput(output, command, executeTimeStamp);
          resolve(output);
        } else {
          // Abort monitoring on timeout
          this.realtimeMonitor.abortMonitoring(commandId);
          reject(new Error('Command execution timeout'));
        }
      }, 30000); // 30 second timeout
    });
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

  postProcessOutput(output, command, startTime) {
    // Remove terminal control characters and clean up output
    let cleanOutput = this.removeASCII(output);
    
    // Debug: Log what we're processing
    terminalLog('[Terminal] PostProcess - Raw output:', cleanOutput.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
    
    // Remove the full command echo (including our printf addition) from the beginning
    // The output might contain: "command; printf '%s\n' '<<<COMMAND_END>>>'\r\n[actual output]"
    const fullCommandPattern = new RegExp(`^${this.escapeRegExp(command)}.*?${this.escapeRegExp(this.endMarker)}.*?\\r?\\n`, 's');
    cleanOutput = cleanOutput.replace(fullCommandPattern, '');
    
    // Also try to remove just the command echo if it appears at the start
    if (cleanOutput.startsWith(command)) {
      cleanOutput = cleanOutput.substring(command.length);
    }
    
    // Remove any remaining command echo that might appear
    const lines = cleanOutput.split(/\r?\n/);
    const filteredLines = [];
    let foundOutput = false;
    
    for (const line of lines) {
      // Skip lines that are just our command echo or printf command
      if (!foundOutput && (line.includes(command) || line.includes('printf') || line.includes(this.endMarker))) {
        // Check if this line also contains actual output after the command
        const commandIndex = line.indexOf(command);
        if (commandIndex >= 0) {
          const afterCommand = line.substring(commandIndex + command.length).trim();
          if (afterCommand && !afterCommand.includes('printf') && !afterCommand.includes(this.endMarker)) {
            filteredLines.push(afterCommand);
            foundOutput = true;
          }
        }
        continue;
      }
      filteredLines.push(line);
      foundOutput = true;
    }
    
    cleanOutput = filteredLines.join('\n');
    
    // Remove leading/trailing whitespace
    cleanOutput = cleanOutput.trim();
    
    // Add execution time info
    const duration = Date.now() - startTime;
    if (duration > 1000) {
      console.log(`Command '${command}' took ${duration}ms to execute`);
    }
    
    terminalLog('[Terminal] PostProcess - Final output:', cleanOutput);
    
    return cleanOutput;
  }
  
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      // First, ensure the terminal is ready
      if (!this.terminal) {
        console.error('[Terminal] Terminal not initialized');
        return chatController.agent.currentWorkingDir;
      }
      
      // Execute pwd command with proper error handling
      const pwdPromise = this.executeShellCommand('pwd');
      dir = await withTimeout(pwdPromise, 2000); // Increased timeout to 2 seconds
      
    } catch (error) {
      console.error('[Terminal] Error getting current directory:', error);
      
      // If timeout or error, try to recover
      try {
        await this.interruptShellSession();
        // Give the terminal a moment to recover
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const pwdPromise = this.executeShellCommand('pwd');
        dir = await withTimeout(pwdPromise, 2000);
      } catch (retryError) {
        console.error('[Terminal] Retry failed:', retryError);
        // Fall back to the known working directory
        return chatController.agent.currentWorkingDir;
      }
    }

    if (dir) {
      const lines = dir.split('\n').filter(line => line.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        const cleanPath = lines[i].trim();
        if (cleanPath && this.directoryExists(cleanPath)) {
          chatController.agent.currentWorkingDir = cleanPath;
          this.needToUpdateWorkingDir = false;
          return cleanPath;
        }
      }
    }

    // If we couldn't determine the directory, return the current known directory
    console.warn('[Terminal] Could not determine current directory, using:', chatController.agent.currentWorkingDir);
    return chatController.agent.currentWorkingDir;
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
