/**
 * Persistent Shell Manager for CodeCompanion
 * Maintains shell sessions across commands for better performance
 */

const { spawn } = require('child_process')
const path = require('path')
const EventEmitter = require('events')

class PersistentShellManager {
  constructor() {
    this.shells = new Map() // sessionId -> PersistentShell
  }

  /**
   * Get or create a shell for a session
   * @param {string} sessionId 
   * @param {string} cwd 
   * @returns {PersistentShell}
   */
  getShell(sessionId, cwd = process.cwd()) {
    if (!this.shells.has(sessionId)) {
      const shell = new PersistentShell(sessionId, cwd)
      this.shells.set(sessionId, shell)
    }
    return this.shells.get(sessionId)
  }

  /**
   * Execute command in persistent shell
   * @param {string} sessionId 
   * @param {string} command 
   * @param {Object} options 
   */
  async execute(sessionId, command, options = {}) {
    const shell = this.getShell(sessionId, options.cwd)
    return shell.execute(command, options)
  }

  /**
   * Clean up shell session
   * @param {string} sessionId 
   */
  cleanup(sessionId) {
    const shell = this.shells.get(sessionId)
    if (shell) {
      shell.destroy()
      this.shells.delete(sessionId)
    }
  }

  /**
   * Clean up all shells
   */
  cleanupAll() {
    for (const [sessionId, shell] of this.shells) {
      shell.destroy()
    }
    this.shells.clear()
  }
}

class PersistentShell extends EventEmitter {
  constructor(sessionId, cwd) {
    super()
    this.sessionId = sessionId
    this.cwd = cwd
    this.shell = null
    this.outputBuffer = ''
    this.errorBuffer = ''
    this.isExecuting = false
    this.currentResolve = null
    this.currentReject = null
    this.commandQueue = []
    this.initialized = false
    this.initializeShell()
  }

  initializeShell() {
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    const args = isWindows ? ['-NoLogo', '-NoProfile'] : ['-l']

    this.shell = spawn(shell, args, {
      cwd: this.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      shell: false
    })

    this.shell.stdout.on('data', (data) => {
      this.outputBuffer += data.toString()
      this.checkCommandComplete()
    })

    this.shell.stderr.on('data', (data) => {
      this.errorBuffer += data.toString()
    })

    this.shell.on('error', (error) => {
      if (this.currentReject) {
        this.currentReject(error)
      }
    })

    this.shell.on('exit', (code) => {
      this.emit('exit', code)
      if (this.currentReject) {
        this.currentReject(new Error(`Shell exited with code ${code}`))
      }
    })

    // Set up prompt marker
    const marker = '<<<COMMAND_COMPLETE>>>'
    this.promptMarker = marker
    
    if (process.platform === 'win32') {
      this.shell.stdin.write(`function prompt { "${marker}`n" }\r\n`)
    } else {
      this.shell.stdin.write(`PS1="${marker}\\n"\n`)
    }

    // Wait for initial prompt
    return new Promise((resolve) => {
      const checkInit = setInterval(() => {
        if (this.outputBuffer.includes(marker)) {
          clearInterval(checkInit)
          this.outputBuffer = ''
          this.initialized = true
          resolve()
        }
      }, 100)
    })
  }

  async execute(command, options = {}) {
    if (!this.initialized) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    return new Promise((resolve, reject) => {
      this.commandQueue.push({
        command,
        resolve,
        reject,
        options,
        startTime: Date.now()
      })
      this.processQueue()
    })
  }

  processQueue() {
    if (this.isExecuting || this.commandQueue.length === 0) return

    const { command, resolve, reject, options } = this.commandQueue.shift()
    this.isExecuting = true
    this.currentResolve = resolve
    this.currentReject = reject
    this.outputBuffer = ''
    this.errorBuffer = ''

    // Change directory if needed
    if (options.cwd && options.cwd !== this.cwd) {
      this.cwd = options.cwd
      this.shell.stdin.write(`cd "${this.cwd}"\n`)
    }

    // Execute the command
    this.shell.stdin.write(`${command}\n`)

    // Set timeout
    if (options.timeout) {
      setTimeout(() => {
        if (this.isExecuting) {
          this.shell.stdin.write('\x03') // Ctrl+C
          reject(new Error('Command timeout'))
        }
      }, options.timeout)
    }
  }

  checkCommandComplete() {
    if (this.outputBuffer.includes(this.promptMarker)) {
      const output = this.outputBuffer.split(this.promptMarker)[0]
      const result = {
        stdout: output,
        stderr: this.errorBuffer,
        exitCode: 0,
        duration: Date.now() - (this.commandQueue[0]?.startTime || Date.now())
      }

      if (this.currentResolve) {
        this.currentResolve(result)
      }

      this.isExecuting = false
      this.currentResolve = null
      this.currentReject = null
      this.outputBuffer = ''
      this.errorBuffer = ''

      // Process next command in queue
      this.processQueue()
    }
  }

  destroy() {
    if (this.shell) {
      this.shell.kill('SIGTERM')
      this.shell = null
    }
    this.removeAllListeners()
  }
}

module.exports = new PersistentShellManager() 