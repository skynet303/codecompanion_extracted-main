const PROMPT = `
You are a conversation summarizer.

Compress conversation_history without losing important information.

Follow these rules for summarization:
  - Preserve each message and order of messages.
  - Preserve each message word for word without alteration for "user" message content that is not a type of "tool_result".
  - Compress assistant messages into maximum 3 sentences.
  - Extract only meaningfull content from tool_call and tool_result.
  - Preserve only important information from search results.
  - Compress results of results of terminal commands into maximum 3 sentences.
  - Preserve file names and actions performed on them and what was changed.

Important:
 - Do not use words like "tool_use", "tool_result", "tool_call", etc. Just use natural language to describe actions.
 - Do not use JSON format, just use natural language in sentences.
 - For assistant "think" extract "thought" word for word without alteration.
`;

const STRING_FORMAT = { type: 'string', description: 'The summarized conversation.' };

class LLMSummarize {
  async summarize(conversationHistory) {
    const prompt = `${PROMPT}\n\nCompress the following conversation history:\n<conversation_history>\n${JSON.stringify(conversationHistory, null, 2)}\n</conversation_history>`;
    const request = {
      prompt: prompt,
      format: STRING_FORMAT
    };
    
    try {
      const content = await chatController.backgroundTask.run(request);
      
      if (!content) {
        console.error("LLMSummarize: Background task failed to return content.");
        return null;
      }
      
      return content;
    } catch (error) {
      console.error("LLMSummarize: Error during background task execution:", error);
      return null;
    }
  }
}

module.exports = LLMSummarize;
