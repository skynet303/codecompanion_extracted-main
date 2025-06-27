/**
 * Error Recovery System for CodeCompanion
 * Pattern-based error classification and auto-recovery
 */

class ErrorRecovery {
  constructor() {
    this.errorPatterns = this.initializeErrorPatterns()
    this.retryCount = 0
    this.maxRetries = 3
    this.retryDelays = [1000, 2000, 5000] // Progressive delays
    this.errorHistory = []
    this.recoveryStrategies = this.initializeRecoveryStrategies()
  }

  /**
   * Initialize error patterns for classification
   */
  initializeErrorPatterns() {
    return [
      {
        pattern: /rate limit|too many requests|429/i,
        type: 'rate_limit',
        recoverable: true,
        strategy: 'exponential_backoff',
        userMessage: 'Rate limit reached. Waiting before retrying...'
      },
      {
        pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
        type: 'timeout',
        recoverable: true,
        strategy: 'retry_with_timeout',
        userMessage: 'Request timed out. Retrying with longer timeout...'
      },
      {
        pattern: /ECONNREFUSED|ECONNRESET|ENETUNREACH/i,
        type: 'network',
        recoverable: true,
        strategy: 'retry_with_delay',
        userMessage: 'Network error. Checking connection and retrying...'
      },
      {
        pattern: /invalid api key|unauthorized|401|403/i,
        type: 'auth',
        recoverable: false,
        strategy: 'require_auth',
        userMessage: 'Authentication failed. Please check your API key.'
      },
      {
        pattern: /insufficient quota|payment required|402/i,
        type: 'quota',
        recoverable: false,
        strategy: 'check_quota',
        userMessage: 'API quota exceeded. Please check your usage limits.'
      },
      {
        pattern: /ENOENT|no such file/i,
        type: 'file_not_found',
        recoverable: false,
        strategy: 'verify_path',
        userMessage: 'File not found. Please check the file path.'
      },
      {
        pattern: /EACCES|permission denied/i,
        type: 'permission',
        recoverable: false,
        strategy: 'check_permissions',
        userMessage: 'Permission denied. Please check file permissions.'
      },
      {
        pattern: /syntax error|parse error/i,
        type: 'syntax',
        recoverable: false,
        strategy: 'fix_syntax',
        userMessage: 'Syntax error in the code. Please review the changes.'
      },
      {
        pattern: /out of memory|heap out of memory/i,
        type: 'memory',
        recoverable: true,
        strategy: 'reduce_memory',
        userMessage: 'Out of memory. Trying with reduced resource usage...'
      },
      {
        pattern: /model overloaded|service unavailable|503/i,
        type: 'service_unavailable',
        recoverable: true,
        strategy: 'exponential_backoff',
        userMessage: 'Service temporarily unavailable. Waiting before retry...'
      }
    ]
  }

  /**
   * Initialize recovery strategies
   */
  initializeRecoveryStrategies() {
    return {
      exponential_backoff: async (error, context) => {
        const delay = this.retryDelays[Math.min(this.retryCount, this.retryDelays.length - 1)]
        await this.delay(delay * Math.pow(2, this.retryCount))
        return { retry: true, delay }
      },

      retry_with_delay: async (error, context) => {
        const delay = this.retryDelays[Math.min(this.retryCount, this.retryDelays.length - 1)]
        await this.delay(delay)
        return { retry: true, delay }
      },

      retry_with_timeout: async (error, context) => {
        const newTimeout = (context.timeout || 30000) * 2
        await this.delay(1000)
        return { retry: true, timeout: newTimeout }
      },

      require_auth: async (error, context) => {
        return { 
          retry: false, 
          action: 'show_settings',
          message: 'Please add your API key in Settings'
        }
      },

      check_quota: async (error, context) => {
        return { 
          retry: false, 
          action: 'check_usage',
          message: 'Please check your API usage and limits'
        }
      },

      verify_path: async (error, context) => {
        return { 
          retry: false, 
          action: 'verify_file',
          suggestion: this.suggestSimilarFiles(context.filePath)
        }
      },

      check_permissions: async (error, context) => {
        return { 
          retry: false, 
          action: 'check_permissions',
          command: `ls -la "${context.filePath}"`
        }
      },

      fix_syntax: async (error, context) => {
        return { 
          retry: false, 
          action: 'review_code',
          suggestion: this.extractSyntaxError(error)
        }
      },

      reduce_memory: async (error, context) => {
        // Clear caches and retry with reduced batch size
        if (global.contextCache) {
          global.contextCache.clear()
        }
        return { 
          retry: true, 
          batchSize: Math.floor((context.batchSize || 10) / 2)
        }
      }
    }
  }

