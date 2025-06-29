const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

class Browser {
  constructor() {
    this.currentUrl = '';
    this.webview = document.querySelector('webview');
    this.urlInput = document.getElementById('urlInput');
    
    // Check if elements exist before trying to use them
    if (!this.webview || !this.urlInput) {
      console.error('Browser initialization failed: Required DOM elements not found');
      return;
    }
    
    this.webview.setAttribute('webpreferences', 'contextIsolation=false');
    this.webview.setAttribute('allowpopups', 'true');
    
    // Track failed URLs to prevent repeated attempts
    this.failedUrls = new Map(); // URL -> { count, lastAttempt }
    this.maxRetries = 3;
    
    this.initEventListeners();
  }

  initEventListeners() {
    // Ensure elements exist
    if (!this.webview || !this.urlInput) {
      console.warn('Browser elements not ready for event listeners');
      return;
    }
    
    // Remove any existing listeners to prevent memory leaks
    this.cleanupEventListeners();
    
    // Store listener references for cleanup
    this.listeners = {
      keydown: (event) => {
        if (event.key === 'Enter') {
          this.loadUrl(this.urlInput.value);
        }
      },
      didFailLoad: (event) => {
        this.handleLoadError(event);
      },
      didStartLoading: () => {
        document.getElementById('browserIcon').innerHTML =
          '<span class="spinner-border spinner-border-sm text-secondary me-2" role="status" aria-hidden="true"></span>';
      },
      didStopLoading: () => {
        document.getElementById('browserIcon').innerHTML = '<i class="bi bi-globe me-2"></i>';
      },
      didFrameNavigate: (event) => {
        if (event.isMainFrame) {
          this.updateUrlInput(event.url);
          this.handleHttpError(event.httpResponseCode, event.httpStatusText);
        }
      }
    };
    
    // Add listeners
    this.urlInput.addEventListener('keydown', this.listeners.keydown);
    this.webview.addEventListener('did-fail-load', this.listeners.didFailLoad);
    this.webview.addEventListener('did-start-loading', this.listeners.didStartLoading);
    this.webview.addEventListener('did-stop-loading', this.listeners.didStopLoading);
    this.webview.addEventListener('did-frame-navigate', this.listeners.didFrameNavigate);
    
    // Note: webview elements don't have setMaxListeners method
    // The warning was about the webview's internal event emitter, not something we can control
  }
  
  cleanupEventListeners() {
    if (this.listeners && this.urlInput && this.webview) {
      this.urlInput.removeEventListener('keydown', this.listeners.keydown);
      this.webview.removeEventListener('did-fail-load', this.listeners.didFailLoad);
      this.webview.removeEventListener('did-start-loading', this.listeners.didStartLoading);
      this.webview.removeEventListener('did-stop-loading', this.listeners.didStopLoading);
      this.webview.removeEventListener('did-frame-navigate', this.listeners.didFrameNavigate);
    }
  }

  updateUrlInput(url) {
    if (url !== 'about:blank' && !url.startsWith('data:')) {
      this.currentUrl = url;
      this.urlInput.value = url;
    }
  }

  goBack() {
    this.webview.goBack();
  }

  goForward() {
    this.webview.goForward();
  }

  reload() {
    this.webview.reload();
    this.waitForPageLoadAndCollectOutput();
  }

  getCurrentUrl() {
    return this.webview.getURL();
  }

  async loadUrl(url) {
    if (!url) return;

    viewController.activateTab('browser-tab');
    this.webview.style.backgroundColor = 'white';
    if (
      !url.startsWith('http') &&
      !url.startsWith('file') &&
      !url.startsWith('about') &&
      !url.startsWith('chrome') &&
      !url.startsWith('data')
    ) {
      url = 'http://' + url;
    }
    
    // Check if this URL has failed too many times recently
    const failureInfo = this.failedUrls.get(url);
    if (failureInfo) {
      const timeSinceLastAttempt = Date.now() - failureInfo.lastAttempt;
      const cooldownPeriod = 60000; // 1 minute cooldown
      
      if (failureInfo.count >= this.maxRetries && timeSinceLastAttempt < cooldownPeriod) {
        // Show cached error message instead of retrying
        this.showError(`This site (${new URL(url).hostname}) cannot be loaded in the embedded browser. It may block webview access or require specific browser features.`);
        return `Failed to load ${url} - site blocks embedded browsers`;
      }
    }
    
    this.urlInput.value = url.startsWith('data:') ? '' : url;
    this.currentUrl = url;
    return await this.waitForPageLoadAndCollectOutput(url);
  }

  waitForPageLoadAndCollectOutput(url) {
    return new Promise((resolve) => {
      // Clean up any previous page load listeners
      if (this.pageLoadCleanup) {
        this.pageLoadCleanup();
      }
      
      this.consoleOutput = [];
      const consoleListener = (event) => {
        this.consoleOutput.push(`[${event.level}] ${event.message}`);
      };
      const httpErrorListener = (event) => {
        if (event.httpResponseCode >= 400) {
          this.consoleOutput.push(`[3] Error loading ${event.url}: ${event.httpResponseCode} ${event.httpStatusText}`);
        }
      };
      
      // Cleanup function to remove all listeners
      this.pageLoadCleanup = () => {
        this.webview.removeEventListener('console-message', consoleListener);
        this.webview.removeEventListener('did-frame-navigate', httpErrorListener);
        this.pageLoadCleanup = null;
      };
      
      // Add listeners
      this.webview.addEventListener('console-message', consoleListener);
      this.webview.addEventListener('did-frame-navigate', httpErrorListener);
      
      // Use once:true to auto-remove this listener
      this.webview.addEventListener(
        'did-stop-loading',
        () => {
          if (this.pageLoadCleanup) {
            this.pageLoadCleanup();
          }
          this.indicateConsoleIssues(this.consoleOutput);
          resolve(this.consoleOutput.join('\n'));
        },
        { once: true }
      );
      
      // Also add a fail handler to cleanup
      this.webview.addEventListener(
        'did-fail-load',
        () => {
          if (this.pageLoadCleanup) {
            this.pageLoadCleanup();
          }
          resolve(this.consoleOutput.join('\n'));
        },
        { once: true }
      );
      
      // Set a timeout to cleanup if page never loads
      setTimeout(() => {
        if (this.pageLoadCleanup) {
          this.pageLoadCleanup();
          resolve(this.consoleOutput.join('\n'));
        }
      }, 30000); // 30 second timeout
      
      this.webview.src = url;
    });
  }

