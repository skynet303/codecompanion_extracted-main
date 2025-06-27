class AuthModal {
  constructor(authController) {
    this.authController = authController;
    this.modal = null;
    this.initializeModal();
  }

  initializeModal() {
    this.modal = new bootstrap.Modal(document.getElementById('loginModal'), {
      backdrop: 'static',
      keyboard: false
    });
  }

  show() {
    this.resetModal();
    this.modal.show();
  }

  hide() {
    this.modal.hide();
  }

  resetModal() {
    this.showLoginStep();
  }

  showLoginStep() {
    document.getElementById('loginStep').classList.remove('d-none');
    document.getElementById('waitingStep').classList.add('d-none');
    document.getElementById('errorStep').classList.add('d-none');
  }

  showWaitingStep() {
    document.getElementById('loginStep').classList.add('d-none');
    document.getElementById('waitingStep').classList.remove('d-none');
    document.getElementById('errorStep').classList.add('d-none');
  }

  showErrorStep(message = 'Login failed. Please try again.') {
    document.getElementById('loginStep').classList.add('d-none');
    document.getElementById('waitingStep').classList.add('d-none');
    document.getElementById('errorStep').classList.remove('d-none');
    document.getElementById('errorMessage').textContent = message;
  }

  async onLoginButtonClick() {
    try {
      this.showWaitingStep();
      await this.authController.initiateLogin();
    } catch (error) {
      this.showErrorStep('Failed to start login process. Please check your internet connection.');
    }
  }

  async onRetryButtonClick() {
    try {
      this.showWaitingStep();
      await this.authController.retryLogin();
    } catch (error) {
      this.showErrorStep('Failed to retry login. Please check your internet connection.');
    }
  }

  onLoginSuccess() {
    this.hide();
    window.isAuthCheckComplete = true;
    if (typeof initializeApp === 'function') {
      initializeApp();
    }
  }

  onLoginFailure() {
    this.showErrorStep('Authentication failed. Please try again.');
  }
}

module.exports = AuthModal;