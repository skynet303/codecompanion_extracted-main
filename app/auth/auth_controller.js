const { shell } = require('electron');
const ElectronStore = require('electron-store');

class AuthController {
  constructor() {
    this.loginKey = null;
    this.pollingInterval = null;
    this.isPolling = false;
    this.baseUrl = 'https://app.codecompanion.ai';
    this.localStorage = new ElectronStore();
  }

  generateUUID() {
    return crypto.randomUUID();
  }

  isAuthenticated() {
    return this.localStorage.get('auth.authenticated', false);
  }

  getUserInfo() {
    return this.localStorage.get('auth.userInfo', null);
  }

  async initiateLogin() {
    try {
      this.loginKey = this.generateUUID();
      
      const response = await fetch(`${this.baseUrl}/api/login/${this.loginKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const loginUrl = `${this.baseUrl}/login?key=${this.loginKey}`;
      shell.openExternal(loginUrl);
      
      this.startPolling();
      
      return true;
    } catch (error) {
      console.error('Failed to initiate login:', error);
      throw error;
    }
  }

  startPolling() {
    if (this.isPolling) return;
    
    this.isPolling = true;
    this.pollingInterval = setInterval(() => {
      this.checkLoginStatus();
    }, 2000);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPolling = false;
  }

  async checkLoginStatus() {
    if (!this.loginKey) return;

    try {
      const response = await fetch(`${this.baseUrl}/api/login/${this.loginKey}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status === 'completed') {
        this.handleLoginSuccess(data);
      } else if (data.status === 'failed') {
        this.handleLoginFailure();
      }
    } catch (error) {
      console.error('Failed to check login status:', error);
    }
  }

  handleLoginSuccess(userData) {
    this.stopPolling();
    
    this.localStorage.set('auth.authenticated', true);
    this.localStorage.set('auth.userInfo', userData);
    this.localStorage.set('auth.authenticatedAt', Date.now());
    
    if (window.authModal) {
      window.authModal.onLoginSuccess();
    }
  }

  handleLoginFailure() {
    this.stopPolling();
    
    if (window.authModal) {
      window.authModal.onLoginFailure();
    }
  }

  logout() {
    this.localStorage.delete('auth.authenticated');
    this.localStorage.delete('auth.userInfo');
    this.localStorage.delete('auth.authenticatedAt');
    this.stopPolling();
    this.loginKey = null;
  }

  async logoutWithApiCall() {
    try {
      const userInfo = this.getUserInfo();
      if (userInfo && userInfo.sessionId) {
        await fetch(`${this.baseUrl}/api/logout/${userInfo.sessionId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Failed to send logout request to API:', error);
    } finally {
      this.logout();
    }
  }

  async retryLogin() {
    this.stopPolling();
    await this.initiateLogin();
  }

  requireAuthentication() {
    if (!this.isAuthenticated()) {
      this.showLoginModal();
      return false;
    }
    return true;
  }

  showLoginModal() {
    if (window.authModal) {
      window.authModal.show();
    }
  }
}

module.exports = AuthController;
