#!/usr/bin/env node

/**
 * CodeCompanion Automated Extraction Tool
 * Extracts complete source code from CodeCompanion.app for debugging/analysis
 */

const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

class CodeCompanionExtractor {
  constructor(sourceDir, destDir) {
    this.sourceDir = sourceDir;
    this.destDir = destDir;
    this.extractedFiles = [];
    this.errors = [];
    this.ignoredPatterns = [
      'node_modules',
      '.git',
      '.DS_Store',
      'dist',
      'build',
      '*.log',
      '*.tmp',
      'codecompanion_extracted',
      'codecompanion_fresh_extracted'
    ];
  }

  async extract() {
    console.log('🚀 Starting CodeCompanion extraction...');
    console.log(`Source: ${this.sourceDir}`);
    console.log(`Destination: ${this.destDir}`);
    
    try {
      // Create destination directory
      await this.createDirectory(this.destDir);
      
      // Define extraction structure based on known patterns
      const extractionMap = {
        // Root files
        'root': [
          'main.js',
          'index.html',
          'renderer.js',
          'preload.js',
          'package.json',
          'package-lock.json',
          '.env',
          '.cursorrules',
          '.prettierrc'
        ],
        // App core
        'app': [
          'chat_controller.js',
          'view_controller.js',
          'project_controller.js',
          'window_manager.js',
          'utils.js'
        ],
        // Subdirectories with dynamic discovery
        'app/chat': { discover: true },
        'app/chat/context': { discover: true },
        'app/chat/planner': { discover: true },
        'app/chat/tabs': { discover: true },
        'app/models': { discover: true },
        'app/tools': { discover: true },
        'app/lib': { discover: true },
        'app/static': { discover: true },
        'app/auth': { discover: true },
        'styles': { discover: true },
        '.vscode': { discover: true }
      };

      // Extract files according to map
      for (const [dir, files] of Object.entries(extractionMap)) {
        if (dir === 'root') {
          // Extract root files
          for (const file of files) {
            await this.extractFile(file, '');
          }
        } else if (files.discover) {
          // Discover and extract all files in directory
          await this.extractDirectory(dir);
        } else {
          // Extract specific files from directory
          for (const file of files) {
            await this.extractFile(file, dir);
          }
        }
      }

      // Create extraction report
      await this.createReport();
      
      console.log(`\n✅ Extraction complete!`);
      console.log(`📁 Total files extracted: ${this.extractedFiles.length}`);
      if (this.errors.length > 0) {
        console.log(`⚠️  Errors encountered: ${this.errors.length}`);
      }
      
    } catch (error) {
      console.error('❌ Extraction failed:', error.message);
      throw error;
    }
  }

  async extractFile(filename, subdir) {
    const sourcePath = path.join(this.sourceDir, subdir, filename);
    const destPath = path.join(this.destDir, subdir, filename);
    
    try {
      // Check if file exists
      if (!existsSync(sourcePath)) {
        // Try alternate location in codecompanion_extracted
        const altPath = path.join(this.sourceDir, 'codecompanion_extracted', subdir, filename);
        if (existsSync(altPath)) {
          await this.copyFile(altPath, destPath);
          return;
        }
        throw new Error(`File not found: ${sourcePath}`);
      }
      
      await this.copyFile(sourcePath, destPath);
    } catch (error) {
      this.errors.push({ file: path.join(subdir, filename), error: error.message });
      console.log(`⚠️  Failed to extract ${path.join(subdir, filename)}: ${error.message}`);
    }
  }

  async extractDirectory(dir) {
    const sourcePath = path.join(this.sourceDir, dir);
    let actualPath = sourcePath;
    
    // Check alternate location if primary doesn't exist
    if (!existsSync(sourcePath)) {
      actualPath = path.join(this.sourceDir, 'codecompanion_extracted', dir);
      if (!existsSync(actualPath)) {
        this.errors.push({ directory: dir, error: 'Directory not found' });
        return;
      }
    }

    try {
      const items = await fs.readdir(actualPath);
      
      for (const item of items) {
        const itemPath = path.join(actualPath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          // Recursively extract subdirectories
          const subDir = path.join(dir, item);
          await this.extractDirectory(subDir);
        } else if (this.shouldExtract(item)) {
          const destPath = path.join(this.destDir, dir, item);
          await this.copyFile(itemPath, destPath);
        }
      }
    } catch (error) {
      this.errors.push({ directory: dir, error: error.message });
      console.log(`⚠️  Failed to extract directory ${dir}: ${error.message}`);
    }
  }

