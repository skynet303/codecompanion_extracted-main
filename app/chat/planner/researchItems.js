const researchItems = [
  {
    name: 'project_overview',
    description: `Gather a high-level overview of the project.`,
    prompt: `Provide a concise overview of the project. Use information from README files, package.json files, and other relevant files. Only provide information that was found in the files, otherwise set to null`,
    outputFormat: {
      project_name: { type: 'string' },
      primary_technologies: {
        type: 'array',
        items: { type: 'string', description: 'name and version if available, eg. "React 18.2.0"' },
      },
      project_type: {
        type: 'string',
        description: 'The type of project, e.g. "web", "mobile app", "chrome extension"',
      },
      installation_instructions: { type: 'string' },
      build_instructions: { type: 'string' },
      launch_instructions: { type: 'string' },
    },
    additionalInformation: 'projectStructure',
    cache: true,
    initial: true,
  },
  {
    name: 'database_schema',
    description: `Analyze only relevant database schema and data models.`,
    prompt: `
    Examine the project files to identify and analyze database schemas, models, and relationships.
    Look for:
    1. Database migration files
    2. Model/Entity definitions
    3. Schema configuration files
    4. ORM configurations

    Only provide relevant information needed to code the task defined in <taskDescription>.`,
    outputFormat: {
      models: { type: 'array', items: { type: 'string', description: 'Model name' } },
      details: { type: 'array', items: { type: 'string', description: 'Model schema and relationships' } },
    },
    additionalInformation: ['projectStructure', 'getTaskDescription'],
    cache: false,
    initial: false,
  },
  {
    name: 'task_relevant_files',
    description: `Identify and prioritize files that are important for a Software Engineer to review and inspect before working on the task defined in <taskDescription>`,
    prompt: `
    Analyze the <taskDescription> and identify files that a software engineer needs to review or modify or can reference or reuse some functionality from.

    For each file inspected think step by step to categorize files as follows:

    1. Directly relevant files:
       - Files containing logic directly related to the task
       - Files that will need to be modified to complete the task
       - Files that have functionality that can be reused or referenced
       - Files that mention some functionality related to the task

    2. Potentially relevant files:
       - All other inspected files that are not directly relevant but may be useful

    If you not sure, classify a file as 'directly_relevant_files'.

    Steps:
    1. Identify key concepts and functionality from the <taskDescription>
    2. Search for files with names or content matching these key concepts. User very long descriptive search query for semantic code search.
    3. Check import statements and function calls to find related files
    4. Include relevant configuration files if the task involves system settings

    Sort files in each category by relevance to the taskDescription, most relevant first.`,
    outputFormat: {
      directly_relevant_files: { type: 'array', items: { type: 'string', description: 'Absolute file path' } },
      potentially_relevant_files: { type: 'array', items: { type: 'string', description: 'Absolute file path' } },
    },
    additionalInformation: ['getTaskDescription', 'projectStructure', 'userSelectedFiles'],
    cache: false,
    initial: false,
  },
  {
    name: 'find_ui_components',
    description: `Identify relevant UI components and patterns that could be reused or referenced for the current task.`,
    prompt: `
    Analyze the codebase to find UI components and patterns relevant to the current task.
    
    Focus on:
    1. Components with similar functionality or appearance to what's needed
    2. Reusable UI patterns and layouts
    3. Common styling patterns used in the project
    4. Component organization and structure
    5. Component props and state management
    
    For each component found, analyze:
    - Its purpose and functionality
    - The styling approach used
    - Its reusability potential
    - Integration patterns with other components
    - Any relevant props or configuration options
    - How it fits into the project's component hierarchy`,
    tools: [],
    outputFormat: {
      components: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Component name' },
            file: { type: 'string', description: 'File path' },
            how_to_use: { type: 'string', description: 'How to use the component' }
          }
        }
      }
    },
    additionalInformation: ['getTaskDescription', 'projectStructure'],
    cache: false,
    initial: false
  },
  {
    name: 'find_sample_code',
    description: `Locate and extract relevant code snippets that may serve as examples or references for the current task.`,
    prompt: `Search the codebase for snippets that demonstrate patterns or functionality similar to what's needed for the current task. Extract and briefly explain these snippets.`,
    tools: [],
    outputFormat: {
      snippets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File path containing the snippet' },
            code: { type: 'string', description: 'The relevant code snippet' },
            explanation: { type: 'string', description: 'Brief explanation of the snippet and its relevance' }
          }
        }
      }
    },
    additionalInformation: ['getTaskDescription', 'projectStructure'],
    cache: false,
    initial: false
  },
  {
    name: 'find_testing_setup',
    description: `Gather information about the project's testing setup, frameworks, and coverage.`,
    prompt: `Analyze the project's testing setup. Identify the testing frameworks used, the types of tests present, and any information about test coverage.`,
    tools: [],
    outputFormat: {
      testingFrameworks: { type: 'array', items: { type: 'string' } },
      testTypes: { type: 'array', items: { type: 'string' } },
      testDirectories: { type: 'array', items: { type: 'string' } }
    },
    additionalInformation: ['getTaskDescription', 'projectStructure'],
    cache: false,
    initial: false
  },
  {
    name: 'web_research',
    description: `Search the web for information`,
    prompt: `Search the web for the requested information. Focus on finding current, relevant results from reputable sources. Provide a summary of your findings.`,
    outputFormat: {
      findings: { type: 'array', items: { type: 'string', description: 'Key findings from web search' } },
      sources: { type: 'array', items: { type: 'string', description: 'URLs of sources' } },
      summary: { type: 'string', description: 'Summary of findings' }
    },
    webResearch: true,
    cache: false,
    initial: false
  }
];

const taskClassification = {
  name: 'task_classification',
  description: `Classify the task`,
  maxSteps: 1,
  prompt: `
Task Classification Instructions:

1. Project Status:
   - Examine the project structure.
   - Determine: Is this a new or existing project?

2. Task Complexity:
   - Classify task as simple task: when task can be completed without knowing project structure or code and in a single step.
   - Classify as 'multi_step' may require some planning or multiple actions or changes may be needed, or modifying several files.
   - If you not sure, classify as 'multi_step'.

3. Task Title:
   - Create a concise title (max 4 words).
   - Capture the essence of the task.

4. Considerations:
   - Project's current state
   - Specific task requirements
   - Potential dependencies or implications

5. Output:
   - Classify project status: new/existing
   - Determine task type: simple/multi-step
   - Provide brief, descriptive task title
  `,
  outputFormat: {
    project_status: {
      type: 'string',
      enum: ['new', 'existing'],
      description: 'Whether the project is new or existing',
    },
    task_type: {
      type: 'string',
      enum: ['simple', 'multi_step'],
      description: 'Whether the task is simple or multi-step',
    },
    is_not_computer_root_directory: {
      type: 'boolean',
      description:
        'Current directory is not a system root or user home directory',
    },
    concise_task_title: {
      type: 'string',
      description: 'A brief title for the task. Max 4 words',
    },
  },
  additionalInformation: ['projectStructure', 'getTaskDescription'],
};

module.exports = { researchItems, taskClassification };