  /**
   * Handle error with recovery attempt
   * @param {Error} error 
   * @param {Object} context 
   */
  async handleError(error, context = {}) {
    const errorInfo = this.classifyError(error)
    
    // Log error to history
    this.errorHistory.push({
      timestamp: Date.now(),
      error: error.message,
      type: errorInfo.type,
      context
    })

    // Limit error history size
    if (this.errorHistory.length > 100) {
      this.errorHistory.shift()
    }

    // Check if recoverable
    if (!errorInfo.recoverable || this.retryCount >= this.maxRetries) {
      this.retryCount = 0
      return {
        success: false,
        error: errorInfo,
        suggestion: this.getSuggestion(errorInfo, error)
      }
    }

    // Attempt recovery
    const strategy = this.recoveryStrategies[errorInfo.strategy]
    if (!strategy) {
      return { success: false, error: errorInfo }
    }

    this.retryCount++
    const recoveryResult = await strategy(error, context)
    
    if (recoveryResult.retry) {
      this.notifyUser(errorInfo.userMessage, recoveryResult.delay)
      return {
        success: true,
        retry: true,
        ...recoveryResult
      }
    }

    this.retryCount = 0
    return {
      success: false,
      error: errorInfo,
      ...recoveryResult
    }
  }

  /**
   * Classify error based on patterns
   * @param {Error} error 
   */
  classifyError(error) {
    const errorString = error.toString() + (error.stack || '')
    
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorString)) {
        return pattern
      }
    }

    // Default unknown error
    return {
      type: 'unknown',
      recoverable: false,
      strategy: null,
      userMessage: 'An unexpected error occurred'
    }
  }

  /**
   * Get helpful suggestion for error
   * @param {Object} errorInfo 
   * @param {Error} error 
   */
  getSuggestion(errorInfo, error) {
    const suggestions = {
      rate_limit: 'Consider upgrading your API plan or waiting a few minutes',
      auth: 'Check your API key in Settings (gear icon)',
      quota: 'Check your API usage dashboard',
      file_not_found: 'Verify the file path and ensure the file exists',
      permission: 'Check file permissions or run with appropriate privileges',
      syntax: 'Review the code changes for syntax errors',
      network: 'Check your internet connection and firewall settings',
      memory: 'Close other applications or restart CodeCompanion'
    }

    return suggestions[errorInfo.type] || 'Please try again or contact support'
  }

  /**
   * Suggest similar files for file not found errors
   * @param {string} filePath 
   */
  suggestSimilarFiles(filePath) {
    // This would integrate with the file system to suggest similar files
    return `Did you mean a file with a similar name?`
  }

  /**
   * Extract syntax error details
   * @param {Error} error 
   */
  extractSyntaxError(error) {
    const match = error.message.match(/line (\d+)|column (\d+)/i)
    if (match) {
      return `Error at line ${match[1] || '?'}, column ${match[2] || '?'}`
    }
    return 'Check the recent code changes'
  }

  /**
   * Notify user about recovery attempt
   * @param {string} message 
   * @param {number} delay 
   */
  notifyUser(message, delay = 0) {
    if (typeof viewController !== 'undefined' && viewController.updateFooterMessage) {
      const retryMessage = delay > 0 
        ? `${message} (retry ${this.retryCount}/${this.maxRetries} in ${delay/1000}s)`
        : message
      viewController.updateFooterMessage(retryMessage)
    }
  }

  /**
   * Delay helper
   * @param {number} ms 
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Reset retry counter
   */
  reset() {
    this.retryCount = 0
  }

  /**
   * Get error statistics
   */
  getStats() {
    const stats = {}
    
    for (const error of this.errorHistory) {
      stats[error.type] = (stats[error.type] || 0) + 1
    }

    return {
      total: this.errorHistory.length,
      byType: stats,
      recentErrors: this.errorHistory.slice(-10)
    }
  }

  /**
   * Check if should retry based on error history
   * @param {string} errorType 
   */
  shouldRetry(errorType) {
    // Don't retry if we've had too many of the same error recently
    const recentSameErrors = this.errorHistory
      .slice(-10)
      .filter(e => e.type === errorType)
      .length

    return recentSameErrors < 3
  }
}

// Export singleton instance
module.exports = new ErrorRecovery() 