/**
 * Terminal Error Monitor
 * Monitors terminal outputs for errors and provides intelligent error analysis
 */

class TerminalErrorMonitor {
  constructor() {
    // Common error patterns for different languages/tools
    this.errorPatterns = {
      // Build/Compilation errors
      build: [
        { pattern: /error\s+CS\d+:/gi, type: 'csharp_compile', severity: 'error' },
        { pattern: /error\s+TS\d+:/gi, type: 'typescript_compile', severity: 'error' },
        { pattern: /SyntaxError:/gi, type: 'syntax', severity: 'error' },
        { pattern: /TypeError:/gi, type: 'type', severity: 'error' },
        { pattern: /ReferenceError:/gi, type: 'reference', severity: 'error' },
        { pattern: /The build failed\./gi, type: 'build_failed', severity: 'error' },
        { pattern: /FAILURE:\s+Build failed/gi, type: 'gradle_build', severity: 'error' },
        { pattern: /npm ERR!/gi, type: 'npm', severity: 'error' },
        { pattern: /ERROR in\s+\.\/.*\.(js|ts|jsx|tsx)/gi, type: 'webpack', severity: 'error' },
        { pattern: /Failed to compile/gi, type: 'compile', severity: 'error' },
        { pattern: /\[ERROR\]/gi, type: 'generic', severity: 'error' }
      ],
      
      // Runtime errors
      runtime: [
        { pattern: /Unhandled\s+(exception|error)/gi, type: 'unhandled', severity: 'critical' },
        { pattern: /Segmentation fault/gi, type: 'segfault', severity: 'critical' },
        { pattern: /Stack overflow/gi, type: 'stackoverflow', severity: 'critical' },
        { pattern: /Out of memory/gi, type: 'memory', severity: 'critical' },
        { pattern: /Permission denied/gi, type: 'permission', severity: 'error' },
        { pattern: /EACCES/gi, type: 'access', severity: 'error' },
        { pattern: /ENOENT/gi, type: 'file_not_found', severity: 'error' },
        { pattern: /Connection refused/gi, type: 'connection', severity: 'error' },
        { pattern: /timeout/gi, type: 'timeout', severity: 'warning' }
      ],
      
      // Test failures
      test: [
        { pattern: /\d+\s+failing/gi, type: 'test_failure', severity: 'error' },
        { pattern: /FAIL\s+.*\.(test|spec)\.(js|ts|jsx|tsx)/gi, type: 'jest_fail', severity: 'error' },
        { pattern: /AssertionError:/gi, type: 'assertion', severity: 'error' },
        { pattern: /Expected.*but.*received/gi, type: 'expectation', severity: 'error' }
      ],
      
      // Warnings
      warnings: [
        { pattern: /warning\s+CS\d+:/gi, type: 'csharp_warning', severity: 'warning' },
        { pattern: /\[WARN\]/gi, type: 'generic_warning', severity: 'warning' },
        { pattern: /DeprecationWarning:/gi, type: 'deprecation', severity: 'warning' },
        { pattern: /npm WARN/gi, type: 'npm_warning', severity: 'warning' }
      ],
      
      // Exit codes
      exitCodes: [
        { pattern: /exit\s+code\s+[1-9]\d*/gi, type: 'non_zero_exit', severity: 'error' },
        { pattern: /exited\s+with\s+signal/gi, type: 'signal_exit', severity: 'error' }
      ]
    };
    
    // Error context extractors
    this.contextExtractors = {
      csharp_compile: this.extractCSharpError.bind(this),
      typescript_compile: this.extractTypeScriptError.bind(this),
      npm: this.extractNpmError.bind(this),
      generic: this.extractGenericError.bind(this)
    };
    
    // Statistics
    this.stats = {
      errorsDetected: 0,
      warningsDetected: 0,
      criticalErrors: 0
    };
  }
  