  handleLoadError(event) {
    this.webview.style.backgroundColor = 'transparent';
    const { errorCode, errorDescription, validatedURL } = event;
    
    // Track failed URLs
    if (validatedURL) {
      const failureInfo = this.failedUrls.get(validatedURL) || { count: 0, lastAttempt: 0 };
      failureInfo.count++;
      failureInfo.lastAttempt = Date.now();
      this.failedUrls.set(validatedURL, failureInfo);
      
      // Clean up old entries to prevent memory bloat
      if (this.failedUrls.size > 100) {
        const oldestUrl = Array.from(this.failedUrls.entries())
          .sort((a, b) => a[1].lastAttempt - b[1].lastAttempt)[0][0];
        this.failedUrls.delete(oldestUrl);
      }
    }
    
    // Silently ignore ERR_ABORTED errors
    if (errorCode === -3) {
      // These are typically caused by sites blocking webviews
      console.log(`Site blocked webview access: ${validatedURL}`);
      return;
    }

    let userFriendlyMessage;
    switch (errorCode) {
      case -102:
        userFriendlyMessage = 'Connection refused. The server may be down or unreachable.';
        break;
      case -105:
        userFriendlyMessage = "Unable to resolve the server's DNS address.";
        break;
      case -106:
        userFriendlyMessage = 'Internet connection is offline.';
        break;
      case -501:
        userFriendlyMessage = "Insecure connection. The website's security certificate is not trusted.";
        break;
      default:
        userFriendlyMessage = `Failed to load the page: ${errorDescription}`;
    }

    this.showError(userFriendlyMessage);
    if (this.consoleOutput) {
      this.consoleOutput.push(`[3] ${userFriendlyMessage}`);
      this.indicateConsoleIssues(this.consoleOutput);
    }
  }

  handleHttpError(httpResponseCode, httpStatusText) {
    if (httpResponseCode >= 400) {
      this.webview.style.backgroundColor = 'transparent';
      this.showError(`HTTP Error ${httpResponseCode}: ${httpStatusText}`);
    }
  }

  showError(message) {
    const errorHtml = `
      <div style="
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        color: #1e90ff;
        font-family: Arial, sans-serif;
        text-align: center;
      ">
        <p>${message}</p>
      </div>
    `;
    this.webview.executeJavaScript(`
      document.body.style.margin = '0';
      document.body.innerHTML = ${JSON.stringify(errorHtml)};
    `);
  }

  indicateConsoleIssues(consoleOutput) {
    const errors = consoleOutput.filter((msg) => msg.startsWith('[3]'));
    const warnings = consoleOutput.filter((msg) => msg.startsWith('[2]'));

    if (errors.length > 0) {
      document.getElementById('browserDevToolsIcon').innerHTML = `<i class="bi bi-bug text-danger ms-2"></i>`;
    } else if (warnings.length > 0) {
      document.getElementById('browserDevToolsIcon').innerHTML = `<i class="bi bi-bug text-warning ms-2"></i>`;
    } else {
      document.getElementById('browserDevToolsIcon').innerHTML = '<i class="bi bi-bug ms-2"></i>';
    }
  }

  openDevTools() {
    this.webview.openDevTools();
  }

  async handleSreenshot() {
    if (!this.currentUrl) {
      this.showError('No URL loaded to capture screenshot');
      return;
    }

    const base64Image = await this.getScreenshot();
    if (!base64Image) {
      chatController.chat.addFrontendMessage('error', 'Failed to capture screenshot');
      return;
    }

    const content = [
      {
        type: 'text',
        text: `Attaching browser screenshot for ${this.currentUrl}`,
      },
      {
        type: 'image_url',
        image_url: {
          url: base64Image,
          media_type: 'image/png',
        },
      },
    ];

    chatController.chat.addBackendMessage('user', content);
    chatController.chat.addFrontendMessage(
      'file',
      `<div class="d-flex justify-content-center"><img src="${base64Image}" class="img-fluid m-3 bg-white" alt="image preview" style="max-height: 350px;"></div>`
    );
  }

  async getScreenshot() {
    if (!this.currentUrl) {
      return null;
    }

    try {
      const nativeImage = await this.webview.capturePage();
      const base64Image = nativeImage.toPNG().toString('base64');
      return base64Image ? `data:image/png;base64,${base64Image}` : null;
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      return null;
    }
  }

  async getReadablePageContent() {
    if (!this.currentUrl) {
      return null;
    }

    try {
      const html = await this.webview.executeJavaScript('document.documentElement.outerHTML');
      const doc = new JSDOM(html, { url: this.currentUrl }).window.document;
      const reader = new Readability(doc);
      const article = reader.parse();
      return article ? article.textContent : null;
    } catch (error) {
      console.error('Error parsing page content:', error);
      return null;
    }
  }
}

module.exports = Browser;
