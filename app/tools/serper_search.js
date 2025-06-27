/**
 * Serper API Search Implementation
 * Provides more comprehensive search results than Google Custom Search
 */

const https = require('https');

class SerperSearch {
  constructor() {
    // Get API key from environment or settings
    this.apiKey = process.env.SERPER_API_KEY || chatController?.settings?.serperApiKey || '00bed7d81443fad90807903e5050fd9a0a9e4228';
    this.baseUrl = 'google.serper.dev';
  }

  async search(query, options = {}) {
    const {
      num = 100,  // Default to maximum results
      gl = 'us',  // Country
      hl = 'en',  // Language
      page = 1,
      type = 'search' // Can be 'search', 'images', 'news', 'places', 'shopping'
    } = options;

    if (!this.apiKey) {
      console.warn('Serper API key not configured. Falling back to Google Custom Search.');
      return null;
    }

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

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            if (res.statusCode !== 200) {
              console.error(`Serper API error: ${res.statusCode} - ${data}`);
              resolve(null);
              return;
            }

            resolve(this.formatResults(result));
          } catch (error) {
            console.error('Error parsing Serper response:', error);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        console.error('Serper API request error:', error);
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  formatResults(serperResponse) {
    const results = [];

    // Organic search results
    if (serperResponse.organic) {
      serperResponse.organic.forEach((item, index) => {
        results.push({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          position: item.position || index + 1,
          relevancy_score: 1 - (index / serperResponse.organic.length),
          type: 'organic'
        });
      });
    }

    // Knowledge graph
    if (serperResponse.knowledgeGraph) {
      const kg = serperResponse.knowledgeGraph;
      if (kg.description) {
        results.unshift({
          title: kg.title || 'Knowledge Graph',
          link: kg.descriptionLink || kg.website || '',
          snippet: kg.description,
          position: 0,
          relevancy_score: 1.5, // Give knowledge graph higher priority
          type: 'knowledge_graph',
          metadata: kg
        });
      }
    }

    // Answer box
    if (serperResponse.answerBox) {
      const ab = serperResponse.answerBox;
      results.unshift({
        title: ab.title || 'Direct Answer',
        link: ab.link || '',
        snippet: ab.answer || ab.snippet,
        position: 0,
        relevancy_score: 2, // Highest priority for direct answers
        type: 'answer_box'
      });
    }

    // People also ask
    if (serperResponse.peopleAlsoAsk) {
      serperResponse.peopleAlsoAsk.forEach((item, index) => {
        results.push({
          title: item.question,
          link: item.link || '',
          snippet: item.answer || item.snippet || '',
          position: 100 + index, // Lower priority
          relevancy_score: 0.5 - (index * 0.1),
          type: 'people_also_ask'
        });
      });
    }

    // Related searches
    if (serperResponse.relatedSearches) {
      results.push({
        type: 'related_searches',
        searches: serperResponse.relatedSearches.map(s => s.query || s),
        relevancy_score: 0.3
      });
    }

    return {
      results: results.sort((a, b) => b.relevancy_score - a.relevancy_score),
      searchInformation: serperResponse.searchInformation,
      credits: serperResponse.credits
    };
  }

  async multiSearch(queries, options = {}) {
    const results = await Promise.all(
      queries.map(query => this.search(query, options))
    );
    
    // Combine and deduplicate results
    const allResults = [];
    const seenUrls = new Set();
    
    results.forEach((searchResult, queryIndex) => {
      if (searchResult && searchResult.results) {
        searchResult.results.forEach(item => {
          if (item.link && !seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            allResults.push({
              ...item,
              queryIndex,
              relevancy_score: item.relevancy_score * (1 - queryIndex * 0.1)
            });
          }
        });
      }
    });
    
    return allResults.sort((a, b) => b.relevancy_score - a.relevancy_score);
  }
}

module.exports = SerperSearch; 