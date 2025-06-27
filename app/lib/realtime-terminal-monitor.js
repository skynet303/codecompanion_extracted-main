/**
 * Real-time Terminal Monitor
 * Monitors terminal output streams in real-time for immediate error detection
 */

const EventEmitter = require('events');
const TerminalErrorMonitor = require('./terminal-error-monitor');

class RealtimeTerminalMonitor extends EventEmitter {
  constructor() {
    super();
    this.errorMonitor = new TerminalErrorMonitor();
    this.activeCommands = new Map();
    this.bufferTimeout = 100; // ms to wait before analyzing buffered output
  }
  
  /**
   * Start monitoring a command execution
   */
  startMonitoring(commandId, command) {
    this.activeCommands.set(commandId, {
      command,
      output: '',
      errors: [],
      warnings: [],
      startTime: Date.now(),
      lastAnalysis: Date.now(),
      buffer: '',
      bufferTimer: null
    });
    
    this.emit('commandStart', { commandId, command });
  }
  
  /**
   * Process streaming output from a command
   */
  processOutput(commandId, chunk) {
    const monitor = this.activeCommands.get(commandId);
    if (!monitor) return;
    
    // Append to output and buffer
    monitor.output += chunk;
    monitor.buffer += chunk;
    
    // Clear existing timer
    if (monitor.bufferTimer) {
      clearTimeout(monitor.bufferTimer);
    }
    
    // Check for immediate critical errors
    const criticalPatterns = [
      /Segmentation fault/gi,
      /Out of memory/gi,
      /Stack overflow/gi,
      /FATAL ERROR/gi,
      /Unhandled exception/gi
    ];
    
    for (const pattern of criticalPatterns) {
      if (pattern.test(chunk)) {
        this.analyzeBuffer(commandId, true);
        return;
      }
    }
    
    // Set timer to analyze buffer
    monitor.bufferTimer = setTimeout(() => {
      this.analyzeBuffer(commandId);
    }, this.bufferTimeout);
  }
  
  /**
   * Analyze buffered output
   */
  analyzeBuffer(commandId, immediate = false) {
    const monitor = this.activeCommands.get(commandId);
    if (!monitor || !monitor.buffer) return;
    
    // Analyze the buffer
    const analysis = this.errorMonitor.analyzeOutput(monitor.buffer, monitor.command);
    
    // Track new errors and warnings
    const newErrors = analysis.errors.filter(e => 
      !monitor.errors.some(existing => 
        existing.message === e.message && existing.lineNumber === e.lineNumber
      )
    );
    
    const newWarnings = analysis.warnings.filter(w =>
      !monitor.warnings.some(existing =>
        existing.message === w.message && existing.lineNumber === w.lineNumber
      )
    );
    
    // Add to tracking
    monitor.errors.push(...newErrors);
    monitor.warnings.push(...newWarnings);
    
    // Emit events for new issues
    if (newErrors.length > 0) {
      this.emit('errorsDetected', {
        commandId,
        command: monitor.command,
        errors: newErrors,
        immediate
      });
      
      // Send real-time error notification to frontend
      if (global.chatController) {
        const criticalErrors = newErrors.filter(e => e.severity === 'critical');
        if (criticalErrors.length > 0) {
          chatController.chat.addFrontendMessage('function',
            `<div class="alert alert-danger">
              <i class="bi bi-x-octagon-fill"></i> <strong>CRITICAL ERROR DETECTED!</strong>
              <br>${criticalErrors[0].message}
            </div>`
          );
        }
      }
    }
    
    if (newWarnings.length > 0) {
      this.emit('warningsDetected', {
        commandId,
        command: monitor.command,
        warnings: newWarnings
      });
    }
    
    // Clear buffer
    monitor.buffer = '';
    monitor.lastAnalysis = Date.now();
  }
  
  /**
   * Complete monitoring for a command
   */
  completeMonitoring(commandId, exitCode = null) {
    const monitor = this.activeCommands.get(commandId);
    if (!monitor) return null;
    
    // Final analysis
    this.analyzeBuffer(commandId);
    
    // Full analysis of complete output
    const finalAnalysis = this.errorMonitor.analyzeOutput(monitor.output, monitor.command);
    finalAnalysis.duration = Date.now() - monitor.startTime;
    finalAnalysis.exitCode = exitCode;
    
    // Emit completion event
    this.emit('commandComplete', {
      commandId,
      command: monitor.command,
      analysis: finalAnalysis,
      duration: finalAnalysis.duration
    });
    
    // Clean up
    if (monitor.bufferTimer) {
      clearTimeout(monitor.bufferTimer);
    }
    this.activeCommands.delete(commandId);
    
    return finalAnalysis;
  }
  
  /**
   * Get current status of all monitored commands
   */
  getStatus() {
    const status = {
      activeCommands: this.activeCommands.size,
      commands: []
    };
    
    for (const [commandId, monitor] of this.activeCommands) {
      status.commands.push({
        commandId,
        command: monitor.command,
        duration: Date.now() - monitor.startTime,
        errors: monitor.errors.length,
        warnings: monitor.warnings.length,
        outputSize: monitor.output.length
      });
    }
    
    return status;
  }
  
  /**
   * Create a progress reporter for long-running commands
   */
  createProgressReporter(commandId) {
    const monitor = this.activeCommands.get(commandId);
    if (!monitor) return null;
    
    return {
      reportProgress: (message) => {
        this.emit('progress', {
          commandId,
          command: monitor.command,
          message,
          duration: Date.now() - monitor.startTime
        });
      },
      
      reportError: (error) => {
        monitor.errors.push({
          type: 'reported',
          severity: 'error',
          message: error,
          timestamp: Date.now()
        });
        
        this.emit('errorsDetected', {
          commandId,
          command: monitor.command,
          errors: [{ type: 'reported', severity: 'error', message: error }],
          immediate: true
        });
      }
    };
  }
  
  /**
   * Abort monitoring for a command
   */
  abortMonitoring(commandId) {
    const monitor = this.activeCommands.get(commandId);
    if (!monitor) return;
    
    if (monitor.bufferTimer) {
      clearTimeout(monitor.bufferTimer);
    }
    
    this.emit('commandAborted', {
      commandId,
      command: monitor.command,
      duration: Date.now() - monitor.startTime
    });
    
    this.activeCommands.delete(commandId);
  }
}

module.exports = RealtimeTerminalMonitor; 