const onboardingSteps = require('./static/onboarding_steps');

/**
 * Generates the tips content as HTML
 */
function generateTips() {
  // ... existing code ...
}

class OnboardingController {
  constructor(steps = onboardingSteps) {
    this.currentStepIndex = 0;
    this.steps = steps || [];
    this.showingId = null;
    this.markedAsSeen = false;
    this.helpModal = null; // Will be initialized when needed
  }

  hasBeenShown(id) {
    return localStorage.get(`onboarding.${id}`, false);
  }

  isValidStep(step) {
    const selector = step.selector;
    const element = document.querySelector(selector);
    return !!element;
  }

  markAsRead() {
    localStorage.set(`onboarding.${this.showingId}`, true);
    this.hideModal();
    this.showingId = null;
  }

  showAllTips() {
    for (const step of this.steps) {
      if (this.isValidStep(step)) {
        this.showModal(step.description);
        this.showingId = step.id;
        break;
      }
    }
  }

  showModal(content) {
    this.getHelpModal().show();
    document.getElementById('helpMessageContent').innerHTML = content;
  }

  hideModal() {
    document.getElementById('helpMessageContent').innerHTML = '';
    if (this.helpModal) {
      this.helpModal.hide();
    }
  }

  getHelpModal() {
    if (!this.helpModal) {
      this.helpModal = new bootstrap.Modal(document.getElementById('helpMessage'));
    }
    return this.helpModal;
  }

  showSpecificTips(ids) {
    for (const id of ids) {
      const step = this.steps.find((step) => step.id === id);
      if (step && this.isValidStep(step, true)) {
        this.showingId = step.id;
        chatController.chat.addFrontendMessage('onboarding', step.description);
        this.markAsRead();
      }
    }
  }
}

module.exports = OnboardingController;
