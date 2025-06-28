# Tool Execution Flow Diagram

## High-Level Flow

```
┌─────────────────┐
│   User Input    │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌──────────────────┐
│ Chat Controller │────>│ Context Builder  │
└────────┬────────┘     └──────────────────┘
         │                      │
         │  Messages + Context  │
         v                      v
┌─────────────────┐     ┌──────────────────┐
│  AI Model Call  │<────│ Tool Definitions │
└────────┬────────┘     └──────────────────┘
         │
         │ Response with tool_calls
         v
┌─────────────────┐
│  Agent Process  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Tool Validation │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Preview & Auth  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Tool Execution  │
└────────┬────────┘
         │
         │ Results
         v
┌─────────────────┐
│ Continue Chat   │
└─────────────────┘
```

## Detailed Tool Processing

```
                          ┌─────────────────────┐
                          │   API Response      │
                          │  with tool_calls    │
                          └──────────┬──────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  Agent.runAgent()  │
                          └─────────┬──────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  Agent.runTools()  │
                          └─────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              │              Parallel Cache               │
              │         (for multiple file ops)           │
              │                                          │
              └─────────────────────┬─────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  For Each Tool:    │
                          └─────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
          ┌─────────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
          │ Validate Tool  │ │  Check    │ │   Show      │
          │    Exists      │ │Permission │ │  Preview    │
          └────────────────┘ └───────────┘ └─────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ Approval Required? │
                          └─────────┬──────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
              ┌─────────▼──────┐      ┌────────▼────────┐
              │      Yes       │      │       No        │
              │ Show Buttons   │      │  Auto-approve   │
              └────────┬───────┘      └────────┬────────┘
                       │                       │
                       └───────────┬───────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  Execute Tool      │
                         │  Function          │
                         └─────────┬──────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  Store Result      │
                         │  Update UI         │
                         └─────────┬──────────┘
                                   │
                         ┌─────────▼──────────┐
                         │ Continue to Next   │
                         │ Tool or Finish     │
                         └────────────────────┘
```

## Tool Types and Their Execution

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Definitions                         │
├─────────────────┬───────────────┬──────────────┬──────────────┤
│  file_operation │ run_shell_cmd │ web_browser  │   research   │
├─────────────────┼───────────────┼──────────────┼──────────────┤
│                 │               │              │              │
│  ┌──────────┐  │  ┌─────────┐ │ ┌─────────┐ │ ┌──────────┐ │
│  │  create  │  │  │ execute │ │ │  load   │ │ │ parallel │ │
│  │  read    │  │  │ command │ │ │  URL    │ │ │ search   │ │
│  │  update  │  │  └─────────┘ │ └─────────┘ │ └──────────┘ │
│  └──────────┘  │       │       │      │      │      │       │
│       │         │       ▼       │      ▼      │      ▼       │
│       ▼         │  ┌─────────┐ │ ┌─────────┐ │ ┌──────────┐ │
│  ┌──────────┐  │  │terminal │ │ │ browser │ │ │ multiple │ │
│  │   file   │  │  │ session │ │ │ session │ │ │  types   │ │
│  │  system  │  │  └─────────┘ │ └─────────┘ │ └──────────┘ │
│  └──────────┘  │               │              │              │
└─────────────────┴───────────────┴──────────────┴──────────────┘
```

## Model-Specific Tool Formatting

```
┌────────────────────┐          ┌────────────────────┐
│   Tool Registry    │          │   Tool Registry    │
│  (Standard Format) │          │  (Standard Format) │
└─────────┬──────────┘          └─────────┬──────────┘
          │                                │
          ▼                                ▼
┌────────────────────┐          ┌────────────────────┐
│  Anthropic Model   │          │   OpenAI Model     │
├────────────────────┤          ├────────────────────┤
│ anthropicToolFormat│          │  Standard Format   │
│ • parameters →     │          │  • functions[]     │
│   input_schema     │          │  • No transform    │
│ • Cache control    │          │                    │
└────────────────────┘          └────────────────────┘
```

## Approval Flow States

```
                    ┌─────────────┐
                    │   Tool Call │
                    └──────┬──────┘
                           │
                  ┌────────▼────────┐
                  │ Check Approval  │
                  │   Required?     │
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐      ┌─────▼─────┐     ┌─────▼─────┐
   │   Yes   │      │ Repeated? │     │    No     │
   └────┬────┘      └─────┬─────┘     └─────┬─────┘
        │                  │                  │
        └──────────┬───────┘                  │
                   │                          │
         ┌─────────▼──────────┐               │
         │  Show UI Buttons   │               │
         ├────────────────────┤               │
         │ • Approve          │               │
         │ • Reject           │               │
         │ • Approve & Pause  │               │
         └─────────┬──────────┘               │
                   │                          │
       ┌───────────┼───────────┐              │
       │           │           │              │
  ┌────▼───┐  ┌───▼───┐  ┌───▼────┐         │
  │Approve │  │Reject │  │ Pause  │         │
  └────┬───┘  └───┬───┘  └───┬────┘         │
       │          │           │              │
       └──────────┼───────────┴──────────────┘
                  │
         ┌────────▼────────┐
         │ Execute/Skip    │
         └─────────────────┘
```

## Error Recovery Flow

```
┌─────────────────┐
│ Tool Execution  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Error?  │
    └────┬────┘
         │
    ┌────┴────┐
    │   Yes   │
    └────┬────┘
         │
┌────────▼────────┐      ┌─────────────────┐
│ Error Monitor   │─────>│ Pattern Match   │
└────────┬────────┘      └─────────────────┘
         │                        │
         │                   ┌────▼────┐
         │                   │Severity │
         │                   └────┬────┘
         │                        │
         │               ┌────────┼────────┐
         │               │        │        │
         │          ┌────▼───┐ ┌─▼──┐ ┌──▼────┐
         │          │Critical│ │Warn│ │ Info  │
         │          └────┬───┘ └─┬──┘ └──┬────┘
         │               │       │        │
         │               ▼       ▼        ▼
         │          ┌─────────────────────┐
         └─────────>│ Recovery Strategy   │
                    └──────────┬──────────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
               ┌────▼───┐ ┌───▼───┐ ┌───▼────┐
               │ Retry  │ │Suggest│ │Continue│
               └────────┘ └───────┘ └────────┘
```

## Data Flow Through Components

```
User Message
     │
     ▼
[Chat Controller] ──messages──> [Context Builder]
     │                                │
     │                          context files
     │                                │
     ▼                                ▼
[AI Model] <──tools── [Tool Registry]
     │
     │ response + tool_calls
     ▼
[Agent] ──validate──> [Tool Validator]
     │                        │
     │                   permissions
     │                        │
     ▼                        ▼
[Preview] ──approval──> [User Decision]
     │
     │ approved
     ▼
[Tool Executor] ──result──> [Chat History]
     │
     │ continue?
     ▼
[Loop or End]
```