const { researchItems, taskClassification } = require('./researchItems');
const ResearchAgent = require('./researchAgent');

class Planner {
  constructor(chatController) {
    this.chatController = chatController;
    this.taskContext = null;
  }

  async run(taskDescription) {
    try {
      viewController.updateLoadingIndicator(true);
      const taskClassificationResult = await this.classifyTask(taskDescription);
      if (!taskClassificationResult) return;

      if (taskClassificationResult.is_not_computer_root_directory === false) {
        this.chatController.chat.addFrontendMessage(
          'error',
          `Current project directory is not safe to use.\n\nPlease click on "New Chat" and open project folder or create a new workspace folder.\n\nIMPORTANT: Do not use CodeCompanion in root or home directory.`
        );
        return;
      }

      this.chatController.taskTab.renderTask(taskDescription, taskClassificationResult.concise_task_title);
      this.chatController.chat.taskTitle = taskClassificationResult.concise_task_title;

      viewController.updateLoadingIndicator(false);
    } catch (error) {
      this.chatController.handleError(error);
    }
  }

  async classifyTask(taskDescription) {
    const researchAgent = new ResearchAgent(this.chatController, taskDescription);
    const result = await researchAgent.executeResearch(taskClassification);
    return result;
  }

  async performResearch(taskDescription) {
    const initialResearchItems = researchItems.filter((item) => item.initial);
    const researchAgent = new ResearchAgent(this.chatController, taskDescription);
    const researchPromises = initialResearchItems.map(async (item) => {
      const result = await researchAgent.executeResearch(item);
      return { [item.name]: result };
    });

    const researchResults = await Promise.all(researchPromises);
    return Object.assign({}, ...researchResults);
  }

  async updateTaskContextFiles({ filesToDisable, filesToEnable }) {
    const chatContextBuilder = this.chatController.chat.chatContextBuilder;
    if (Array.isArray(filesToDisable)) {
      await chatContextBuilder.contextFiles.add(filesToDisable, false);
    }
    if (Array.isArray(filesToEnable)) {
      await chatContextBuilder.contextFiles.add(filesToEnable, true);
    }
  }

  formatTaskContextToMarkdown(projectContext) {
    const excludeKeys = ['task_relevant_files'];
    const filteredContext = Object.fromEntries(
      Object.entries(projectContext).filter(([key]) => !excludeKeys.includes(key))
    );

    let markdown = '';
    const formatTitle = (title) => {
      return title.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    };

    for (const [key, value] of Object.entries(filteredContext)) {
      markdown += `### ${formatTitle(key)}\n\n`;
      if (typeof value === 'string') {
        markdown += `${value}\n\n`;
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          markdown += `- ${item}\n`;
        });
        markdown += '\n';
      } else if (typeof value === 'object') {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue === null) continue;
          markdown += `**${formatTitle(subKey)}:** `;
          if (typeof subValue === 'string') {
            markdown += `${subValue}\n\n`;
          } else if (Array.isArray(subValue)) {
            markdown += '\n';
            subValue.forEach((item) => {
              if (typeof item === 'object') {
                markdown += '- ';
                for (const [itemKey, itemValue] of Object.entries(item)) {
                  markdown += `**${itemKey}:** ${itemValue} `;
                }
                markdown += '\n';
              } else {
                markdown += `- ${item}\n`;
              }
            });
            markdown += '\n';
          }
        }
      }
    }
    return markdown;
  }
}

module.exports = Planner;