  /**
   * Analyze terminal output for errors
   */
  analyzeOutput(output, command) {
    const analysis = {
      hasErrors: false,
      errors: [],
      warnings: [],
      summary: '',
      suggestions: [],
      exitCode: this.extractExitCode(output),
      command: command
    };
    
    // Check each line for error patterns
    const lines = output.split('\n');
    
    // Scan for all error types
    for (const [category, patterns] of Object.entries(this.errorPatterns)) {
      for (const { pattern, type, severity } of patterns) {
        const matches = this.findMatches(output, pattern, lines);
        
        for (const match of matches) {
          const error = {
            type,
            severity,
            category,
            message: match.text,
            line: match.line,
            lineNumber: match.lineNumber,
            context: this.extractContext(lines, match.lineNumber),
            fullMatch: match.fullMatch
          };
          
          // Try to extract more specific error info
          if (this.contextExtractors[type]) {
            Object.assign(error, this.contextExtractors[type](lines, match.lineNumber));
          }
          
          if (severity === 'error' || severity === 'critical') {
            analysis.errors.push(error);
            analysis.hasErrors = true;
            this.stats.errorsDetected++;
            if (severity === 'critical') this.stats.criticalErrors++;
          } else if (severity === 'warning') {
            analysis.warnings.push(error);
            this.stats.warningsDetected++;
          }
        }
      }
    }
    
    // Generate summary and suggestions
    if (analysis.hasErrors) {
      analysis.summary = this.generateErrorSummary(analysis);
      analysis.suggestions = this.generateSuggestions(analysis);
    }
    
    return analysis;
  }
  
  /**
   * Find all matches of a pattern in the output
   */
  findMatches(output, pattern, lines) {
    const matches = [];
    
    lines.forEach((line, index) => {
      const lineMatches = line.match(pattern);
      if (lineMatches) {
        matches.push({
          text: line.trim(),
          line: line,
          lineNumber: index,
          fullMatch: lineMatches[0]
        });
      }
    });
    
    return matches;
  }
  
  /**
   * Extract surrounding context for an error
   */
  extractContext(lines, errorLine, contextSize = 3) {
    const start = Math.max(0, errorLine - contextSize);
    const end = Math.min(lines.length, errorLine + contextSize + 1);
    
    return {
      before: lines.slice(start, errorLine),
      after: lines.slice(errorLine + 1, end)
    };
  }
  
  /**
   * Extract C# compilation error details
   */
  extractCSharpError(lines, errorLine) {
    const errorDetails = {
      errorCode: '',
      file: '',
      position: '',
      description: ''
    };
    
    const errorMatch = lines[errorLine].match(/(.+?)\((\d+),(\d+)\):\s+error\s+(CS\d+):\s+(.+)/);
    if (errorMatch) {
      errorDetails.file = errorMatch[1];
      errorDetails.position = `${errorMatch[2]}:${errorMatch[3]}`;
      errorDetails.errorCode = errorMatch[4];
      errorDetails.description = errorMatch[5];
    }
    
    return errorDetails;
  }
  
