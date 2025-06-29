/**
 * Enhanced Search Core Module
 * Decoupled version of enhanced search without UI dependencies
 * Suitable for use in both main agent and planner contexts
 */

const GoogleSearch = require('./google_search');

class SerperSearchCore {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'google.serper.dev';
  }

  async search(query, options = {}) {
    const {
      num = 100,
      gl = 'us',
      hl = 'en',
      page = 1,
      type = 'search'
    } = options;

    if (!this.apiKey) {
      return null;
    }

    const https = require('https');
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        q: query,
        gl,
        hl,
        num,
        page
      });

      const requestOptions = {
        hostname: this.baseUrl,
        port: 443,
        path: `/${type}`,
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            const formattedResults = this._formatResults(response);
            resolve(formattedResults);
          } catch (error) {
            reject(new Error(`Failed to parse Serper response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  _formatResults(response) {
    const results = [];
    
    // Include answer box if available
    if (response.answerBox) {
      results.push({
        type: 'answer_box',
        title: response.answerBox.title || 'Answer',
        snippet: response.answerBox.answer || response.answerBox.snippet,
        link: response.answerBox.link,
        position: 0
      });
    }
    
    // Include knowledge graph if available
    if (response.knowledgeGraph) {
      results.push({
        type: 'knowledge_graph',
        title: response.knowledgeGraph.title,
        snippet: response.knowledgeGraph.description,
        link: response.knowledgeGraph.website,
        attributes: response.knowledgeGraph.attributes,
        position: 0
      });
    }
    
    // Include organic results
    if (response.organic) {
      response.organic.forEach((result, index) => {
        results.push({
          type: 'organic',
          title: result.title,
          snippet: result.snippet,
          link: result.link,
          position: result.position || index + 1
        });
      });
    }
    
    // Include related searches
    if (response.relatedSearches) {
      results.push({
        type: 'related_searches',
        queries: response.relatedSearches,
        position: results.length
      });
    }
    
    return {
      results,
      searchInformation: {
        totalResults: response.searchInformation?.totalResults,
        timeTaken: response.searchInformation?.timeTaken,
        credits: response.credits
      }
    };
  }
}

class EnhancedSearchCore {
  constructor(options = {}) {
    this.serperApiKey = options.serperApiKey;
    this.googleSearch = new GoogleSearch();
    this.serperSearch = this.serperApiKey ? new SerperSearchCore(this.serperApiKey) : null;
    this.progressCallback = options.progressCallback;
    this.preferredResults = 100;
  }

  /**
   * Main search method with automatic provider selection
   */
  async search(query, options = {}) {
    const maxResults = options.maxResults || this.preferredResults;
    
    // Notify progress
    this._notifyProgress(`Starting search for: "${query}"`);
    
    // Try Serper first if available
    if (this.serperSearch) {
      try {
        this._notifyProgress(`Searching with Serper API...`);
        const serperResults = await this.serperSearch.search(query, { num: maxResults });
        
        if (serperResults && serperResults.results && serperResults.results.length > 0) {
          this._notifyProgress(`Found ${serperResults.results.length} results from Serper`);
          return {
            provider: 'serper',
            results: serperResults.results,
            searchInformation: serperResults.searchInformation,
            raw: serperResults
          };
        }
      } catch (error) {
        console.warn('Serper search failed:', error.message);
      }
    }
    
    // Fall back to Google Custom Search
    this._notifyProgress(`Searching with Google Custom Search...`);
    const googleResults = await this.googleSearch.searchWithPagination(query, maxResults);
    
    this._notifyProgress(`Found ${googleResults.length} results from Google`);
    
    return {
      provider: 'google',
      results: googleResults || [],
      searchInformation: { totalResults: googleResults.length },
      raw: { results: googleResults }
    };
  }

  /**
   * Smart search that processes and ranks results
   */
  async smartSearch(query, options = {}) {
    const searchResults = await this.search(query, options);
    const processedResults = [];
    
    this._notifyProgress(`Processing ${searchResults.results.length} results...`);
    
    // Process and score results
    for (const result of searchResults.results) {
      let score = 1.0;
      
      // Higher score for answer boxes and knowledge graphs
      if (result.type === 'answer_box') score = 2.0;
      if (result.type === 'knowledge_graph') score = 1.8;
      
      // Score based on position
      if (result.position) {
        score *= (1.0 - (result.position - 1) * 0.01);
      }
      
      processedResults.push({
        ...result,
        relevanceScore: score,
        processed: true
      });
    }
    
    // Sort by relevance score
    processedResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    
    this._notifyProgress(null); // Clear progress
    
    return {
      provider: searchResults.provider,
      results: processedResults,
      totalResults: searchResults.results.length,
      hasAnswerBox: processedResults.some(r => r.type === 'answer_box'),
      hasKnowledgeGraph: processedResults.some(r => r.type === 'knowledge_graph'),
      searchInformation: searchResults.searchInformation
    };
  }

  /**
   * Get search capabilities
   */
  getCapabilities() {
    return {
      serperAvailable: !!this.serperSearch,
      googleAvailable: true,
      maxResultsSerper: this.serperSearch ? 100 : 0,
      maxResultsGoogle: 100,
      preferredProvider: this.serperSearch ? 'serper' : 'google'
    };
  }

  _notifyProgress(message) {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
  }
}

module.exports = EnhancedSearchCore;