const { app, BrowserWindow, ipcMain, Menu, dialog, Tray, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const keytar = require('keytar');
const net = require('net');

const SERVICE = 'minima-electron';
const ACCOUNT = 'mds-password';

// Global variables for tray and main window
let mainWindow;
let tray = null;

// Function to check if a port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // Port is in use
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false); // Port is free
    });

    server.listen(port);
  });
}

async function getPassword() {
  try {
    return await keytar.getPassword(SERVICE, ACCOUNT);
  } catch {
    return null;
  }
}

async function savePassword(password) {
  await keytar.setPassword(SERVICE, ACCOUNT, password);
}

async function killExistingMinima() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows command to kill Java processes running minima.jar
      exec('taskkill /F /FI "IMAGENAME eq java.exe" /FI "WINDOWTITLE eq *minima*"', (err) => {
        // Wait a bit for the process to fully terminate
        setTimeout(() => resolve(), 2000);
      });
    } else {
      // Linux/Mac command
      exec("pkill -f 'java.*minima\\.jar'", (err) => {
        // Wait a bit for the process to fully terminate
        setTimeout(() => resolve(), 2000);
      });
    }
  });
}

async function runMinima(password, win) {
  // Check if Minima ports are already in use
  const port9001InUse = await isPortInUse(9001);
  const port9003InUse = await isPortInUse(9003);

  if (port9001InUse || port9003InUse) {
    console.log('Minima appears to be already running. Showing options to the user...');
    win.webContents.send('minima-already-running');
    return;
  }

  // Get the correct path to minima.jar (works in dev and production)
  let minimaPath = 'minima.jar';
  if (app.isPackaged) {
    minimaPath = path.join(process.resourcesPath, 'minima.jar');
  }

  const args = [
    '-jar', minimaPath,
    '-data', 'minidata1',
    '-basefolder', 'minidata1',
    '-mdsenable',
    '-mdspassword', password
  ];
  const java = spawn('java', args);
  global.java = java; // Store globally to access in other parts of the app
  let webviewAdded = false;
  java.stdout.on('data', (data) => {
    const str = data.toString();
    process.stdout.write(str);
    if (str.includes('SERIOUS ERROR loadAllDB')) {
      win.webContents.send('database-lock-error');
      return;
    }
    if (!webviewAdded && str.includes('SSL server started on port 9003')) {
      webviewAdded = true;
      win.webContents.send('minima-ready');
    }
  });
  java.stderr.on('data', (data) => process.stderr.write(data.toString()));
  java.on('close', code => {
    if (code !== 0 && code !== null) {
      win.webContents.executeJavaScript(`alert('Minima exited with code ${code}')`);
    }
  });

  // Handle app quit - ensure we clean up the Java process
  /*app.on('before-quit', () => {
    if (!java.killed) {
      java.kill();
    }
  });*/
}

function createWindow() {
  // Set the appropriate icon path based on platform
  let iconPath;
  if (process.platform === 'darwin') {
    // On macOS, use the icon from iconset
    iconPath = path.join(__dirname, 'assets/icon.png');
  } else if (process.platform === 'win32') {
    // On Windows, use the 256x256 icon
    iconPath = path.join(__dirname, 'assets/icon.png');
  } else {
    // On Linux, use the largest icon
    iconPath = path.join(__dirname, 'assets/icon.png');
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: app.getName(),
    icon: iconPath,
    transparent: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true
    }
  });
  mainWindow.setVibrancy('under-window');

  // Handle certificate errors
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // Allow self-signed certificates for localhost
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // Set up handlers for the IPC events from the UI
  ipcMain.on('connect-to-minima', () => {
    mainWindow.webContents.send('minima-ready');
  });

  ipcMain.on('restart-minima', async () => {
    await killExistingMinima();
    // Wait a bit to ensure ports are freed
    setTimeout(async () => {
      const password = await getPassword();
      if (password) {
        runMinima(password, mainWindow);
      } else {
        mainWindow.webContents.send('show-password-prompt');
      }
    }, 2000);
  });

  // Handle window close event - minimize to tray instead
  mainWindow.on('close', (event) => {
    // Don't close the window, just hide it unless we're actually quitting
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // On macOS, hide the dock icon when window is hidden
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
      return false;
    }
  });

  mainWindow.loadFile('www/index.html');

  // Check if the Minima ports are already in use
  Promise.all([isPortInUse(9001), isPortInUse(9003)]).then(async ([port9001InUse, port9003InUse]) => {
    const minimaAlreadyRunning = port9001InUse || port9003InUse;

    if (minimaAlreadyRunning) {
      console.log('Minima appears to be already running. Showing options to the user...');
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('minima-already-running');
      });
      return;
    }

    // Normal flow for starting Minima when it's not running
    let password = await getPassword();
    if (!password) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('show-password-prompt');
      });
      ipcMain.once('set-password', async (event, input) => {
        if (input) {
          await savePassword(input);
          runMinima(input, mainWindow);
        }
      });
    } else {
      runMinima(password, mainWindow);
    }
  });
}

app.whenReady().then(() => {
  // Create custom menu with just Reset and DevTools options
  const template = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'Reset',
          click: () => {
            // Run "npm run reset"
            exec('npm run reset', { cwd: process.cwd() }, (error, stdout, stderr) => {
              if (error) {
                console.error(`Error running reset: ${error.message}`);
                return;
              }
              if (stdout) console.log(stdout);
              if (stderr) console.error(stderr);
              // Restart the app after reset
              app.relaunch();
              app.exit(0);
            });
          }
        },
        {
          label: 'Open DevTools',
          click: () => {
            // Get the focused window
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.openDevTools();
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // For macOS, set the dock icon explicitly
  if (process.platform === 'darwin') {
    const dockIcon = path.join(__dirname, 'assets/icon.png');
    app.dock.setIcon(dockIcon);
  }

  // Create tray icon
  const trayIconPath = path.join(__dirname, process.platform === 'darwin' ? 'assets/tray/tray.png' : 'assets/icon.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Minima',
      click: () => {
        mainWindow.show();
        if (process.platform === 'darwin') {
          app.dock.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        global?.java?.kill();
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Minima');
  tray.setContextMenu(contextMenu);

  // For macOS, clicking the tray icon should only show the window
  if (process.platform === 'darwin') {
    tray.on('click', () => {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
        app.dock.show();
      }
    });
  }

  createWindow();
});

// Handle macOS behavior where clicking the dock icon should re-open a window
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});