  async copyFile(source, dest) {
    // Ensure destination directory exists
    await this.createDirectory(path.dirname(dest));
    
    // Copy file
    await fs.copyFile(source, dest);
    this.extractedFiles.push(path.relative(this.destDir, dest));
    console.log(`📄 Extracted: ${path.relative(this.destDir, dest)}`);
  }

  async createDirectory(dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  shouldExtract(filename) {
    // Check if file should be ignored
    for (const pattern of this.ignoredPatterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        if (regex.test(filename)) return false;
      } else if (filename === pattern) {
        return false;
      }
    }
    
    // Extract JS, JSON, HTML, CSS, and config files
    const allowedExtensions = ['.js', '.json', '.html', '.css', '.ttf', '.woff', '.woff2', '.md'];
    const allowedFiles = ['.env', '.prettierrc', '.cursorrules', '.gitignore'];
    
    const ext = path.extname(filename).toLowerCase();
    return allowedExtensions.includes(ext) || allowedFiles.includes(filename);
  }

  async createReport() {
    const report = {
      extraction_date: new Date().toISOString(),
      source_directory: this.sourceDir,
      destination_directory: this.destDir,
      total_files_extracted: this.extractedFiles.length,
      errors_encountered: this.errors.length,
      files: this.extractedFiles.sort(),
      errors: this.errors,
      directory_structure: await this.generateTreeStructure()
    };

    const reportPath = path.join(this.destDir, 'EXTRACTION_REPORT.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Also create a markdown report
    const mdReport = this.generateMarkdownReport(report);
    const mdPath = path.join(this.destDir, 'EXTRACTION_REPORT.md');
    await fs.writeFile(mdPath, mdReport);
  }

  generateMarkdownReport(report) {
    return `# CodeCompanion Extraction Report

## Summary
- **Date**: ${new Date(report.extraction_date).toLocaleString()}
- **Source**: ${report.source_directory}
- **Destination**: ${report.destination_directory}
- **Files Extracted**: ${report.total_files_extracted}
- **Errors**: ${report.errors_encountered}

## Directory Structure
\`\`\`
${report.directory_structure}
\`\`\`

## Extracted Files
${report.files.map(f => `- ${f}`).join('\n')}

${report.errors.length > 0 ? `## Errors\n${report.errors.map(e => `- ${e.file || e.directory}: ${e.error}`).join('\n')}` : ''}
`;
  }

  async generateTreeStructure() {
    // Simple tree generation (can be enhanced)
    const tree = [];
    const dirs = new Set();
    
    for (const file of this.extractedFiles) {
      const parts = file.split(path.sep);
      let currentPath = '';
      
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? path.join(currentPath, parts[i]) : parts[i];
        dirs.add(currentPath);
      }
    }
    
    return [...dirs].sort().join('\n');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log(`
Usage: node extract_codecompanion.js [destination] [source]

Arguments:
  destination  - Where to extract files (default: ./codecompanion_extracted_[timestamp])
  source      - CodeCompanion app location (default: /Applications/CodeCompanion.app)

Examples:
  node extract_codecompanion.js ./my_extraction
  node extract_codecompanion.js ./extracted /Applications/CodeCompanion.app
`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const destination = args[0] || `./codecompanion_extracted_${timestamp}`;
  const source = args[1] || '/Applications/CodeCompanion.app';

  const extractor = new CodeCompanionExtractor(source, destination);
  
  try {
    await extractor.extract();
    console.log(`\n📋 Extraction reports saved to:`);
    console.log(`   - ${path.join(destination, 'EXTRACTION_REPORT.json')}`);
    console.log(`   - ${path.join(destination, 'EXTRACTION_REPORT.md')}`);
  } catch (error) {
    console.error('\n❌ Extraction failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = CodeCompanionExtractor;