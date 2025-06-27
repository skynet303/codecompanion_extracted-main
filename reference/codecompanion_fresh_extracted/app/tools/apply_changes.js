const { normalizedFilePath } = require('../utils');
const fs = require('graceful-fs');
const { generateDiff } = require('./code_diff');
const LLMApply = require('./llm_apply');

const cache = new Map();

function getCacheKey(filePath, fileContent) {
  return require('crypto')
    .createHash('sha256')
    .update(`${filePath}:${fileContent}`)
    .digest('hex');
}

async function applyChanges({ targetFile, content, isEntireFileContentProvided = false }) {
  viewController.updateLoadingIndicator(true, 'Applying changes...');
  const filePath = await normalizedFilePath(targetFile);
  const cacheKey = getCacheKey(filePath, content);

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let oldContent = '';
  let newContent = '';
  const isFileExists = fs.existsSync(filePath);

  if (!isFileExists) {
    newContent = content;
  } else {
    oldContent = fs.readFileSync(filePath, 'utf8') || '';
    if (isEntireFileContentProvided) {
      newContent = content;
    } else {
      const llmApply = new LLMApply();
      newContent = await llmApply.apply(content, oldContent);
    }
  }
  
  const codeDiff = generateDiff(oldContent, newContent, filePath);
  const result = { codeDiff, newContent };
  if (isFileExists) {
    cache.set(cacheKey, result);
  }
  viewController.updateLoadingIndicator(false);
  return result;
}

function clearCache(targetFile, fileContent) {
  if (targetFile && fileContent) {
    const filePath = normalizedFilePath(targetFile);
    const cacheKey = getCacheKey(filePath, fileContent);
    cache.delete(cacheKey);
  } else {
    cache.clear();
  }
}

module.exports = {
  applyChanges,
  clearCache
};