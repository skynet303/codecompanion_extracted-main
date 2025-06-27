const diff = require('diff');

function generateDiff(oldContent, newContent, fileName, trimHeader = true) {
  if (!newContent) {
    newContent = '';
  }

  if (oldContent && !oldContent.endsWith('\n')) {
    oldContent += '\n';
  }
  if (newContent && !newContent.endsWith('\n')) {
    newContent += '\n';
  }
  let patch = diff.createPatch(fileName, oldContent, newContent);
  if (trimHeader) {
    const lines = patch.split('\n');
    lines.splice(0, 4);
    patch = lines.join('\n');
  }
  return patch;
}

module.exports = {
  generateDiff,
};