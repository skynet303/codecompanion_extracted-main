/**
 * Progress Tracker for CodeCompanion
 * Tracks long-running operations with real-time updates
 */

const EventEmitter = require('events')

class ProgressTracker extends EventEmitter {
  constructor() {
    super()
    this.operations = new Map()
    this.activeCount = 0
  }

  /**
   * Start tracking an operation
   * @param {string} operationId 
   * @param {string} description 
   * @param {Object} options 
   */
  start(operationId, description, options = {}) {
    const operation = {
      id: operationId,
      description,
      progress: 0,
      status: 'active',
      startTime: Date.now(),
      lastUpdate: Date.now(),
      steps: options.steps || null,
      currentStep: 0,
      metadata: options.metadata || {},
      logs: []
    }

    this.operations.set(operationId, operation)
    this.activeCount++
    
    this.emit('start', operation)
    this.notifyUI(operation)
    
    return operation
  }

  /**
   * Update operation progress
   * @param {string} operationId 
   * @param {number} progress 
   * @param {Object} metadata 
   */
  update(operationId, progress, metadata = {}) {
    const operation = this.operations.get(operationId)
    if (!operation || operation.status !== 'active') return

    operation.progress = Math.min(100, Math.max(0, progress))
    operation.lastUpdate = Date.now()
    operation.metadata = { ...operation.metadata, ...metadata }

    if (metadata.currentStep !== undefined) {
      operation.currentStep = metadata.currentStep
    }

    if (metadata.log) {
      operation.logs.push({
        timestamp: Date.now(),
        message: metadata.log
      })
    }

    this.emit('update', operation)
    this.notifyUI(operation)
  }

  /**
   * Complete an operation
   * @param {string} operationId 
   * @param {string} message 
   */
  complete(operationId, message = null) {
    const operation = this.operations.get(operationId)
    if (!operation) return

    operation.progress = 100
    operation.status = 'completed'
    operation.endTime = Date.now()
    operation.duration = operation.endTime - operation.startTime
    operation.completionMessage = message

    if (operation.status === 'active') {
      this.activeCount--
    }

    this.emit('complete', operation)
    this.notifyUI(operation)

    // Auto-cleanup after 30 seconds
    setTimeout(() => {
      this.operations.delete(operationId)
    }, 30000)
  }

  /**
   * Fail an operation
   * @param {string} operationId 
   * @param {string} error 
   */
  fail(operationId, error) {
    const operation = this.operations.get(operationId)
    if (!operation) return

    operation.status = 'failed'
    operation.endTime = Date.now()
    operation.duration = operation.endTime - operation.startTime
    operation.error = error

    if (operation.status === 'active') {
      this.activeCount--
    }

    this.emit('fail', operation)
    this.notifyUI(operation)

    // Auto-cleanup after 30 seconds
    setTimeout(() => {
      this.operations.delete(operationId)
    }, 30000)
  }

  /**
   * Get operation by ID
   * @param {string} operationId 
   * @returns {Object|null}
   */
  get(operationId) {
    return this.operations.get(operationId) || null
  }

  /**
   * Get all active operations
   * @returns {Array<Object>}
   */
  getActiveOperations() {
    return Array.from(this.operations.values())
      .filter(op => op.status === 'active')
  }

  /**
   * Get all operations
   * @returns {Array<Object>}
   */
  getAllOperations() {
    return Array.from(this.operations.values())
  }

  /**
   * Clear completed operations
   */
  clearCompleted() {
    for (const [id, operation] of this.operations.entries()) {
      if (operation.status !== 'active') {
        this.operations.delete(id)
      }
    }
  }

  /**
   * Notify UI about progress update
   * @param {Object} operation 
   */
  notifyUI(operation) {
    if (typeof viewController !== 'undefined' && viewController.updateLoadingIndicator) {
      const message = this.formatProgressMessage(operation)
      viewController.updateLoadingIndicator(
        operation.status === 'active',
        message
      )
    }
  }

  /**
   * Format progress message for UI
   * @param {Object} operation 
   * @returns {string}
   */
  formatProgressMessage(operation) {
    if (operation.status === 'failed') {
      return `❌ ${operation.description}: ${operation.error}`
    }

    if (operation.status === 'completed') {
      return operation.completionMessage || `✅ ${operation.description} completed`
    }

    let message = operation.description

    // Add progress bar if percentage-based
    if (operation.progress > 0 && operation.progress < 100) {
      const progressBar = this.createProgressBar(operation.progress)
      message += ` ${progressBar} ${operation.progress}%`
    }

    // Add step information if available
    if (operation.steps && operation.currentStep > 0) {
      message += ` (${operation.currentStep}/${operation.steps})`
    }

    // Add metadata info
    if (operation.metadata.currentFile) {
      message += ` - ${operation.metadata.currentFile}`
    } else if (operation.metadata.filesSearched && operation.metadata.totalFiles) {
      message += ` - ${operation.metadata.filesSearched}/${operation.metadata.totalFiles} files`
    }

    return message
  }

  /**
   * Create visual progress bar
   * @param {number} progress 
   * @returns {string}
   */
  createProgressBar(progress) {
    const filled = Math.round((progress / 100) * 10)
    const empty = 10 - filled
    return '▓'.repeat(filled) + '░'.repeat(empty)
  }

  /**
   * Create step-based progress tracker
   * @param {string} operationId 
   * @param {string} description 
   * @param {Array<string>} steps 
   */
  createStepTracker(operationId, description, steps) {
    this.start(operationId, description, { steps: steps.length })
    
    return {
      nextStep: (stepDescription) => {
        const operation = this.get(operationId)
        if (!operation) return
        
        operation.currentStep++
        const progress = Math.round((operation.currentStep / operation.steps) * 100)
        
        this.update(operationId, progress, {
          currentStep: operation.currentStep,
          log: stepDescription
        })
      },
      complete: (message) => this.complete(operationId, message),
      fail: (error) => this.fail(operationId, error)
    }
  }

  /**
   * Create file-based progress tracker
   * @param {string} operationId 
   * @param {string} description 
   * @param {number} totalFiles 
   */
  createFileTracker(operationId, description, totalFiles) {
    this.start(operationId, description, { 
      metadata: { totalFiles, filesProcessed: 0 }
    })
    
    return {
      processFile: (fileName) => {
        const operation = this.get(operationId)
        if (!operation) return
        
        operation.metadata.filesProcessed++
        const progress = Math.round((operation.metadata.filesProcessed / totalFiles) * 100)
        
        this.update(operationId, progress, {
          currentFile: fileName,
          filesSearched: operation.metadata.filesProcessed
        })
      },
      complete: (message) => this.complete(operationId, message),
      fail: (error) => this.fail(operationId, error)
    }
  }
}

// Export singleton instance
module.exports = new ProgressTracker() 