/**
 * Terminal Testing Script
 * Run this in the developer console to test terminal functionality
 */

function testTerminal() {
  console.log('Starting terminal test...');
  
  // Check if chatController exists
  if (typeof chatController === 'undefined') {
    console.error('chatController not found! The app may not be fully initialized.');
    return;
  }
  
  // Check if terminal session exists
  if (!chatController.terminalSession) {
    console.error('Terminal session not found!');
    return;
  }
  
  // Run debug function
  chatController.terminalSession.debugTerminal();
  
  // Try to switch to terminal tab
  const terminalTab = document.getElementById('shell-tab');
  if (terminalTab) {
    console.log('Switching to terminal tab...');
    terminalTab.click();
    
    setTimeout(() => {
      // Check if terminal is visible
      const terminalOutput = document.getElementById('terminal_output');
      if (terminalOutput) {
        const rect = terminalOutput.getBoundingClientRect();
        console.log('Terminal element dimensions:', {
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0
        });
      }
      
      // Try to focus terminal
      if (chatController.terminalSession.terminal) {
        chatController.terminalSession.terminal.focus();
        console.log('Attempted to focus terminal');
      }
    }, 500);
  } else {
    console.error('Terminal tab not found!');
  }
}

// Instructions to use
console.log('Terminal test script loaded.');
console.log('To test the terminal, run: testTerminal()');
console.log('You can also access the terminal directly via: chatController.terminalSession');