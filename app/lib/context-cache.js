/**
 * Context Cache System for CodeCompanion
 * LRU cache with TTL for project context to reduce file I/O
 */

const fs = require('graceful-fs')
const path = require('path')
const crypto = require('crypto')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec)

class ContextCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100 // Maximum number of entries
    this.ttl = options.ttl || 5 * 60 * 1000 // 5 minutes default TTL
    this.cache = new Map()
    this.accessOrder = []
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0
    }
  }

  /**
   * Get cache key for a file path
   * @param {string} filePath 
   * @returns {string}
   */
  getCacheKey(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex')
  }

  /**
   * Get item from cache
   * @param {string} filePath 
   * @returns {Object|null}
   */
  get(filePath) {
    const key = this.getCacheKey(filePath)
    const item = this.cache.get(key)
    
    if (!item) {
      this.stats.misses++
      return null
    }

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      this.stats.misses++
      return null
    }

    // Update access order (move to end)
    this.updateAccessOrder(key)
    this.stats.hits++
    return item.data
  }

  /**
   * Set item in cache
   * @param {string} filePath 
   * @param {any} data 
   * @param {number} customTTL 
   */
  set(filePath, data, customTTL = null) {
    const key = this.getCacheKey(filePath)
    const ttl = customTTL || this.ttl
    
    // Check if we need to evict
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl,
      filePath,
      size: JSON.stringify(data).length
    })

    this.updateAccessOrder(key)
  }

  /**
   * Invalidate cache for a path (and optionally its children)
   * @param {string} targetPath 
   */
  invalidatePath(targetPath) {
    let invalidated = 0
    
    for (const [key, item] of this.cache.entries()) {
      if (item.filePath.startsWith(targetPath)) {
        this.cache.delete(key)
        this.removeFromAccessOrder(key)
        invalidated++
      }
    }

    this.stats.invalidations += invalidated
    return invalidated
  }

  /**
   * Invalidate specific file
   * @param {string} filePath 
   */
  invalidate(filePath) {
    const key = this.getCacheKey(filePath)
    if (this.cache.delete(key)) {
      this.removeFromAccessOrder(key)
      this.stats.invalidations++
      return true
    }
    return false
  }

  /**
   * Clear entire cache
   */
  clear() {
    const size = this.cache.size
    this.cache.clear()
    this.accessOrder = []
    this.stats.invalidations += size
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: this.getMemoryUsage()
    }
  }

  /**
   * Get approximate memory usage
   * @returns {string}
   */
  getMemoryUsage() {
    let totalSize = 0
    for (const item of this.cache.values()) {
      totalSize += item.size
    }
    return `${(totalSize / 1024 / 1024).toFixed(2)} MB`
  }

  /**
   * Update access order for LRU
   * @param {string} key 
   */
  updateAccessOrder(key) {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(key)
  }

  /**
   * Remove from access order
   * @param {string} key 
   */
  removeFromAccessOrder(key) {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  /**
   * Evict least recently used item
   */
  evictLRU() {
    if (this.accessOrder.length === 0) return
    
    const lruKey = this.accessOrder.shift()
    this.cache.delete(lruKey)
    this.stats.evictions++
  }

  /**
   * Read file with caching
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  async readFile(filePath) {
    // Check cache first
    const cached = this.get(filePath)
    if (cached) {
      return cached
    }

    // Read from disk
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      const stats = await fs.promises.stat(filePath)
      
      const data = {
        content,
        mtime: stats.mtime.getTime(),
        size: stats.size
      }

      // Cache the result
      this.set(filePath, data)
      return data
    } catch (error) {
      throw error
    }
  }

  /**
   * Get project structure with caching
   * @param {string} projectPath 
   * @returns {Promise<Object>}
   */
  async getProjectStructure(projectPath) {
    const cacheKey = `project-structure:${projectPath}`
    const cached = this.get(cacheKey)
    if (cached) {
      return cached
    }

    try {
      // Use 'find' command for faster directory traversal
      const { stdout } = await exec(
        `find "${projectPath}" -type f -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" | head -1000`,
        { maxBuffer: 1024 * 1024 * 10 } // 10MB buffer
      )

      const files = stdout.trim().split('\n').filter(Boolean)
      const structure = {
        files,
        count: files.length,
        timestamp: Date.now()
      }

      // Cache with shorter TTL for project structure
      this.set(cacheKey, structure, 60 * 1000) // 1 minute
      return structure
    } catch (error) {
      // Fallback to Node.js traversal
      return this.traverseDirectory(projectPath)
    }
  }

  /**
   * Traverse directory (fallback method)
   * @param {string} dir 
   * @param {Array} fileList 
   * @returns {Promise<Object>}
   */
  async traverseDirectory(dir, fileList = []) {
    const files = await fs.promises.readdir(dir)
    
    for (const file of files) {
      const filePath = path.join(dir, file)
      try {
        const stat = await fs.promises.stat(filePath)
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          await this.traverseDirectory(filePath, fileList)
        } else if (stat.isFile()) {
          fileList.push(filePath)
        }
      } catch (error) {
        // Skip inaccessible files
      }
    }

    return {
      files: fileList,
      count: fileList.length,
      timestamp: Date.now()
    }
  }

  /**
   * Batch read files with caching
   * @param {Array<string>} filePaths 
   * @returns {Promise<Array<Object>>}
   */
  async readFiles(filePaths) {
    const results = await Promise.all(
      filePaths.map(filePath => this.readFile(filePath).catch(error => ({
        filePath,
        error: error.message
      })))
    )
    return results
  }

  /**
   * Watch file for changes and invalidate cache
   * @param {string} filePath 
   */
  watchFile(filePath) {
    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        this.invalidate(filePath)
      }
    })
  }

  /**
   * Stop watching file
   * @param {string} filePath 
   */
  unwatchFile(filePath) {
    fs.unwatchFile(filePath)
  }
}

// Export singleton instance
module.exports = new ContextCache() 