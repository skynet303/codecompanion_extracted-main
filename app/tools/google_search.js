const { customsearch } = require('@googleapis/customsearch');
const VoyageAIReranker = require('../models/voyageRerank');

// Maximum results to return - Google Custom Search API allows max 10 per query
// To get 100 results, we'd need to make multiple paginated requests
const MAX_RESULTS = 100;
const RESULTS_PER_PAGE = 10; // Google CSE limit per request

class GoogleSearch {
  constructor() {
    // This keys are provided out of good will for the community, please do not abuse them or you will get them revoked.
    this.apiKey = 'AIzaSyBz23MqA2IKu3mjKLIb02OWcLg_o4nEn6A';
    this.cxId = '80a4581942dad4e4d';
    this.reranker = new VoyageAIReranker();
  }

  async singleSearch(query, startIndex = 1) {
    try {
      const res = await customsearch('v1').cse.list({
        cx: this.cxId,
        q: query,
        auth: this.apiKey,
        start: startIndex,
        num: RESULTS_PER_PAGE
      });
      return res.data.items || [];
    } catch (error) {
      console.error(`Search error at index ${startIndex}:`, error.message);
      return [];
    }
  }

  async searchWithPagination(query, maxResults = MAX_RESULTS) {
    const allResults = [];
    const numPages = Math.min(Math.ceil(maxResults / RESULTS_PER_PAGE), 10); // Google CSE limits to 100 results total
    
    // Make parallel requests for faster results
    const promises = [];
    for (let page = 0; page < numPages; page++) {
      const startIndex = page * RESULTS_PER_PAGE + 1;
      promises.push(this.singleSearch(query, startIndex));
    }
    
    const pageResults = await Promise.all(promises);
    
    // Flatten and combine all results
    for (const results of pageResults) {
      allResults.push(...results);
    }
    
    return allResults.slice(0, maxResults);
  }

  async multipleSearch(queries, maxResultsPerQuery = MAX_RESULTS) {
    const promises = queries.map((query) => this.searchWithPagination(query, maxResultsPerQuery));
    const results = await Promise.all(promises);
    return results;
  }

  async search(queries, maxTotalResults = MAX_RESULTS) {
    let formattedResults = [];
    let results = await this.multipleSearch(queries, Math.ceil(maxTotalResults / queries.length));

    if (results) {
      formattedResults = results.map((result, queryIndex) => {
        if (result && result.length > 0) {
          return result.map((item, index) => {
            return {
              relevancy_score: (1 - queryIndex * 0.1) * (1 - index / result.length),
              title: item.title,
              link: item.link,
              snippet: item.snippet,
              queryIndex: queryIndex
            };
          });
        }
        return [];
      });
      
      formattedResults = formattedResults.flat().sort((a, b) => b.relevancy_score - a.relevancy_score);
      
      // Remove duplicates based on URL
      formattedResults = formattedResults
        .filter((item, index, self) => {
          return index === self.findIndex((t) => t.link === item.link);
        })
        .slice(0, maxTotalResults);
      
      // If we have voyage reranker and results aren't too many, rerank them
      if (this.reranker && formattedResults.length <= 100) {
        try {
          const documents = formattedResults.map((result) => result.title + "\n\n" + result.snippet);
          const rerankedIndexes = await this.reranker.rerank(queries[0], documents, true);
          return rerankedIndexes.map((index) => formattedResults[index]);
        } catch (error) {
          console.error('Reranking failed:', error.message);
          // Fall back to original relevancy scoring
        }
      }
      
      return formattedResults;
    }
    
    return [];
  }
}

module.exports = GoogleSearch;