  /**
   * Extract TypeScript error details
   */
  extractTypeScriptError(lines, errorLine) {
    const errorDetails = {
      errorCode: '',
      file: '',
      position: '',
      description: ''
    };
    
    const errorMatch = lines[errorLine].match(/(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/);
    if (errorMatch) {
      errorDetails.file = errorMatch[1];
      errorDetails.position = `${errorMatch[2]}:${errorMatch[3]}`;
      errorDetails.errorCode = errorMatch[4];
      errorDetails.description = errorMatch[5];
    }
    
    return errorDetails;
  }
  
  /**
   * Extract NPM error details
   */
  extractNpmError(lines, errorLine) {
    const errorDetails = {
      code: '',
      syscall: '',
      path: ''
    };
    
    // Look for npm error details in surrounding lines
    for (let i = errorLine; i < Math.min(errorLine + 5, lines.length); i++) {
      if (lines[i].includes('code ')) {
        const codeMatch = lines[i].match(/code\s+(\w+)/);
        if (codeMatch) errorDetails.code = codeMatch[1];
      }
      if (lines[i].includes('syscall ')) {
        const syscallMatch = lines[i].match(/syscall\s+(\w+)/);
        if (syscallMatch) errorDetails.syscall = syscallMatch[1];
      }
      if (lines[i].includes('path ')) {
        const pathMatch = lines[i].match(/path\s+(.+)/);
        if (pathMatch) errorDetails.path = pathMatch[1];
      }
    }
    
    return errorDetails;
  }
  
  /**
   * Extract generic error information
   */
  extractGenericError(lines, errorLine) {
    return {
      fullError: lines.slice(Math.max(0, errorLine - 2), Math.min(lines.length, errorLine + 3)).join('\n')
    };
  }
  
  /**
   * Extract exit code from output
   */
  extractExitCode(output) {
    const exitCodeMatch = output.match(/exit\s+code\s+(\d+)/i);
    return exitCodeMatch ? parseInt(exitCodeMatch[1]) : null;
  }
  
  /**
   * Generate error summary
   */
  generateErrorSummary(analysis) {
    const errorTypes = {};
    analysis.errors.forEach(error => {
      errorTypes[error.type] = (errorTypes[error.type] || 0) + 1;
    });
    
    const parts = [];
    if (analysis.errors.length > 0) {
      parts.push(`${analysis.errors.length} error${analysis.errors.length > 1 ? 's' : ''}`);
    }
    if (analysis.warnings.length > 0) {
      parts.push(`${analysis.warnings.length} warning${analysis.warnings.length > 1 ? 's' : ''}`);
    }
    
    const mainError = Object.entries(errorTypes)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (mainError) {
      parts.push(`(mainly ${mainError[0].replace(/_/g, ' ')})`);
    }
    
    return `Command failed with ${parts.join(', ')}`;
  }
  
  /**
   * Generate suggestions based on errors
   */
  generateSuggestions(analysis) {
    const suggestions = [];
    const errorTypes = new Set(analysis.errors.map(e => e.type));
    
    // C# specific suggestions
    if (errorTypes.has('csharp_compile')) {
      const missingReferences = analysis.errors.filter(e => 
        e.description && e.description.includes('could not be found')
      );
      
      if (missingReferences.length > 0) {
        suggestions.push('Missing references detected. Try running: dotnet restore');
        suggestions.push('Check if all required NuGet packages are installed');
        suggestions.push('Verify using directives at the top of the files');
      }
    }
    
    // NPM specific suggestions
    if (errorTypes.has('npm')) {
      suggestions.push('Try cleaning npm cache: npm cache clean --force');
      suggestions.push('Delete node_modules and package-lock.json, then run: npm install');
    }
    
    // Permission errors
    if (errorTypes.has('permission') || errorTypes.has('access')) {
      suggestions.push('Permission error detected. Try running with elevated privileges');
      suggestions.push('Check file/directory permissions');
    }
    
    // Build failures
    if (errorTypes.has('build_failed') || errorTypes.has('compile')) {
      suggestions.push('Build failed. Check the error messages above for specific issues');
      suggestions.push('Ensure all dependencies are properly installed');
    }
    
    // Memory issues
    if (errorTypes.has('memory')) {
      suggestions.push('Out of memory error. Try increasing heap size or closing other applications');
    }
    
    // Connection issues
    if (errorTypes.has('connection')) {
      suggestions.push('Connection error. Check if the service is running and accessible');
      suggestions.push('Verify firewall settings and network connectivity');
    }
    
    return suggestions;
  }
  
  /**
   * Get a formatted report of the analysis
   */
  getFormattedReport(analysis) {
    if (!analysis.hasErrors && analysis.warnings.length === 0) {
      return null;
    }
    
    let report = `\n🔍 Terminal Output Analysis\n`;
    report += `Command: ${analysis.command}\n`;
    report += `Summary: ${analysis.summary}\n\n`;
    
    if (analysis.errors.length > 0) {
      report += `❌ Errors (${analysis.errors.length}):\n`;
      analysis.errors.forEach((error, i) => {
        report += `  ${i + 1}. [${error.type}] Line ${error.lineNumber + 1}: ${error.message}\n`;
        if (error.file) {
          report += `     File: ${error.file}${error.position ? ` (${error.position})` : ''}\n`;
        }
        if (error.description) {
          report += `     Details: ${error.description}\n`;
        }
      });
      report += '\n';
    }
    
    if (analysis.warnings.length > 0) {
      report += `⚠️  Warnings (${analysis.warnings.length}):\n`;
      analysis.warnings.forEach((warning, i) => {
        report += `  ${i + 1}. [${warning.type}] ${warning.message}\n`;
      });
      report += '\n';
    }
    
    if (analysis.suggestions.length > 0) {
      report += `💡 Suggestions:\n`;
      analysis.suggestions.forEach((suggestion, i) => {
        report += `  ${i + 1}. ${suggestion}\n`;
      });
    }
    
    if (analysis.exitCode !== null && analysis.exitCode !== 0) {
      report += `\n⚠️  Process exited with code: ${analysis.exitCode}\n`;
    }
    
    return report;
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      errorsDetected: 0,
      warningsDetected: 0,
      criticalErrors: 0
    };
  }
  
  /**
   * Get current statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = TerminalErrorMonitor; 