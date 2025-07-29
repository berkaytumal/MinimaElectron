const readline = require('readline');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Check if confirmation argument is provided
const args = process.argv.slice(2);
const hasConfirmFlag = args.includes('--confirm') || args.includes('-y');

function performReset() {
  try {
    // Determine data path
    const dataPath = app?.isPackaged 
      ? path.join(app.getPath('userData'), 'minidata') 
      : './minidata1';
    
    console.log(`Removing data directory: ${dataPath}`);
    
    // Remove data directory
    if (fs.existsSync(dataPath)) {
      fs.rmSync(dataPath, { recursive: true, force: true });
      console.log('Data directory removed successfully.');
    } else {
      console.log('Data directory does not exist.');
    }
    
    // Remove stored password
    require('keytar').deletePassword('minima-electron', 'mds-password')
      .then(() => {
        console.log('Password removed from keychain.');
        console.log('Reset completed successfully.');
        process.exit(0);
      })
      .catch((err) => {
        console.log('No password found in keychain or error removing it:', err.message);
        console.log('Reset completed.');
        process.exit(0);
      });
      
  } catch (error) {
    console.error('Error during reset:', error.message);
    process.exit(1);
  }
}

function askConfirmation() {
  rl.question('⚠️  This will permanently delete all Minima data and saved passwords. Are you sure? (y/N): ', (answer) => {
    const confirmed = answer.toLowerCase() === 'y';
    
    if (confirmed) {
      console.log('Proceeding with reset...');
      rl.close();
      performReset();
    } else {
      console.log('Reset cancelled.');
      rl.close();
      process.exit(0);
    }
  });
}

// Main execution
if (hasConfirmFlag) {
  console.log('Confirmation flag detected, proceeding with reset...');
  performReset();
} else {
  askConfirmation();
}