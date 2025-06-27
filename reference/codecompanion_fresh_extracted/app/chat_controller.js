const os = require('os');
const _ = require('lodash');
const autosize = require('autosize');

const Agent = require('./chat/agent');
const Chat = require('./chat/chat');
const Planner = require('./chat/planner/planner');
const TerminalSession = require('./tools/terminal_session');
const Browser = require('./chat/tabs/browser');
const TaskTab = require('./chat/tabs/task');
const CodeTab = require('./chat/tabs/code');
// const { trackEvent } = require('@aptabase/electron/renderer'); // REMOVED: Tracking disabled
const BackgroundTask = require('./background_task');
const OpenAIModel = require('./models/openai');
const AnthropicModel = require('./models/anthropic');
const { MODEL_OPTIONS, DEFAULT_LARGE_MODEL, SMALL_MODEL_OPTIONS } = require('./static/models_config');
const { allEnabledTools, allEnabledExcept } = require('./tools/tools');
const CustomModelsManager = require('./chat/custom_models');
const RelevantFilesFinder = require('./chat/relevant_files_finder');

const DEFAULT_SETTINGS = {
  apiKey: '',
  anthropicApiKey: '',
  openRouterApiKey: '',
  baseUrl: '',
  selectedModel: DEFAULT_LARGE_MODEL,
  approvalRequired: true,
  maxFilesToEmbed: 10000,
  commandToOpenFile: 'CodeCompanion',
  theme: 'dark',
  enableResearch: true,
  maxChatHistoryTokens: 5000,
  maxTaskContextFilesTokens: 10000,
  shareErrorReports: false, // DISABLED: Error reporting disabled
  enableCheckpoints: false,
};

class ChatController {
  constructor() {
    this.stopProcess = false;
    this.isProcessing = false;
    this.customModelsManager = new CustomModelsManager();
    this.loadAllSettings();
    this.initializeModel();
    this.chat = new Chat(this);
    this.chatLogs = [];
    this.agent = new Agent();
    this.terminalSession = new TerminalSession();
    this.browser = new Browser();
    this.taskTab = new TaskTab(this);
    this.codeTab = new CodeTab(this);
    this.processMessageChange = this.processMessageChange.bind(this);
    this.debouncedSearch = _.debounce(
      async () => { await this.relevantFilesFinder.search(); },
      1000, { leading: false, trailing: true }
    );
    this.usage = {};
    this.relevantFilesFinder = new RelevantFilesFinder();
  }

