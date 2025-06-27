#!/usr/bin/env node

// Test script to verify terminal execution working directory

console.log('=== Terminal Working Directory Test ===');
console.log('Current process.cwd():', process.cwd());
console.log('Current __dirname:', __dirname);
console.log('Environment PWD:', process.env.PWD);

// Expected: Should show /home/user/Downloads/test (or similar user directory)
// Not: /workspace

console.log('\nIf you see /workspace above, the terminal is NOT in the correct directory!');
console.log('Expected: User\'s actual working directory (e.g., ~/Downloads/test)');