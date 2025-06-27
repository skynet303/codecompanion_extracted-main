const fs = require('fs');
const path = require('path');
const { relativePath } = require('../../lib/fileOperations');
const detect = require('language-detect');

const { EditorView, keymap } = require('@codemirror/view');
const { EditorState } = require('@codemirror/state');
const { oneDark } = require('@codemirror/theme-one-dark');
const { defaultKeymap, history, historyKeymap, indentWithTab } = require('@codemirror/commands');
const { javascript } = require('@codemirror/lang-javascript');
const { python } = require('@codemirror/lang-python');
const { css } = require('@codemirror/lang-css');
const { html } = require('@codemirror/lang-html');
const { markdown } = require('@codemirror/lang-markdown');
const { sql } = require('@codemirror/lang-sql');
const { json } = require('@codemirror/lang-json');
const { xml } = require('@codemirror/lang-xml');
const { cpp } = require('@codemirror/lang-cpp');
const { java } = require('@codemirror/lang-java');
const { php } = require('@codemirror/lang-php');
const { rust } = require('@codemirror/lang-rust');
const { go } = require('@codemirror/lang-go');
const { search, highlightSelectionMatches, searchKeymap } = require('@codemirror/search');

class CodeTab {
  constructor(chatController) {
    this.chatController = chatController;
    this.editor = null;
    this.currentFilePath = null;
    this.isInitialized = false;
    this.hasFirstEdit = false;
    this.fileWatcher = null;
    this.lastFileModTime = null;
    this.sendToChatButton = null;
    this.debouncedSelectionHandler = this.debounce(this.handleSelectionChange.bind(this), 300);
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  createSendToChatButton() {
    if (this.sendToChatButton) {
      this.sendToChatButton.remove();
    }

    this.sendToChatButton = document.createElement('button');
    this.sendToChatButton.className = 'btn btn-primary btn-sm position-absolute';
    this.sendToChatButton.style.cssText = 'z-index: 1000; display: none; pointer-events: auto;';
    this.sendToChatButton.innerHTML = '<i class="bi bi-chat-dots me-1"></i>Send to Chat';
    
    this.sendToChatButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.sendSelectedCodeToChat();
    });

