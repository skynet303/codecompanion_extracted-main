/**
 * Enhanced Search Manager
 * Uses Serper API when available for better results, falls back to Google Custom Search
 */

const GoogleSearch = require('./google_search');
const SerperSearch = require('./serper_search');

class EnhancedSearch {
  constructor() {
    this.googleSearch = new GoogleSearch();
    this.serperSearch = new SerperSearch();
    this.preferredResults = 100; // Always try to get maximum results
  }

  async search(query, options = {}) {
    const maxResults = options.maxResults || this.preferredResults;
    
    // Try Serper first if available
    if (this.serperSearch.apiKey) {
      console.log(`Using Serper API for search: "${query}"`);
      const serperResults = await this.serperSearch.search(query, { num: maxResults });
      
      if (serperResults && serperResults.results && serperResults.results.length > 0) {
        console.log(`Serper returned ${serperResults.results.length} results`);
        return {
          provider: 'serper',
          results: serperResults.results,
          raw: serperResults
        };
      }
    }
    
    // Fall back to Google Custom Search
    console.log(`Using Google Custom Search for: "${query}"`);
    const googleResults = await this.googleSearch.searchWithPagination(query, maxResults);
    
    return {
      provider: 'google',
      results: googleResults || [],
      raw: { results: googleResults }
    };
  }

  async multiSearch(queries, options = {}) {
    const maxResultsPerQuery = Math.ceil((options.maxTotalResults || this.preferredResults) / queries.length);
    
    // Try Serper first
    if (this.serperSearch.apiKey) {
      const serperResults = await this.serperSearch.multiSearch(queries, { num: maxResultsPerQuery });
      if (serperResults && serperResults.length > 0) {
        return {
          provider: 'serper',
          results: serperResults,
          raw: serperResults
        };
      }
    }
    
    // Fall back to Google
    const googleResults = await this.googleSearch.search(queries, options.maxTotalResults || this.preferredResults);
    return {
      provider: 'google',
      results: googleResults || [],
      raw: googleResults
    };
  }

  /**
   * Smart search that processes results and extracts content
   */
  async smartSearch(query, options = {}) {
    const searchResults = await this.search(query, options);
    const processedResults = [];
    
    viewController.updateLoadingIndicator(true, `Found ${searchResults.results.length} results from ${searchResults.provider}`);
    
    // Process different result types
    for (const result of searchResults.results) {
      if (result.type === 'answer_box' || result.type === 'knowledge_graph') {
        // These already have good content
        processedResults.push({
          ...result,
          processed: true,
          content: result.snippet
        });
      } else if (result.type === 'related_searches') {
        // Just include as metadata
        processedResults.push(result);
      } else if (result.link) {
        // Regular search results - we can fetch their content if needed
        processedResults.push({
          ...result,
          processed: false
        });
      }
    }
    
    viewController.updateLoadingIndicator(false);
    
    return {
      provider: searchResults.provider,
      results: processedResults,
      totalResults: searchResults.results.length,
      hasAnswerBox: processedResults.some(r => r.type === 'answer_box'),
      hasKnowledgeGraph: processedResults.some(r => r.type === 'knowledge_graph')
    };
  }

  /**
   * Check if Serper API is configured
   */
  hasSerperApi() {
    return !!this.serperSearch.apiKey;
  }

  /**
   * Get search statistics
   */
  getSearchCapabilities() {
    return {
      serperAvailable: this.hasSerperApi(),
      googleAvailable: true,
      maxResultsSerper: this.hasSerperApi() ? 100 : 0,
      maxResultsGoogle: 100,
      preferredProvider: this.hasSerperApi() ? 'serper' : 'google'
    };
  }
}

// Export singleton instance
module.exports = new EnhancedSearch(); 