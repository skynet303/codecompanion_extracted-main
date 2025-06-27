# CodeCompanion Fresh Extraction - Complete Source Code

## Extraction Summary
- **Date**: 2025-01-27
- **Source**: /Applications/CodeCompanion.app/
- **Destination**: codecompanion_fresh_extracted/
- **Total Files Extracted**: ~80+ files

## Directory Structure
```
codecompanion_fresh_extracted/
├── main.js                    # Electron main process
├── index.html                 # Main UI interface
├── renderer.js               # Renderer process
├── preload.js                # Preload script
├── package.json              # Dependencies and metadata
├── package-lock.json         # Dependency lock file
├── .env                      # Environment variables
├── .cursorrules             # Cursor IDE rules
├── .prettierrc              # Code formatter config
├── .vscode/                 # VS Code settings
│   └── settings.json
├── app/                     # Core application code
│   ├── chat_controller.js   # Chat management
│   ├── view_controller.js   # UI management
│   ├── project_controller.js # Project management
│   ├── window_manager.js    # Window state
│   ├── utils.js            # Utilities
│   ├── chat/               # Chat subsystem
│   │   ├── agent.js
│   │   ├── chat.js
│   │   ├── chat_history.js
│   │   ├── custom_models.js
│   │   ├── file_handler.js
│   │   ├── image_handler.js
│   │   ├── relevant_files_finder.js
│   │   ├── context/        # Context management
│   │   │   ├── contextBuilder.js
│   │   │   ├── contextFiles.js
│   │   │   ├── contextReducer.js
│   │   │   └── llmSummarize.js
│   │   ├── planner/        # Planning system
│   │   │   ├── planner.js
│   │   │   ├── researchAgent.js
│   │   │   ├── researchItems.js
│   │   │   └── tools.js
│   │   └── tabs/           # UI tabs
│   │       ├── browser.js
│   │       ├── code.js
│   │       └── task.js
│   ├── models/             # AI integrations
│   │   ├── anthropic.js
│   │   ├── anthropic_caching.js
│   │   ├── model-manager.js
│   │   ├── openai.js
│   │   └── voyageRerank.js
│   ├── tools/              # Development tools
│   │   ├── apply_changes.js
│   │   ├── code_diff.js
│   │   ├── code_embeddings.js
│   │   ├── contextual_compressor.js
│   │   ├── google_search.js
│   │   ├── grep_search.js
│   │   ├── llm_apply.js
│   │   ├── terminal_session.js
│   │   └── tools.js
│   ├── lib/                # Libraries
│   │   ├── CheckpointManager.js
│   │   ├── CoEditedFiles.js
│   │   ├── CommitSearcher.js
│   │   └── fileOperations.js
│   ├── static/             # Static configs
│   │   ├── embeddings_ignore_patterns.js
│   │   ├── models_config.js
│   │   ├── onboarding_steps.js
│   │   └── prompts.js
│   └── auth/               # Authentication
│       ├── auth_controller.js
│       └── auth_modal.js
└── styles/                 # Styling
    ├── styles.css
    └── fonts/
        ├── FiraCodeNerdFont-Regular.ttf
        └── FiraCodeNerdFont-Bold.ttf
```

## Extraction Notes
- All files extracted with complete, exact contents preserved
- No placeholders or truncated code
- Directory structure maintained as in original
- Configuration files included (.env, .prettierrc, etc.)
- All JavaScript modules properly extracted
- CSS and font files preserved

## Application Details
- **Name**: CodeCompanion
- **Version**: 7.1.15
- **Type**: Electron Desktop Application
- **Main Features**:
  - AI-powered coding assistant
  - Multiple AI provider support (Anthropic, OpenAI)
  - Integrated terminal
  - Code editor with syntax highlighting
  - Project management
  - Chat history persistence
  - Vector embeddings for code search

This is a complete, fresh extraction of the CodeCompanion source code for debugging purposes.