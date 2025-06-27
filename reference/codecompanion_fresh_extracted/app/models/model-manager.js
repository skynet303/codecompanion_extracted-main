/**
 * Unified Model Manager for CodeCompanion
 * Handles multiple AI providers with fallback and optimization
 */

const anthropicModel = require('./anthropic')
const openaiModel = require('./openai')
const errorRecovery = require('../lib/error-recovery')
const progressTracker = require('../lib/progress-tracker')

class ModelManager {
  constructor() {
    this.providers = new Map()
    this.currentProvider = null
    this.fallbackProviders = []
    this.modelCache = new Map()
    this.usage = {
      tokens: 0,
      cost: 0,
      requests: 0
    }
    
    this.initializeProviders()
  }

  /**
   * Initialize available providers
   */
  initializeProviders() {
    // Register Anthropic provider
    this.registerProvider('anthropic', {
      instance: anthropicModel,
      models: ['claude-3.5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: true,
        maxTokens: 200000,
        contextWindow: 200000
      },
      priority: 1
    })

    // Register OpenAI provider
    this.registerProvider('openai', {
      instance: openaiModel,
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: true,
        maxTokens: 128000,
        contextWindow: 128000
      },
      priority: 2
    })

    // Set default provider based on config
    this.setDefaultProvider()
  }

  /**
   * Register a provider
   * @param {string} name 
   * @param {Object} config 
   */
  registerProvider(name, config) {
    this.providers.set(name, {
      name,
      ...config,
      available: false,
      lastCheck: 0
    })
  }

  /**
   * Set default provider based on available API keys
   */
  async setDefaultProvider() {
    for (const [name, provider] of this.providers.entries()) {
      const isAvailable = await this.checkProviderAvailability(name)
      if (isAvailable) {
        this.currentProvider = name
        this.setupFallbackChain()
        return
      }
    }
    
    throw new Error('No AI providers configured. Please add your API key in Settings.')
  }

  /**
   * Check if provider is available
   * @param {string} providerName 
   */
  async checkProviderAvailability(providerName) {
    const provider = this.providers.get(providerName)
    if (!provider) return false

    // Check if we've recently verified availability
    if (Date.now() - provider.lastCheck < 300000) { // 5 minutes
      return provider.available
    }

    try {
      const hasKey = provider.instance.hasApiKey && provider.instance.hasApiKey()
      provider.available = hasKey
      provider.lastCheck = Date.now()
      return hasKey
    } catch (error) {
      provider.available = false
      return false
    }
  }

  /**
   * Setup fallback provider chain
   */
  setupFallbackChain() {
    this.fallbackProviders = Array.from(this.providers.entries())
      .filter(([name]) => name !== this.currentProvider)
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name]) => name)
  }

  /**
   * Get current provider instance
   */
  getCurrentProvider() {
    const provider = this.providers.get(this.currentProvider)
    return provider ? provider.instance : null
  }

  /**
   * Send message with automatic fallback
   * @param {Array} messages 
   * @param {Object} options 
   */
  async sendMessage(messages, options = {}) {
    const trackingId = `ai-request-${Date.now()}`
    progressTracker.start(trackingId, 'Processing AI request')

    let lastError = null
    const providersToTry = [this.currentProvider, ...this.fallbackProviders]

    for (const providerName of providersToTry) {
      const provider = this.providers.get(providerName)
      if (!provider || !provider.available) continue

      try {
        progressTracker.update(trackingId, 30, { 
          log: `Trying ${providerName}...` 
        })

        // Optimize messages for this provider
        const optimizedMessages = await this.optimizeForProvider(messages, providerName)
        
        // Add provider-specific options
        const providerOptions = this.getProviderOptions(providerName, options)

        // Send request
        const response = await provider.instance.sendMessage(
          optimizedMessages, 
          providerOptions
        )

        // Track usage
        this.trackUsage(providerName, response)
        
        progressTracker.complete(trackingId, `Request completed with ${providerName}`)
        
        return response
      } catch (error) {
        lastError = error
        console.error(`${providerName} failed:`, error)

        // Handle error with recovery system
        const recovery = await errorRecovery.handleError(error, {
          provider: providerName,
          attempt: providersToTry.indexOf(providerName) + 1
        })

        if (recovery.retry && recovery.success) {
          // Retry with same provider
          providersToTry.splice(providersToTry.indexOf(providerName) + 1, 0, providerName)
        } else {
          // Mark provider as temporarily unavailable
          provider.available = false
          progressTracker.update(trackingId, 50, { 
            log: `${providerName} failed, trying fallback...` 
          })
        }
      }
    }

    progressTracker.fail(trackingId, 'All providers failed')
    throw lastError || new Error('All AI providers failed. Please check your API keys.')
  }

  /**
   * Stream message with automatic fallback
   * @param {Array} messages 
   * @param {Object} options 
   */
  async streamMessage(messages, options = {}) {
    let lastError = null
    const providersToTry = [this.currentProvider, ...this.fallbackProviders]

    for (const providerName of providersToTry) {
      const provider = this.providers.get(providerName)
      if (!provider || !provider.available || !provider.capabilities.streaming) continue

      try {
        // Optimize messages for this provider
        const optimizedMessages = await this.optimizeForProvider(messages, providerName)
        
        // Add provider-specific options
        const providerOptions = this.getProviderOptions(providerName, options)

        // Stream request
        const stream = await provider.instance.streamMessage(
          optimizedMessages, 
          providerOptions
        )

        // Wrap stream to track usage
        return this.wrapStream(stream, providerName)
      } catch (error) {
        lastError = error
        console.error(`${providerName} streaming failed:`, error)
        provider.available = false
      }
    }

    throw lastError || new Error('Streaming not available. Please check your API configuration.')
  }

  /**
   * Optimize messages for specific provider
   * @param {Array} messages 
   * @param {string} providerName 
   */
  async optimizeForProvider(messages, providerName) {
    const provider = this.providers.get(providerName)
    if (!provider) return messages

    // Handle context window limits
    const contextWindow = provider.capabilities.contextWindow
    let optimized = messages

    // Truncate if needed
    const totalTokens = this.estimateTokens(messages)
    if (totalTokens > contextWindow * 0.9) {
      optimized = await this.truncateMessages(messages, contextWindow * 0.8)
    }

    // Provider-specific optimizations
    if (providerName === 'anthropic') {
      // Anthropic-specific optimizations
      return this.optimizeForAnthropic(optimized)
    } else if (providerName === 'openai') {
      // OpenAI-specific optimizations
      return this.optimizeForOpenAI(optimized)
    }

    return optimized
  }

  /**
   * Get provider-specific options
   * @param {string} providerName 
   * @param {Object} options 
   */
  getProviderOptions(providerName, options) {
    const baseOptions = { ...options }

    if (providerName === 'anthropic') {
      // Map to Anthropic format
      return {
        ...baseOptions,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature || 0.7
      }
    } else if (providerName === 'openai') {
      // Map to OpenAI format
      return {
        ...baseOptions,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      }
    }

    return baseOptions
  }

  /**
   * Optimize messages for Anthropic
   * @param {Array} messages 
   */
  optimizeForAnthropic(messages) {
    // Anthropic-specific optimizations
    return messages.map(msg => {
      if (msg.role === 'system') {
        // Convert system messages to user messages with Human: prefix
        return {
          role: 'user',
          content: `System: ${msg.content}`
        }
      }
      return msg
    })
  }

  /**
   * Optimize messages for OpenAI
   * @param {Array} messages 
   */
  optimizeForOpenAI(messages) {
    // OpenAI-specific optimizations
    return messages
  }

  /**
   * Estimate token count for messages
   * @param {Array} messages 
   */
  estimateTokens(messages) {
    // Simple estimation: ~4 characters per token
    const text = messages.map(m => m.content).join(' ')
    return Math.ceil(text.length / 4)
  }

  /**
   * Truncate messages to fit context window
   * @param {Array} messages 
   * @param {number} maxTokens 
   */
  async truncateMessages(messages, maxTokens) {
    // Keep system message and most recent messages
    const systemMsg = messages.find(m => m.role === 'system')
    const otherMessages = messages.filter(m => m.role !== 'system')
    
    // Start with most recent and work backwards
    const truncated = []
    let tokenCount = 0
    
    if (systemMsg) {
      truncated.push(systemMsg)
      tokenCount += this.estimateTokens([systemMsg])
    }

    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens([otherMessages[i]])
      if (tokenCount + msgTokens > maxTokens) break
      
      truncated.unshift(otherMessages[i])
      tokenCount += msgTokens
    }

    return truncated
  }

  /**
   * Wrap stream to track usage
   * @param {AsyncGenerator} stream 
   * @param {string} providerName 
   */
  async* wrapStream(stream, providerName) {
    let tokenCount = 0
    
    try {
      for await (const chunk of stream) {
        tokenCount += this.estimateTokens([{ content: chunk.content || '' }])
        yield chunk
      }
    } finally {
      this.trackUsage(providerName, { usage: { total_tokens: tokenCount } })
    }
  }

  /**
   * Track usage statistics
   * @param {string} providerName 
   * @param {Object} response 
   */
  trackUsage(providerName, response) {
    if (response.usage) {
      this.usage.tokens += response.usage.total_tokens || 0
      this.usage.requests++
      
      // Estimate cost (simplified)
      const costPerToken = providerName === 'anthropic' ? 0.000003 : 0.000002
      this.usage.cost += (response.usage.total_tokens || 0) * costPerToken
    }
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      ...this.usage,
      providers: Array.from(this.providers.entries()).map(([name, provider]) => ({
        name,
        available: provider.available,
        models: provider.models
      }))
    }
  }

  /**
   * Switch provider
   * @param {string} providerName 
   */
  async switchProvider(providerName) {
    const isAvailable = await this.checkProviderAvailability(providerName)
    if (!isAvailable) {
      throw new Error(`Provider ${providerName} is not available. Please check your API key.`)
    }
    
    this.currentProvider = providerName
    this.setupFallbackChain()
  }

  /**
   * Get available models for current provider
   */
  getAvailableModels() {
    const provider = this.providers.get(this.currentProvider)
    return provider ? provider.models : []
  }
}

// Export singleton instance
module.exports = new ModelManager()