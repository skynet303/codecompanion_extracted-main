// Example fix for integrating EnhancedSearch into Planner tools
// This would replace the current webSearch function in app/chat/planner/tools.js

const EnhancedSearch = require('../../tools/enhanced_search');

async function webSearch({ query }) {
  try {
    // Use EnhancedSearch instead of GoogleSearch directly
    const searchResults = await EnhancedSearch.search(query, { maxResults: 100 });
    
    if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
      return JSON.stringify({ error: 'No search results found' });
    }
    
    // Process results based on provider
    let processedResults;
    if (searchResults.provider === 'serper') {
      // Include rich results from Serper
      processedResults = searchResults.results.map(result => {
        if (result.type === 'answer_box') {
          return {
            type: 'answer_box',
            content: result.snippet,
            source: result.link || 'Direct Answer'
          };
        } else if (result.type === 'knowledge_graph') {
          return {
            type: 'knowledge_graph',
            title: result.title,
            content: result.snippet,
            attributes: result.attributes
          };
        } else {
          return {
            type: 'organic',
            url: result.link,
            title: result.title,
            snippet: result.snippet || ''
          };
        }
      });
    } else {
      // Google results
      processedResults = searchResults.results.map(result => ({
        type: 'organic',
        url: result.link,
        title: result.title,
        snippet: result.snippet || ''
      }));
    }
    
    return JSON.stringify({
      provider: searchResults.provider,
      results: processedResults.slice(0, 50), // Return up to 50 results for research
      totalSearched: searchResults.results.length,
      hasAnswerBox: processedResults.some(r => r.type === 'answer_box'),
      hasKnowledgeGraph: processedResults.some(r => r.type === 'knowledge_graph'),
      query: query
    });
  } catch (error) {
    console.error('Error in web search:', error);
    return JSON.stringify({ error: `Search failed: ${error.message}` });
  }
}

// Note: EnhancedSearch has viewController dependencies that would need to be handled
// One approach: Make viewController optional in EnhancedSearch
// Another approach: Pass a null-safe progress callback to EnhancedSearch