  loadAllSettings() {
    this.settings = {};
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      const value = this.loadSetting(key);
      this.renderSettingValueInUI(key, value);
    });
  }

  initializeModel() {
    this.model = null;
    this.smallModel = null;
    this.abortController = new AbortController();
    this.model = this.createModel(this.settings.selectedModel, (snapshot, delta) => {
      this.chat.updateStreamingMessage(snapshot, delta);
    });
    this.createSmallModel();
    this.backgroundTask = new BackgroundTask(this);
  }

  createSmallModel() {
    if (this.settings.apiKey) {
      const smallModel = SMALL_MODEL_OPTIONS.find(option => option.provider === 'OpenAI');
      this.smallModel = this.createModel(smallModel.model)
    } else {
      const selectedModel = this.settings.selectedModel;
      const modelOptions = this.getModelOptions();
      const selectedOption = modelOptions.find(option => option.model === selectedModel);
      if (selectedOption) {
        const provider = selectedOption.provider;
        const smallModel = SMALL_MODEL_OPTIONS.find(option => option.provider === provider);
        this.smallModel = this.createModel(smallModel.model)
      } else {
        const smallModel = SMALL_MODEL_OPTIONS.find(option => option.provider === 'OpenAI');
        this.smallModel = this.createModel(smallModel.model)
      }
    }
  }

  getModelOptions() {
    return [...MODEL_OPTIONS, ...SMALL_MODEL_OPTIONS, ...this.customModelsManager.getCustomModels()];
  }

  createModel(selectedModel, streamCallback) {
    if (!selectedModel) return;

    let apiKey;
    let baseUrl;
    let AIModel;
    let defaultHeaders;
    const modelOptions = this.getModelOptions();

    let selectedOption = modelOptions.find((option) => option.model === selectedModel);
    if (!selectedOption) {
      this.settings.selectedModel = DEFAULT_LARGE_MODEL;
      this.saveSetting('selectedModel', DEFAULT_LARGE_MODEL);
      this.initializeModel();
      return;
    }

    if (selectedOption?.provider === 'Anthropic') {
      apiKey = this.settings.anthropicApiKey;
      AIModel = AnthropicModel;
    } else if (selectedOption?.provider === 'OpenRouter') {
      defaultHeaders = {
        'HTTP-Referer': 'https://codecompanion.ai/',
        'X-Title': 'CodeCompanion',
      };
      apiKey = this.settings.openRouterApiKey;
      baseUrl = 'https://openrouter.ai/api/v1';
      AIModel = OpenAIModel;
    } else {
      apiKey = this.settings.apiKey;
      baseUrl = this.settings.baseUrl;
      AIModel = OpenAIModel;
    }

    if (!apiKey) return;

    return new AIModel({
      apiKey,
      model: selectedModel,
      baseUrl,
      chatController: this,
      streamCallback,
      defaultHeaders,
    });
  }

  renderSettingValueInUI(key, value) {
    let element = document.getElementById(key);
    if (!element) return;

    if (element.type === 'checkbox') {
      element.checked = value;
    } else {
      element.value = value;
    }
  }

  loadSetting(key) {
    const storedValue = localStorage.get(key);
    this.settings[key] = storedValue === undefined ? DEFAULT_SETTINGS[key] : storedValue;
    return this.settings[key];
  }

  saveSetting(key, value = null, elementId = null) {
    const element = elementId ? document.getElementById(elementId) : document.getElementById(key);
    if (value === null) {
      element.type === 'checkbox' ? (value = element.checked) : (value = element.value);
    }
    localStorage.set(key, value);
    this.settings[key] = value;
    this.renderSettingValueInUI(key, value);
    this.initializeModel();

    // Update code tab visibility when commandToOpenFile setting changes
    if (key === 'commandToOpenFile') {
      const codeTab = document.getElementById('code-tab').parentElement;
      codeTab.style.display = value === 'CodeCompanion' ? '' : 'none';
    }
  }

  handleError(error) {
    console.error('Error :', error);
    viewController.updateLoadingIndicator(false);
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
      this.chat.addFrontendMessage('error', 'Request was aborted');
    } else {
      this.chat.addFrontendMessage('error', `Error occurred: ${error.message}${error.stack ? '\n' + error.stack : ''}`);
    }
    this.stopProcess = false;
    document.getElementById('retry_button').removeAttribute('hidden');
  }

  async requestStopProcess() {
    this.stopProcess = true;
    this.isProcessing = false;
    this.abortController.abort();
    const stopButton = document.getElementById('requestStopProcess');
    await this.terminalSession.interruptShellSession();
    stopButton.innerHTML = '<i class="bi bg-body border-0 bi-stop-circle text-danger me-2"></i>';
    setTimeout(() => {
      stopButton.innerHTML = '<i class="bi bg-body border-0 bi-stop-circle me-2"></i>';
      this.stopProcess = false;
      this.abortController = new AbortController();
    }, 3000);
  }

  retry() {
    this.process('', false);
  }

  async process(query, renderUserMessage = true) {
    let apiResponse;
    document.getElementById('retry_button').setAttribute('hidden', true);

    if (!this.model) {
      this.chat.addFrontendMessage(
        'error',
        'No API key found. Please add your API key under <a href="#" onclick="document.getElementById(\'settingsToggle\').click(); return false;">Settings</a>'
      );
      return;
    }

    if (this.stopProcess) {
      viewController.updateLoadingIndicator(false);
      return;
    }

    if (query) {
      this.chat.addBackendMessage('user', query);
      if (renderUserMessage) {
        this.chat.addFrontendMessage('user', query);
      }
    }

    if (this.isProcessing) {
      console.error('Already processing');
      this.isProcessing = false;
      return;
    }

    try {
      this.isProcessing = true;
      viewController.updateLoadingIndicator(true, '');
      const messages = await this.chat.chatContextBuilder.build(query);
      let tools = allEnabledTools();
      apiResponse = await this.model.call({ messages, model: this.settings.selectedModel, tools });
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isProcessing = false;
      viewController.updateLoadingIndicator(false);
    }

    await this.agent.runAgent(apiResponse);
  }

  updateUsage(usage, model, cacheUsage) {
    if (!usage) return;

    if (!this.usage[model]) {
      this.usage[model] = {
        total: 0,
        last: 0,
        cache_create: 0,
        cache_read: 0,
      };
    }
    this.usage[model].total += usage;
    this.usage[model].last = usage;
    this.usage[model].cache_create += cacheUsage?.creation_tokens || 0;
    this.usage[model].cache_read += cacheUsage?.read_tokens || 0;
    viewController.updateTokenUsage();
  }

  async submitMessage() {
    const messageInput = document.getElementById('messageInput');
    const userMessage = messageInput.value.replace(/\n$/, '');
    if (!userMessage) return;
    messageInput.value = '';
    document.getElementById('relevantFilesContainer').innerHTML = '';
    autosize.update(messageInput);
    await this.processNewUserMessage(userMessage);
  }

  async processNewUserMessage(userMessage) {
    if (this.chat.isEmpty() || this.chat.onlyHasImages()) {
      document.getElementById('projectsCard').innerHTML = '';
      document.getElementById('messageInput').setAttribute('placeholder', 'Send message...');
      this.chat.addTask(userMessage);
      await new Planner(this).run(userMessage);
      await this.process();
    } else {
      await this.process(userMessage);
    }
  }

  async processMessageChange(event) {
    if (event.code === 'N' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.clearChat();
      return;
    }

    if (event.keyCode === 13 && !event.shiftKey) {
      this.submitMessage();
      return;
    }
    this.debouncedSearch();
  }

  async clearChat() {
    // trackEvent(`new_chat`); // REMOVED: Event tracking disabled
    this.chat = new Chat(this);
    this.agent = new Agent(this.agent.projectController.currentProject);
    this.initializeModel();
    this.chatLogs = [];
    this.agent.userDecision = null;
    this.terminalSession.createShellSession();
    this.codeTab.closeFile();
    document.getElementById('streaming_output').innerHTML = '';
    document.getElementById('output').innerHTML = '';
    document.getElementById('retry_button').setAttribute('hidden', true);
    document.getElementById('approval_buttons').setAttribute('hidden', true);
    document.getElementById('messageInput').disabled = false;
    this.taskTab.render();
    document.getElementById('messageInput').setAttribute('placeholder', 'Provide task details...');
    this.stopProcess = false;
    this.usage = {};
    viewController.updateFooterMessage();
    viewController.showWelcomeContent();
    viewController.toogleChatInputContainer();
    this.agent.projectState = {
      complexity: '',
      currentWorkingDir: '',
      folderStructure: '',
      requirementsChecklist: '',
    };
    this.chat.chatContextBuilder.contextFiles.lastEditedFilesTimestamp = Date.now();
    onboardingController.showAllTips();
    viewController.onShow();
  }

  abortAllProcesses() {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.stopProcess = false;
    this.isProcessing = false;
  }
}

module.exports = ChatController;