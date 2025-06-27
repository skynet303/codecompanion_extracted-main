const hljs = require('highlight.js/lib/common');
const { encode } = require('html-entities');
const { marked } = require('marked');
const autosize = require('autosize');
const interact = require('interactjs');
const { dialog } = require('@electron/remote');
const CodeBlock = require('./components/code_block');

class ViewController {
  constructor() {
    this.initializeScrollHandler();
    this.userHasScrolled = false;
    this.codeBlock = new CodeBlock();
    this.initializeCodeTabVisibility();
  }

  initializeScrollHandler() {
    const container = document.getElementById('chat_history_container');
    container.addEventListener('wheel', () => {
      this.userHasScrolled = true;
    });
  }

  initializeCodeTabVisibility() {
    const commandToOpenFile = document.getElementById('commandToOpenFile');
    const codeTab = document.getElementById('code-tab').parentElement;
    
    const updateCodeTabVisibility = () => {
      const selectedValue = commandToOpenFile.value || 'CodeCompanion';
      codeTab.style.display = selectedValue === 'CodeCompanion' ? '' : 'none';
    };

    commandToOpenFile.addEventListener('change', updateCodeTabVisibility);
    updateCodeTabVisibility();
  }

  initializeUIFormatting() {
    const renderer = new marked.Renderer();

    renderer.code = (code, language) => {
      let metadata = {};
      
      if (typeof code === 'object' && code.type === 'code') {
        language = code.raw.split(' ')[0].replace(/`+/g, '') || '';
        const attributePattern = /(\w+)="([^"]+)"/g;
        let match;
        while ((match = attributePattern.exec(code.raw)) !== null) {
          metadata[match[1]] = match[2];
        }
        code = code.text || '';
      }
      return this.codeBlock.render(code, language, metadata);
    };

    marked.setOptions({
      renderer: renderer,
      highlight: function (code, language) {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(code, { language }).value;
        }
        return hljs.highlightAuto(code).value;
      },
      langPrefix: 'language-',
      pedantic: false,
      gfm: true,
      breaks: true,
      smartypants: false,
      xhtml: false,
    });

    const messageInput = document.getElementById('messageInput');
    autosize(messageInput);
  }

  handleClick(event) {
    let targetElement = event.target;

    if (targetElement.tagName === 'I' && targetElement.parentElement && targetElement.parentElement.tagName === 'A') {
      targetElement = targetElement.parentElement;
    }

    if (targetElement.tagName === 'A' && targetElement.href.startsWith('http')) {
      event.preventDefault();
      shell.openExternal(targetElement.href);
    }
  }

  renderModelDropdowns() {
    const customModels = chatController.customModelsManager.getCustomModels();
    const largeModelOptions = MODEL_OPTIONS.concat(customModels);
    this.buildModelDropdown('selectedModel', largeModelOptions, chatController.settings.selectedModel);
    this.buildModelDropdown('baseModel', largeModelOptions, chatController.settings.selectedModel);
  }

  buildModelDropdown(elementId, options, selectedOption, includeBlank = null) {
    const select = document.getElementById(elementId);
    select.innerHTML = ''; // Clear existing options

    if (includeBlank !== null) {
      const blankOption = document.createElement('option');
      blankOption.value = '';
      blankOption.textContent = includeBlank;
      select.appendChild(blankOption);
    }

    const groupedModels = this.groupModelsByProvider(options);

    for (const [provider, models] of Object.entries(groupedModels)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider;

      models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.model;
        option.textContent = model.name;
        if (model.model === selectedOption) {
          option.selected = true;
        }
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
    }
  }

  groupModelsByProvider(models) {
    const groupedModels = {};
    models.forEach((model) => {
      const provider = model.provider;
      if (!groupedModels[provider]) {
        groupedModels[provider] = [];
      }
      groupedModels[provider].push(model);
    });
    return groupedModels;
  }

  scrollToBottom() {
    const container = document.getElementById('chat_history_container');

    if (container && !this.userHasScrolled) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }

  formatResponse(item) {
    if (!item.content || item.content.trim() === '') {
      return '';
    }

    let buttons = '';

    const roleSettings = {
      user: { icon: 'person', rowClass: 'bg-light-subtle rounded mt-3', rowPadding: '3', escape: true },
      command: { icon: 'terminal', rowClass: 'mt-3', rowPadding: '3' },
      function: { icon: null, rowClass: 'text-muted ms-1 mt-2', rowPadding: '2' },
      error: { icon: 'exclamation-triangle text-warning', rowClass: 'mt-3', rowPadding: '3' },
      info: { icon: 'info-circle', rowClass: 'mt-3', rowPadding: '3' },
      file: { icon: 'paperclip', rowClass: 'mt-3', rowPadding: '3' },
      onboarding: { icon: 'info-circle', rowClass: 'mt-3', rowPadding: '3' },
      assistant: { icon: 'stars text-primary', rowClass: 'mt-3', rowPadding: '3' }
    };

    const roleSetting = roleSettings[item.role];
    return this.createMessageHTML(roleSetting, item.content, buttons);
  }

  createMessageHTML(roleSetting, content, buttons) {
    if (roleSetting.escape) {
      content = encode(content);
    }
    const contentHtml = marked.parse(content);

    return `<div class="row ${roleSetting.rowClass} align-items-start flex-nowrap">
              <div class="col-auto pt-${roleSetting.rowPadding} flex-shrink-0">
                ${roleSetting.icon ? `<i class="bi bi-${roleSetting.icon}"></i>` : '&nbsp;'}
              </div>
              <div class="col pt-${roleSetting.rowPadding} flex-grow-1 min-width-0 pe-5">
                <div class="overflow-hidden">${contentHtml}</div>
                ${buttons}
              </div>
            </div>`;
  }

  updateFooterMessage(message) {
    if (message) {
      document.getElementById('footerMessage').innerText = message;
    }
  }

  updateTokenUsage() {
    let html = '';
    const formatTokens = (tokens) => (tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'K' : tokens);
    if (!chatController.usage || Object.keys(chatController.usage).length === 0) return;

    html += '<div class="list-group list-group-flush">';
    html += '  <div class="list-group-item d-flex justify-content-between align-items-center">';
    html += '    <span class="col-6 fw-bolder">Model</span>';
    html += '    <span class="col-3 fw-bolder">Type</span>';
    html += '    <span class="col-3 fw-bolder">Tokens</span>';
    html += '  </div>';

    Object.entries(chatController.usage)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([model, usage]) => {
        const addRow = (type, value) => {
          if (value > 0) {
            html += '<div class="list-group-item d-flex justify-content-between align-items-center">';
            html += `<span class="col-6">${model}</span>`;
            html += `<span class="col-3">${type}</span>`;
            html += `<span class="col-3">${formatTokens(value)}</span>`;
            html += '</div>';
          }
        };

        addRow('Total', usage.total);
        addRow('Last', usage.last);
        addRow('Cache - create', usage.cache_create);
        addRow('Cache - read', usage.cache_read);
      });
    html += '</div>';

    document.getElementById('tokensUsageContainer').innerHTML = html;
  }

  combineMessages(message, usageMessage) {
    if (message && usageMessage) {
      return `${message} | ${usageMessage}`;
    }
    return message || usageMessage;
  }

  updateLoadingIndicator(show, message = 'Loading...') {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingIndicatorMessage = document.getElementById('loadingMessage');
    if (show) {
      loadingIndicator.removeAttribute('hidden');
      loadingIndicatorMessage.innerText = message;
    } else {
      loadingIndicator.setAttribute('hidden', true);
      loadingIndicatorMessage.innerText = '';
    }
  }

  onShow() {
    messageInput.focus();
  }

  selectDirectory() {
    ipcRenderer.send('open-directory');
  }

  openFileDialogue() {
    ipcRenderer.send('open-file-dialog');
  }

  openFileInIDE(filePath) {
    if (!chatController.settings.commandToOpenFile || chatController.settings.commandToOpenFile === 'CodeCompanion') {
      document.getElementById('code-tab').click();
      chatController.codeTab.openFile(filePath);
    } else {
      const terminalCommand = `${chatController.settings.commandToOpenFile} "${filePath.replace(/\\/g, '/')}"`;
      chatController.terminalSession.executeCommandWithoutOutput(terminalCommand);
    }
  }

  activateTab(tabId) {
    const tab = new bootstrap.Tab(`#${tabId}`);
    tab.show();
  }

  handlePanelResize() {
    const container = document.querySelector('.container-fluid > .row');
    const leftPanel = document.getElementById('leftPanel');
    const rightPanel = document.getElementById('rightPanel');
    const resizeHandle = document.getElementById('resize_handle');
    const chatInputContainer = document.getElementById('chatInputContainer');
    let leftWidth = 50; // Initial left panel width in percentage
    const savedRatio = localStorage.get('panelSplitRatio');
    if (savedRatio) {
      leftWidth = parseFloat(savedRatio);
    }

    const updatePanels = () => {
      leftPanel.style.flexBasis = `${leftWidth}%`;
      chatInputContainer.style.width = `${leftWidth}%`;
      rightPanel.style.flexBasis = `calc(${100 - leftWidth}% - 3px)`;
    };

    updatePanels(); // Set initial sizes

    interact(resizeHandle).draggable({
      cursorChecker() {
        return 'ew-resize';
      },
      axis: 'x',
      listeners: {
        move: (event) => {
          const containerWidth = container.offsetWidth;
          leftWidth = ((leftPanel.offsetWidth + event.dx) / containerWidth) * 100;
          leftWidth = Math.max(30, Math.min(70, leftWidth));
          updatePanels();
        },
        end: () => {
          localStorage.set('panelSplitRatio', leftWidth);
        },
      },
    });
  }

  toogleChatInputContainer() {
    const chatInputContainer = document.getElementById('chatInputContainer');
    const isVisible = chatController.agent.projectController.currentProject !== null;
    chatInputContainer.style.display = isVisible ? 'block' : 'none';

    if (isVisible) {
      const chatInput = document.getElementById('messageInput');
      chatInput.focus();
    }
  }

  activateTooltips(messageCount = 0) {
    const output = document.getElementById('output');
    const tooltipTriggerList = messageCount > 0 ? 
      output.querySelectorAll(`div:nth-last-child(-n+${messageCount}) [data-bs-toggle="tooltip"]:not(.tooltip-initialized)`) :
      output.querySelectorAll('[data-bs-toggle="tooltip"]');
    
    [...tooltipTriggerList].forEach((tooltipTriggerEl) => {
      tooltipTriggerEl.classList.add('tooltip-initialized');
      const tooltip = new bootstrap.Tooltip(tooltipTriggerEl, {
        trigger: 'hover focus',
        delay: { hide: 100 }
      });

      tooltipTriggerEl.addEventListener('mouseleave', () => tooltip.hide());
      tooltipTriggerEl.addEventListener('blur', () => tooltip.hide());
      tooltipTriggerEl._tooltip = tooltip;
    });
  }

  cleanupTooltips(element) {
    const tooltips = element.querySelectorAll('.tooltip-initialized');
    tooltips.forEach(el => {
      if (el._tooltip) {
        el._tooltip.dispose();
        delete el._tooltip;
      }
      el.classList.remove('tooltip-initialized');
    });
  }

  disposeTooltips() {
    this.cleanupTooltips(document.getElementById('output'));
  }

  clearLocalStorage() {
    dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Clear Data'],
      defaultId: 0,
      title: 'Clear App Data',
      message: 'Are you sure you want to clear all app data?',
      detail: 'This will delete all settings, embeddings, API keys, chat history, etc.'
    }).then(result => {
      if (result.response === 1) {
        localStorage.clear();
      }
    });
  }

  showWelcomeContent() {
    const chat = chatController.chat;
    if (chat.frontendMessages.length !== 0 || chat.task !== null) {
      document.getElementById('projectsCard').innerHTML = '';
      return;
    }

    let recentProjectsContent = '';
    let currentProjectContent = '';
    const projectController = chatController.agent.projectController;
    const recentProjects = projectController.getProjects().slice(0, 10);

    recentProjects.forEach((project) => {
      const projectPath = JSON.stringify(project.path).slice(1, -1);
      const projectName =
        project.name === projectController.currentProject?.name ? `<strong>${project.name}</strong>` : project.name;
      recentProjectsContent += `
        <div class="row align-items-center">
          <div class="col-12 col-sm-4 mb-2 mb-sm-0">
            <a href="#" class="card-link text-nowrap text-truncate" onclick="event.preventDefault(); (async () => { await chatController.agent.projectController.openProject('${projectPath}'); })();">
              <i class="bi bi-folder me-2"></i>${projectName}
            </a>
          </div>
          <div class="col-12 col-sm-3 mb-2 mb-sm-0">
            <a href="#" class="card-link text-nowrap" onclick="event.preventDefault(); chatController.agent.projectController.showInstructionsModal('${projectPath}');">
              <i class="bi bi-pencil me-2"></i> Instructions
            </a>
          </div>
          <div class="col-12 col-sm-5 text-truncate text-secondary text-nowrap">
            ${projectPath}
          </div>
        </div>`;
    });

    if (projectController.currentProject) {
      currentProjectContent = `
        <p><span class="me-3 fw-bold">${projectController.currentProject.name}</span><span class="text-truncate text-secondary text-nowrap d-none d-md-inline">${projectController.currentProject.path}</span></p>
      `;
    }

    const welcomeContent = `
      <div class="card mt-5">
        <div class="card-body">
          <h5 class="card-title">Projects</h5>
          <h6 class="card-subtitle mt-4 mb-2 text-body-secondary">Current</h6>
          ${
            currentProjectContent ||
            '<p class="text-secondary">Please select a project directory to proceed.<br>Do not use the chat in the root directory. Instead, create a working directory.</p>'
          }
          <h6 class="card-subtitle mt-4 mb-2 text-body-secondary">Open project (working directory)</h6>
          <a href="#" class="card-link text-decoration-none" onclick="event.preventDefault(); viewController.selectDirectory();"><i class="bi bi-folder-plus me-2"></i>Open</a>
          <h6 class="card-subtitle mt-4 mb-2 text-body-secondary">Recent</h6>
          <div class="container-fluid">
            ${recentProjectsContent || '<p class="text-secondary">No recent projects</p>'}
          </div>
        </div>
      </div>
    `;
    document.getElementById('projectsCard').innerHTML = welcomeContent;
  }
}

module.exports = ViewController;
