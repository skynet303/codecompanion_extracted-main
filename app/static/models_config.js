const MODEL_OPTIONS = [
  {
    provider: 'Anthropic', model: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Recommended)',
  },
  {
    provider: 'Anthropic', model: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet',
  },
  {
    provider: 'Anthropic', model: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet',
  },
  {
    provider: 'Anthropic', model: 'claude-opus-4-20250514', name: 'Claude Opus 4',
  },
  { provider: 'Anthropic', model: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
  { provider: 'OpenAI', model: 'gpt-4.1', name: 'GPT-4.1' },
  { provider: 'OpenAI', model: 'gpt-4.1-mini', name: 'GPT-4.1-mini' },
  { provider: 'OpenAI', model: 'gpt-4o', name: 'GPT-4o' },
  { provider: 'OpenAI', model: 'o4-mini', name: 'o4-mini', temperatureUnsupported: true },
  { provider: 'OpenAI', model: 'o3-mini', name: 'o3-mini', temperatureUnsupported: true },
  {
    provider: 'OpenRouter',
    model: 'anthropic/claude-sonnet-4',
    name: 'anthropic/claude-sonnet-4',
  },
  {
    provider: 'OpenRouter',
    model: 'anthropic/claude-opus-4',
    name: 'anthropic/claude-opus-4',
  },
  {
    provider: 'OpenRouter',
    model: 'google/gemini-2.5-pro-preview',
    name: 'google/gemini-2.5-pro-preview',
  },
];

const SMALL_MODEL_OPTIONS = [
  { provider: 'OpenAI', model: 'gpt-4.1-nano' },
  { provider: 'Anthropic', model: 'claude-3-5-haiku-20241022' },
  { provider: 'OpenRouter', model: 'openai/gpt-4.1-nano' },
];

const DEFAULT_LARGE_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-3-small';

const EMBEDDINGS_VERSION = 'voyage-code-3-256-v4'; // when reindexing of code embedding is needed, update this version to bust cache

module.exports = {
  MODEL_OPTIONS,
  SMALL_MODEL_OPTIONS,
  DEFAULT_LARGE_MODEL,
  DEFAULT_EMBEDDINGS_MODEL,
  EMBEDDINGS_VERSION,
};
