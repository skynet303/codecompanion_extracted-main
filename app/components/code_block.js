const hljs = require('highlight.js/lib/common');
const { dialog } = require('@electron/remote');

class CodeBlock {
  constructor() {
    this.codeBlocks = {};
  }

  render(code, language, { toolId, targetFile }) {
    if (typeof code !== 'string') {
      code = '';
    }
    this.codeBlocks[toolId] = { code: code };

    let highlightedCode;
    try {
      if (language && hljs.getLanguage(language)) {
        highlightedCode = hljs.highlight(code, { language }).value;
      } else {
        highlightedCode = hljs.highlightAuto(code).value;
      }
    } catch (error) {
      highlightedCode = code;
    }
    const checkpointsEnabled = chatController.agent.projectController.checkpoints.isAllowedForProject;

    return `
      <div class="" data-id="${toolId}">

        <pre class="hljs rounded border mb-0 ${language || ''}"><code>${highlightedCode}</code></pre>

        <div class="d-flex justify-content-between align-items-center p-1">
          <div class="text-secondary small">
            ${targetFile ? targetFile : ''}
          </div>
          <div>
            <button class="btn btn-sm" onclick="viewController.codeBlock.handleAction('copy', '${toolId}')" data-bs-toggle="tooltip" data-bs-title="Copy">
              <i class="bi bi-clipboard text-secondary"></i>
            </button>
            ${checkpointsEnabled ? `
            <button class="btn btn-sm ms-1" onclick="viewController.codeBlock.handleAction('revert', '${toolId}')" data-bs-toggle="tooltip" data-bs-title="Undo changes">
              <i class="bi bi-arrow-counterclockwise text-secondary"></i>
            </button>
            ` : ''}
          </div>
        </div>
      </div>`;
  }

  async handleAction(action, toolId) {
    const block = document.querySelector(`[data-id="${toolId}"]`);
    const button = block.querySelector(`[onclick*="${action}"]`);

    switch(action) {
      case 'copy':
        await this.copyCode(toolId, button);
        break;
      case 'revert':
        await this.revertCode(toolId);
        break;
    }
  }

  async copyCode(toolId, button) {
    const codeBlock = this.codeBlocks[toolId];
    if (codeBlock) {
      await navigator.clipboard.writeText(codeBlock.code);
      button.innerHTML = '<i class="bi bi-clipboard-check"></i>';

      setTimeout(() => {
        button.innerHTML = '<i class="bi bi-clipboard"></i>';
      }, 1000);
    }
  }

  async revertCode(toolId) {
    const block = document.querySelector(`[data-id="${toolId}"]`);
    const button = block.querySelector(`[onclick*="revert"]`);

    this.showDialog(
      'Undo Changes',
      'Undo to this checkpoint?',
      'This will undo all changes and chat history after this point.',
      async () => {
        button.innerHTML = '<i class="bi bi-arrow-counterclockwise text-secondary spin"></i>';
        await chatController.agent.projectController.checkpoints.restore(toolId);
        button.innerHTML = '<i class="bi bi-arrow-counterclockwise text-secondary"></i>';
      }
    );
  }

  showDialog(title, message, detail, callback) {
    dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
      defaultId: 0,
      title: title,
      message: message,
      detail: detail
    }).then(result => {
      if (result.response === 1) {
        callback();
      }
    });
  }
}

module.exports = CodeBlock;
