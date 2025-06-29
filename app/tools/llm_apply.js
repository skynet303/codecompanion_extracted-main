const PROMPT = `
You are file editor.

You will receive:
1. The current content of a code file between <file_content> tags
2. A description of changes to make between <changes> tags

Your task is to:
1. Carefully analyze the file content and requested changes
2. Apply the changes exactly as specified
3. Return ONLY the complete updated file content, with no additional explanation as it should be written to the file

Follow these guidelines:
<important_guidelines>
- Make only the requested changes EXACTLY as specified. Even if you don't understand the changes, or think something is wrong or missing. 
- You are only provided with lines of code that need to be changed. Rest of the code should stay the same.
- Do not add any comments that are used to explain the changes that need to be made or you couldn't make the changes.
- Do not add XML tag like: <file_content>, those are used to wrap the file content and changes for you to read.
- Preserve correct indentation and formatting in result keeping the same as the original file content but making sure code syntax is correct.
- You may be provided block or blocks of code with changes. Rest of the code should stay the same.
- There could be code comments how to apply the changes. Follow them, but do not add them to the result.
- Return entire file content with changes applied
</important_guidelines>
`;

const TEMPERATURE = 0.1;
const MAX_TOKENS = 15000;

class LLMApply {
  constructor() {
    // Will use the small model from chat controller instead of hardcoded credentials
    this.client = null;
  }

  async apply(changes, fileContent) {
    this.fileContent = fileContent;
    const messages = this.buildMessages(changes, fileContent);
    
    const content = await this.makeRequest(messages);
    return this.formatResponse(content);
  }

  async makeRequest(messages) {
    // Use the small model from chat controller
    if (!chatController || !chatController.smallModel) {
      throw new Error('Chat controller or small model not available');
    }

    try {
      // Create a new instance of the small model with a dummy stream callback
      const ModelClass = chatController.smallModel.constructor;
      const tempModel = new ModelClass({
        ...chatController.smallModel,
        apiKey: chatController.smallModel.client.apiKey,
        baseUrl: chatController.smallModel.client.baseURL,
        model: chatController.smallModel.model,
        chatController: chatController,
        streamCallback: () => {}, // Dummy callback since we don't need streaming
        defaultHeaders: chatController.smallModel.client.defaultHeaders
      });

      // Call the model without streaming
      const response = await tempModel.call({
        messages: messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS
      });

      // Extract content from response
      if (response && response.content) {
        return response.content;
      } else {
        throw new Error('Invalid response format from model');
      }
    } catch (error) {
      console.error('[LLMApply] Error calling small model:', error);
      throw error;
    }
  }

  buildMessages(changes, fileContent) {
    return [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `<file_content>\n${fileContent}\n</file_content>\n\n<changes>\n${changes}\n</changes>` },
    ];
  }

  formatResponse(content) {
    let result = content;

    if (result.includes('<think>')) {
      result = result.replace(/<think>[\s\S]*?<\/think>\n?\n/g, '');
    }

    if (result.startsWith('```')) {
      result = result.split('\n').slice(1).join('\n');
    }
    if (result.endsWith('```')) {
      result = result.split('\n').slice(0, -1).join('\n');
    }
    
    if (result.includes('<file_content>')) {
      result = result.replace('<file_content>\n', '').replace('</file_content>', '');
    }
    
    if (result.includes('<file_content>')) {
      result = result.replace('<file_content>', '');
    }
    
    if (result.includes('</file_content>')) {
      result = result.replace('</file_content>', '');
    }
    
    return this.fileContent.endsWith('\n\n') ? result.trimEnd() + '\n\n' : result.trimEnd() + '\n';
  }
}

module.exports = LLMApply;
