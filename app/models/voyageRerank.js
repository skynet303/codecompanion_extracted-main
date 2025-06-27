const { VoyageAIClient } = require("voyageai");

const DEFAULT_MODEL = "rerank-2";

class VoyageAIReranker {
  constructor() {
    this.client = new VoyageAIClient({ apiKey: "pa-eNGJmpuqIX15Q0BFy2Ui-u26cuuxz0v8KfGiLGE3iXB" });
  }

  async rerank(query, documents, indexesOnly = false, model = DEFAULT_MODEL) {
    if (!documents || documents.length === 0) {
      return [];
    }
    
    try {
      const result = await this.performReranking(query, documents, model);
      if (indexesOnly) {
        return result.data.map(item => item.index);
      }
      const rerankedDocuments = this.processResults(result, documents);
      return rerankedDocuments;
    } catch (error) {
      return this.handleError(error, documents, indexesOnly);
    }
  }

  async performReranking(query, documents, model) {
    const options = {
      timeoutInSeconds: 5,
      maxRetries: 2,
    };
    const result = await this.client.rerank({ query, documents, model }, options);
    return result;
  }

  processResults(result, documents) {
    return result.data.map(item => documents[item.index]);
  }

  handleError(error, documents, indexesOnly) {
    console.error('Reranking failed:', error);
    if (indexesOnly) {
      return documents.map((_, index) => index);
    }
    return documents;
  }
}

module.exports = VoyageAIReranker;
