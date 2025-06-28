# Tool Execution Chain Map for CodeCompanion

## Overview
The tool execution chain in CodeCompanion is a sophisticated system that allows the AI assistant to perform various actions like file operations, shell commands, web browsing, and code searching. This document maps out the complete flow from tool definition to execution.

For visual representations of these flows, see **[TOOL_EXECUTION_FLOW_DIAGRAM.md](./TOOL_EXECUTION_FLOW_DIAGRAM.md)**.

## 1. Tool Definition Structure

### Main Tool Registry (`app/tools/tools.js`)
Tools are defined in a `toolDefinitions` array with the following structure:

```javascript
{
  name: 'tool_name',                    // Unique identifier
  description: 'Tool description',      // Used by LLM to understand tool purpose
  parameters: {                         // JSON Schema for parameters
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' },
      param2: { type: 'boolean', default: false }
    },
    required: ['param1']
  },
  executeFunction: functionReference,   // The actual function to execute
  enabled: true,                       // Whether tool is available
  approvalRequired: true               // Whether user approval is needed
}
```

### Available Tools:
1. **web_browser** - Opens URLs and retrieves page content or console output
2. **file_operation** - Create, read, or update files
3. **run_shell_command** - Execute terminal commands
4. **research** - Perform various research operations (search code, grep, etc.)
5. **think** - Log thoughts for complex reasoning

### Planner-Specific Tools (`app/chat/planner/tools.js`)
The planner has its own tools:
1. **read_files** - Read multiple files at once
2. **search_codebase** - Semantic search for code
3. **web_search** - Search the web for information
4. **output** - Output task results

## 2. Tool Registration and Filtering

### Tool Filtering Functions
```javascript
allEnabledTools()          // Returns all enabled tools
allEnabledExcept(names)    // Returns enabled tools except specified ones
getEnabledTools(filterFn)  // Custom filtering with shell type substitution
```

### Dynamic Tool Availability
- Tools are filtered based on `enabled` flag
- Shell type is dynamically substituted in descriptions
- Tools can be conditionally available based on context

## 3. LLM Integration

### Tool Formatting for Models

#### Anthropic Model (`app/models/anthropic.js`)
```javascript
anthropicToolFormat(tool) {
  const { parameters, ...rest } = tool;
  return {
    ...rest,
    input_schema: parameters  // Renames parameters to input_schema
  };
}
```

Tools are added to the request with cache control:
```javascript
callParams.tools = this.cachingManager.addCacheControlToTools(formattedTools);
```

#### OpenAI Model (`app/models/openai.js`)
Uses standard OpenAI function calling format with tools array.

### Model Call Flow
1. Chat controller builds messages via `chatContextBuilder.build()`
2. Gets enabled tools via `allEnabledTools()`
3. Passes tools to model's `call()` method
4. Model formats tools according to its API requirements

## 4. Tool Call Processing

### Response Parsing

#### Anthropic Response
Tool calls come as content items with type 'tool_use':
```javascript
formattedToolCalls(content) {
  const toolCalls = content.filter(item => item.type === 'tool_use');
  return toolCalls.map(toolCall => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: toolCall.input
    }
  }));
}
```

#### OpenAI Response
Tool calls come in the standard format with accumulation for streaming.

### Agent Processing (`app/chat/agent.js`)

1. **Initial Processing**
   ```javascript
   async runAgent(apiResponseMessage) {
     if (apiResponseMessage.tool_calls) {
       const { decision } = await this.runTools(toolCalls);
       if (decision === 'approve') {
         await chatController.process('', false);  // Continue conversation
       }
     }
   }
   ```

2. **Tool Execution Loop**
   ```javascript
   async runTools(toolCalls) {
     this.cacheApplyInParallel(toolCalls);  // Pre-cache file operations
     
     for (const toolCall of toolCalls) {
       // Validate tool exists
       // Check permissions (file operations)
       // Show preview
       // Wait for approval if required
       // Execute tool
       // Handle results
     }
   }
   ```

## 5. Approval Flow

### Decision Points
1. Tool requires approval (`approvalRequired: true`)
2. Tool call is repeated (prevents loops)
3. File operations have special validation

### File Operation Validation
- **Create**: Checks if file already exists
- **Update**: Ensures file exists and is in chat context
- **Read**: Always allowed

### User Interaction
```javascript
async showApprovalButtons() {
  // Disable message input
  // Show approve/reject/pause buttons
  // Wait for user decision
  // Return decision
}
```

## 6. Tool Execution

### Execution Flow
```javascript
async callFunction(toolCall) {
  // 1. Update UI indicators
  viewController.updateLoadingIndicator(true);
  
  // 2. Parse arguments
  const args = this.parseArguments(toolCall.function.arguments);
  
  // 3. Find tool definition
  const tool = toolDefinitions.find(t => t.name === functionName);
  
  // 4. Create checkpoint (for rollback)
  await this.projectController.checkpoints.create(toolCall.id);
  
  // 5. Execute function
  result = await tool.executeFunction(args);
  
  // 6. Return result
  return result;
}
```

### Tool Function Implementation Pattern
Each tool function follows this pattern:
1. Validate inputs
2. Perform operation
3. Update UI (frontend messages)
4. Return result for backend

Example - File Operation:
```javascript
async fileOperation({ operation, targetFile, content }) {
  switch (operation) {
    case 'create': return createFile({ targetFile, content });
    case 'update': return updateFile({ targetFile, content });
    case 'read': return readFile({ targetFile });
  }
}
```

## 7. Result Handling

### Backend Message Storage
```javascript
chatController.chat.addBackendMessage(
  'tool',              // role
  functionCallResult,  // content
  null,               // toolCalls
  functionName,       // name
  toolCall.id         // tool_call_id
);
```

### Frontend Feedback
- Success messages with file links
- Error alerts with suggestions
- Progress indicators
- Loading states

### Error Recovery
- Terminal error monitoring with pattern matching
- Automatic error analysis and suggestions
- Critical error recovery with retry logic
- Checkpoint system for rollback

## 8. Special Features

### Parallel Execution Cache
For multiple file updates, subsequent operations are pre-cached:
```javascript
cacheApplyInParallel(toolCalls) {
  fileOperationCalls.slice(1).forEach(toolCall => {
    applyChanges(args);  // Pre-compute diffs
  });
}
```

### Research Tool Orchestration
The research tool can execute multiple sub-operations in parallel:
- search_filenames
- search_codesnippets
- google_search
- list_files_in_directory
- grep_search
- find_code_changes

### Preview System
Before execution, tools show previews:
- File operations show diffs
- Shell commands show the command
- Think tool shows thoughts

## 9. Integration Points

### Chat Controller
- Manages the conversation flow
- Initializes models with tools
- Handles tool approval UI

### Agent
- Processes tool calls from LLM
- Manages approval flow
- Executes tools and handles results

### View Controller
- Updates UI during tool execution
- Shows loading indicators
- Displays results and errors

### Context Builder
- Manages which files are in context
- Affects file operation permissions

## 10. Tool Execution Lifecycle

1. **Definition** → Tools defined with schema and execute function
2. **Registration** → Tools filtered and formatted for model
3. **Model Call** → Tools passed to LLM with messages
4. **Response** → LLM returns tool calls in response
5. **Validation** → Agent validates tool exists and permissions
6. **Preview** → User sees what will happen
7. **Approval** → User approves/rejects (if required)
8. **Execution** → Tool function runs with parsed arguments
9. **Result** → Result added to conversation
10. **Continuation** → Model called again with tool results

This creates a complete feedback loop where the LLM can use tool results to continue the task until completion.