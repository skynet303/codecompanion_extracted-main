const fg = require('fast-glob');
const fs = require('graceful-fs');
const readline = require('readline');
const path = require('path');
const { buildIgnoreListFromDirectory } = require('../lib/fileOperations');

function parseFilePatterns(filePattern, projectPath) {
  if (!filePattern || filePattern === '.' || filePattern === '') {
    return ['**/*'];
  }
  
  if (Array.isArray(filePattern)) {
    return filePattern;
  }
  
  if (typeof filePattern === 'string') {
    const patterns = filePattern.split(',').map(p => p.trim());
    return patterns.map(pattern => {
      if (pattern === '.') return '**/*';
      if (pattern.startsWith('./')) return pattern.slice(2);
      if (path.isAbsolute(pattern)) {
        return path.relative(projectPath, pattern);
      }
      return pattern;
    });
  }
  
  return ['**/*'];
}

function resolveBasePath(basePath, projectPath) {
  if (!basePath || basePath === '.' || basePath === '') {
    return projectPath;
  }
  
  if (path.isAbsolute(basePath)) {
    return basePath;
  }
  
  return path.resolve(projectPath, basePath);
}

async function grep(
  searchPattern,
  { 
    files = ['**/*'], 
    ignoreCase = false, 
    listFilesOnly = false,
    invert = false, 
    cwd = '.',
    projectPath = null,
    basePath = null
  } = {},
) {
  const resolvedProjectPath = projectPath || cwd;
  const resolvedBasePath = resolveBasePath(basePath, resolvedProjectPath);
  const filePatterns = parseFilePatterns(files, resolvedBasePath);
  
  const rx = searchPattern instanceof RegExp
    ? new RegExp(searchPattern, searchPattern.flags + (ignoreCase && !/i/.test(searchPattern.flags) ? 'i' : ''))
    : new RegExp(searchPattern, ignoreCase ? 'i' : '');

  const ignoreList = await buildIgnoreListFromDirectory(resolvedBasePath);
  const paths = await fg(filePatterns, { cwd: resolvedBasePath, onlyFiles: true, dot: true });
  
  const filteredPaths = paths.filter(relativePath => !ignoreList.ignores(relativePath));
  
  if (!filteredPaths.length) return [];

  const out = [];
  const seen = new Set();

  await Promise.all(filteredPaths.map(async rel => {
    const file = path.resolve(resolvedBasePath, rel);
    const relativeToProject = path.relative(resolvedProjectPath, file);
    
    try {
      const rl = readline.createInterface({
        input: fs.createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      let ln = 0;
      for await (const line of rl) {
        ln += 1;
        const hit = rx.test(line);
        if (hit !== invert) {
          if (listFilesOnly) {
            if (!seen.has(relativeToProject)) { 
              out.push(relativeToProject); 
              seen.add(relativeToProject); 
            }
            rl.close();
            break;
          }
          out.push({ 
            file: relativeToProject, 
            line: ln, 
            text: line.trim(),
            absolutePath: file
          });
        }
      }
    } catch (error) {
      console.warn(`Could not read file ${file}: ${error.message}`);
    }
  }));

  return out;
}

function parseGrepQuery(query) {
  const trimmed = query.trim();
  
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const endQuote = trimmed.indexOf(quote, 1);
    if (endQuote !== -1) {
      const pattern = trimmed.slice(1, endQuote);
      const filePattern = trimmed.slice(endQuote + 1).trim() || '**/*';
      return { pattern, filePattern };
    }
  }
  
  const spaceIndex = trimmed.search(/\s+(?=\*|[a-zA-Z0-9_\-./])/);
  if (spaceIndex !== -1) {
    const pattern = trimmed.slice(0, spaceIndex);
    const filePattern = trimmed.slice(spaceIndex + 1).trim();
    return { pattern, filePattern };
  }
  
  return { pattern: trimmed, filePattern: '**/*' };
}

async function grepSearch(query, projectPath) {
  const { pattern, filePattern } = parseGrepQuery(query);
  
  const grepResults = await grep(pattern, {
    files: filePattern,
    cwd: projectPath,
    projectPath: projectPath,
    ignoreCase: false,
    listFilesOnly: false
  });
  
  if (grepResults.length === 0) {
    return `No matches found for pattern "${pattern}" in files matching "${filePattern}"`;
  } else {
    return grepResults.map(match => `${match.file}:${match.line}: ${match.text}`).join('\n');
  }
}

module.exports = { grep, grepSearch };