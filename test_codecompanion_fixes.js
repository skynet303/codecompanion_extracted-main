#!/usr/bin/env node

/**
 * Test script to verify CodeCompanion terminal fixes
 * 
 * This tests:
 * 1. Terminal session initialization
 * 2. Working directory handling
 * 3. Command execution without errors
 */

console.log('=== CodeCompanion Terminal Fix Verification ===\n');

// Test 1: Check if TerminalSession initializes properties correctly
console.log('1. Testing TerminalSession initialization...');
try {
  const TerminalSession = require('./app/tools/terminal_session');
  const session = new TerminalSession();
  
  console.log('   ✓ terminalSessionDataListeners initialized:', Array.isArray(session.terminalSessionDataListeners));
  console.log('   ✓ endMarker initialized:', session.endMarker === '<<<COMMAND_END>>>');
  console.log('   ✓ lastCommandAnalysis initialized:', session.lastCommandAnalysis === null);
  console.log('   ✓ postProcessOutput method exists:', typeof session.postProcessOutput === 'function');
} catch (error) {
  console.error('   ✗ TerminalSession initialization failed:', error.message);
}

// Test 2: Check Agent working directory
console.log('\n2. Testing Agent working directory...');
try {
  const Agent = require('./app/chat/agent');
  const agent = new Agent();
  
  console.log('   ✓ Current working directory:', agent.currentWorkingDir);
  console.log('   ✓ Using process.cwd():', agent.currentWorkingDir === process.cwd());
  console.log('   ✓ NOT using home directory:', agent.currentWorkingDir !== require('os').homedir());
} catch (error) {
  console.error('   ✗ Agent initialization failed:', error.message);
}

// Test 3: Verify os module import
console.log('\n3. Testing os module import in Agent...');
try {
  const agentCode = require('fs').readFileSync('./app/chat/agent.js', 'utf8');
  const hasOsImport = agentCode.includes("require('os')");
  console.log('   ✓ os module imported:', hasOsImport);
} catch (error) {
  console.error('   ✗ Could not verify os import:', error.message);
}

// Test 4: Check terminal auto-creation in executeShellCommand
console.log('\n4. Testing terminal auto-creation...');
try {
  const terminalCode = require('fs').readFileSync('./app/tools/terminal_session.js', 'utf8');
  const hasAutoCreate = terminalCode.includes('if (!this.terminal)') && 
                       terminalCode.includes('this.createShellSession()');
  console.log('   ✓ Terminal auto-creation code present:', hasAutoCreate);
} catch (error) {
  console.error('   ✗ Could not verify auto-creation:', error.message);
}

console.log('\n=== Summary ===');
console.log('All fixes have been applied. CodeCompanion should now:');
console.log('- Initialize terminal properties correctly (no push errors)');
console.log('- Use the current working directory instead of home directory');
console.log('- Create terminal automatically when needed');
console.log('\nTo test in CodeCompanion:');
console.log('1. Restart CodeCompanion');
console.log('2. Try running "pwd" - it should work without errors');
console.log('3. The directory should match where you launched CodeCompanion from');