    const container = document.getElementById('codeEditor');
    if (container) {
      container.style.position = 'relative';
      container.appendChild(this.sendToChatButton);
    }
  }

  handleSelectionChange() {
    if (!this.editor || !this.sendToChatButton) return;

    const selection = this.editor.state.selection.main;
    const hasSelection = !selection.empty;

    if (hasSelection) {
      const coords = this.editor.coordsAtPos(selection.head);
      if (coords) {
        const containerRect = this.editor.dom.getBoundingClientRect();
        const relativeTop = coords.top - containerRect.top;
        const relativeLeft = coords.left - containerRect.left;

        this.sendToChatButton.style.top = `${Math.max(0, relativeTop - 35)}px`;
        this.sendToChatButton.style.left = `${Math.min(containerRect.width - 150, relativeLeft)}px`;
        this.sendToChatButton.style.display = 'block';
      }
    } else {
      this.sendToChatButton.style.display = 'none';
    }
  }

  sendSelectedCodeToChat() {
    if (!this.editor) return;

    const selection = this.editor.state.selection.main;
    if (selection.empty) return;

    const selectedText = this.editor.state.sliceDoc(selection.from, selection.to);
    if (!selectedText.trim()) return;

    const fileName = relativePath(this.currentFilePath);
    const message = `Selected code from ${fileName}:\n\n\`\`\`\n${selectedText}\n\`\`\``;

    this.chatController.chat.addMessage('user', message);
    this.sendToChatButton.style.display = 'none';
  }

  startFileWatcher() {
    if (!this.currentFilePath || this.fileWatcher) return;

    try {
      this.fileWatcher = fs.watchFile(this.currentFilePath, { interval: 200 }, (curr, prev) => {
        if (curr.mtime !== prev.mtime && !this.hasFirstEdit) {
          this.refreshFileFromDisk();
        }
      });
    } catch (error) {
      console.error('Error starting file watcher:', error);
    }
  }

  stopFileWatcher() {
    if (this.fileWatcher && this.currentFilePath) {
      try {
        fs.unwatchFile(this.currentFilePath);
        this.fileWatcher = null;
      } catch (error) {
        console.error('Error stopping file watcher:', error);
      }
    }
  }

  async refreshFileFromDisk() {
    if (!this.currentFilePath || !this.editor || this.hasFirstEdit) return;

    try {
      if (!fs.existsSync(this.currentFilePath)) {
        console.warn('File no longer exists:', this.currentFilePath);
        this.closeFile();
        return;
      }

      const stats = fs.statSync(this.currentFilePath);
      if (this.lastFileModTime && stats.mtime <= this.lastFileModTime) {
        return;
      }

      const content = fs.readFileSync(this.currentFilePath, 'utf8');
      const currentContent = this.editor.state.doc.toString();
      
      if (content !== currentContent) {
        const state = EditorState.create({
          doc: content,
          extensions: [
            ...this.getBasicSetupWithoutLineNumbers(),
            ...this.getThemeExtensions()
          ]
        });

        this.editor.setState(state);
        this.lastFileModTime = stats.mtime;
      }
    } catch (error) {
      console.error('Error refreshing file from disk:', error);
    }
  }

  getThemeExtensions() {
    const settings = this.chatController.settings;
    const isDarkTheme = settings.theme === 'dark' || document.documentElement.getAttribute('data-bs-theme') === 'dark';
    return isDarkTheme ? [oneDark] : [];
  }

  getBasicSetupWithoutLineNumbers() {
    return [
      EditorView.theme({
        '&': { fontSize: '12px' },
        '.cm-content': { padding: '10px' },
        '.cm-focused': { outline: 'none' }
      }),
      history(),
      EditorView.lineWrapping,
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
        {
          key: 'Ctrl-s',
          run: () => {
            this.saveFile();
            return true;
          }
        },
        {
          key: 'Cmd-s',
          run: () => {
            this.saveFile();
            return true;
          }
        }
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (!this.hasFirstEdit) {
            this.hasFirstEdit = true;
          }
          setTimeout(() => this.updateUndoRedoButtons(), 0);
        }
        if (update.selectionSet) {
          this.debouncedSelectionHandler();
        }
      })
    ];
  }

  updateUndoRedoButtons() {
    // Buttons removed from UI, but functionality preserved via keyboard shortcuts
  }

  undoAction() {
    if (this.editor) {
      this.editor.dispatch({
        selection: this.editor.state.selection,
        annotations: []
      });
    }
  }

  redoAction() {
    if (this.editor) {
      this.editor.dispatch({
        selection: this.editor.state.selection,
        annotations: []
      });
    }
  }

  closeFile() {
    this.stopFileWatcher();
    
    if (this.sendToChatButton) {
      this.sendToChatButton.style.display = 'none';
    }
    
    if (this.editor) {
      const state = EditorState.create({
        doc: '',
        extensions: [
          ...this.getBasicSetupWithoutLineNumbers(),
          ...this.getThemeExtensions()
        ]
      });

      this.editor.setState(state);
    }
    
    this.currentFilePath = null;
    this.hasFirstEdit = false;
    this.lastFileModTime = null;
    document.getElementById('codeTabFileName').textContent = 'No file selected (click on the file in the chat or on the task tab to open)';
    
    const closeBtn = document.getElementById('closeFileBtn');
    if (closeBtn) {
      closeBtn.style.display = 'none';
    }
  }

  async initializeEditor() {
    if (this.isInitialized) {
      if (this.currentFilePath) {
        await this.refreshFileFromDisk();
      }
      return;
    }

    try {
      const container = document.getElementById('codeEditor');
      if (!container) return;

      container.innerHTML = '';

      const state = EditorState.create({
        doc: '',
        extensions: [
          ...this.getBasicSetupWithoutLineNumbers(),
          ...this.getThemeExtensions(),
          javascript()
        ]
      });

      this.editor = new EditorView({
        state,
        parent: container
      });

      this.createSendToChatButton();
      this.updateUndoRedoButtons();
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing CodeMirror:', error);
    }
  }

  async openFile(filePath) {
    if (!this.isInitialized) {
      await this.initializeEditor();
    }

    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return;
    }

    this.stopFileWatcher();

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stats = fs.statSync(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const languageExtension = this.getLanguageExtension(extension);

      this.currentFilePath = filePath;
      this.hasFirstEdit = false;
      this.lastFileModTime = stats.mtime;
      
      if (this.editor) {
        const state = EditorState.create({
          doc: content,
          extensions: [
            ...this.getBasicSetupWithoutLineNumbers(),
            ...this.getThemeExtensions(),
            languageExtension
          ]
        });

        this.editor.setState(state);
        
        document.getElementById('codeTabFileName').textContent = relativePath(filePath);
        
        const closeBtn = document.getElementById('closeFileBtn');
        if (closeBtn) {
          closeBtn.style.display = 'block';
        }

        this.startFileWatcher();
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  }

  getLanguageExtension(extension) {
      const languageMap = {
        '.js': javascript(),
        '.jsx': javascript({ jsx: true }),
        '.ts': javascript({ typescript: true }),
        '.tsx': javascript({ typescript: true, jsx: true }),
        '.py': python(),
        '.java': java(),
        '.cpp': cpp(),
        '.c': cpp(),
        '.cc': cpp(),
        '.cxx': cpp(),
        '.php': php(),
        '.rs': rust(),
        '.go': go(),
        '.html': html(),
        '.htm': html(),
        '.css': css(),
        '.scss': css(),
        '.sass': css(),
        '.json': json(),
        '.xml': xml(),
        '.yaml': [],
        '.yml': [],
        '.md': markdown(),
        '.sql': sql(),
        '.sh': [],
        '.bash': [],
        '.zsh': []
      };

      return languageMap[extension] || [];
  }
  
  saveFile() {
    if (!this.currentFilePath || !this.editor) return;

    try {
      const content = this.editor.state.doc.toString();
      fs.writeFileSync(this.currentFilePath, content, 'utf8');
      const stats = fs.statSync(this.currentFilePath);
      this.lastFileModTime = stats.mtime;
      console.log('File saved:', this.currentFilePath);
    } catch (error) {
      console.error('Error saving file:', error);
    }
  }

  render() {
    if (!this.currentFilePath) {
      document.getElementById('codeTabFileName').textContent = 'No file selected (click on the file in the chat or on the task tab to open)';
      document.getElementById('codeTabFilePath').textContent = '';
    }
  }

  dispose() {
    this.stopFileWatcher();
    if (this.sendToChatButton) {
      this.sendToChatButton.remove();
      this.sendToChatButton = null;
    }
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
      this.isInitialized = false;
    }
  }
}

module.exports = CodeTab;
