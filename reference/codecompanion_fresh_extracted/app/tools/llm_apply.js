const { OpenAI } = require('openai');

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

// const API_KEY = 'csk-tcnm6mepj263jxn65hpxe5trfvprnxn6etrwnxd94rtdc9x8';
// const BASE_URL = "https://api.cerebras.ai/v1";
// const MODEL = "llama-3.3-70b";

const API_KEY = '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';
const BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "qwen/qwen3-32b"; // meta-llama/llama-4-scout , meta-llama/llama-3.3-70b-instruct, qwen/qwen3-32b

const MAX_TOKENS = 15000;

class LLMApply {
  constructor() {
    this.client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      dangerouslyAllowBrowser: true,
      maxRetries: 5,
    });
  }

  async apply(changes, fileContent) {
    this.fileContent = fileContent;
    const messages = this.buildMessages(changes, fileContent);
    
    const content = await this.makeRequest(messages);
    return this.formatResponse(content);
  }

  async makeRequest(messages) {
    const request = {
      messages: messages,
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      provider: {
        sort: 'throughput'
      }
    };
    const response = await this.client.chat.completions.create(request);
    return response.choices[0].message.content;
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