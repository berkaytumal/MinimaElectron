const { app, BrowserWindow, ipcMain, Menu, dialog, Tray, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const keytar = require('keytar');
const net = require('net');

// Configuration constants
const CONFIG = {
  SERVICE: 'minima-electron',
  ACCOUNT: 'mds-password',
  PORTS: {
    MINIMA: 9001,
    MDS: 9003
  },
  PATHS: {
    JAR: app.isPackaged ? path.join(process.resourcesPath, 'minima.jar') : 'minima.jar',
    DATA_DIR: app.isPackaged ? path.join(app.getPath('userData'), 'minidata') : 'minidata1',
    ICON: path.join(__dirname, 'assets/icon.png'),
    TRAY_ICON: path.join(__dirname, 'assets/tray/tray.png')
  }
};

// Global variables for tray and main window
let mainWindow;
let tray = null;

// Function to check if a port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      resolve(err.code === 'EADDRINUSE'); // Port is in use if we get EADDRINUSE error
    });

    server.once('listening', () => {
      server.close();
      resolve(false); // Port is free
    });

    server.listen(port);
  });
}

// Password management functions
const passwordManager = {
  async get() {
    try {
      return await keytar.getPassword(CONFIG.SERVICE, CONFIG.ACCOUNT);
    } catch {
      return null;
    }
  },

  async save(password) {
    await keytar.setPassword(CONFIG.SERVICE, CONFIG.ACCOUNT, password);
  },

  async delete() {
    return keytar.deletePassword(CONFIG.SERVICE, CONFIG.ACCOUNT);
  }
};

// Function to kill existing Minima process
async function killExistingMinima() {
  const cmd = process.platform === 'win32'
    ? 'taskkill /F /FI "IMAGENAME eq java.exe" /FI "WINDOWTITLE eq *minima*"'
    : "pkill -f 'java.*minima\\.jar'";

  return new Promise((resolve) => {
    exec(cmd, () => {
      // Wait a bit for the process to fully terminate
      setTimeout(resolve, 2000);
    });
  });
}

async function runMinima(password, win) {
  // Check if Minima ports are already in use
  const [port9001InUse, port9003InUse] = await Promise.all([
    isPortInUse(CONFIG.PORTS.MINIMA),
    isPortInUse(CONFIG.PORTS.MDS)
  ]);

  if (port9001InUse || port9003InUse) {
    console.log('Minima appears to be already running. Showing options to the user...');
    win.webContents.send('minima-already-running');
    return;
  }

  const minimaPath = CONFIG.PATHS.JAR;
  const dataDir = CONFIG.PATHS.DATA_DIR;

  // Check if the JAR file exists
  if (!fs.existsSync(minimaPath)) {
    console.error('JAR file not found at expected location:', minimaPath);
    win.webContents.executeJavaScript(`alert('Could not find minima.jar. Please reinstall Minima Electron.')`);
    return;
  }

  // Ensure data directory exists in packaged mode
  if (app.isPackaged && !fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('Created data directory at:', dataDir);
    } catch (err) {
      console.error('Failed to create data directory:', err);
    }
  }

  const args = [
    '-jar', minimaPath,
    '-data', dataDir,
    '-basefolder', dataDir,
    '-mdsenable',
    '-mdspassword', password
  ];
  console.log('Starting Java with args:', args.filter(arg => arg !== password).concat(['[PASSWORD]']));

  // Check if Java is available before starting Minima
  try {
    const javaCheck = spawn('java', ['-version']);

    javaCheck.on('error', (err) => {
      console.error('Java not found:', err);
      win.webContents.executeJavaScript(`alert('Java runtime is not available. Please install Java and try again.')`);
      throw new Error('Java not available');
    });

    await new Promise((resolve, reject) => {
      javaCheck.on('close', code => code === 0 ? resolve() : reject(new Error(`Java check failed with code ${code}`)));
      setTimeout(resolve, 1000); // Timeout if it doesn't exit quickly
    });

    // Start Minima process after Java check succeeds
    const java = spawn('java', args);
    global.java = java; // Store globally to access in other parts of the app
    let webviewAdded = false;

    // Handle process events
    java.on('error', (err) => {
      console.error('Failed to start Java process:', err);
      win.webContents.executeJavaScript(`alert('Failed to start Minima: ${err.message}')`);
    });

    java.stdout.on('data', (data) => {
      const str = data.toString();
      process.stdout.write(str);

      // Check for specific output patterns
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
  } catch (err) {
    console.error('Failed to start Minima:', err);
  }
}

function createWindow() {
  // Create main window with appropriate configurations based on platform
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: app.getName(),
    icon: CONFIG.PATHS.ICON,
    transparent: true,
    titleBarStyle: 'hidden',
    vibrancy: 'fullscreen-ui', // Use 'light' for blur with white borders
    backgroundMaterial: "acrylic",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true
    }
  });

  // Handle certificate errors - allow self-signed certificates for localhost
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // Set up IPC event handlers
  setupIpcHandlers();

  // Handle window close event - minimize to tray instead
  mainWindow.on('close', (event) => {
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

  // Load the main HTML file
  mainWindow.loadFile('www/index.html');

  // Check Minima status and initialize
  initializeMinima();
}

// Set up IPC event handlers
function setupIpcHandlers() {
  ipcMain.on('connect-to-minima', () => {
    mainWindow.webContents.send('minima-ready');
  });

  ipcMain.on('restart-minima', async () => {
    await killExistingMinima();

    // Wait for ports to free up, then start Minima
    setTimeout(async () => {
      const password = await passwordManager.get();
      if (password) {
        runMinima(password, mainWindow);
      } else {
        mainWindow.webContents.send('show-password-prompt');
      }
    }, 2000);
  });

  // Handle password setting
  ipcMain.on('set-password', async (event, input) => {
    if (input) {
      await passwordManager.save(input);
      runMinima(input, mainWindow);
    } else {
      mainWindow.webContents.send('password-error', 'Password is required');
    }
  });
}

// Check Minima status and start accordingly
async function initializeMinima() {
  try {
    // Check if Minima ports are already in use
    const [port9001InUse, port9003InUse] = await Promise.all([
      isPortInUse(CONFIG.PORTS.MINIMA),
      isPortInUse(CONFIG.PORTS.MDS)
    ]);

    const minimaAlreadyRunning = port9001InUse || port9003InUse;

    // Wait for window to be ready
    await new Promise(resolve => {
      mainWindow.webContents.once('did-finish-load', resolve);
    });

    if (minimaAlreadyRunning) {
      console.log('Minima appears to be already running. Showing options to the user...');
      mainWindow.webContents.send('minima-already-running');
      return;
    }

    // Normal flow for starting Minima when it's not running
    const password = await passwordManager.get();

    if (!password) {
      mainWindow.webContents.send('show-password-prompt');
    } else {
      runMinima(password, mainWindow);
    }
  } catch (err) {
    console.error('Error initializing Minima:', err);
    mainWindow.webContents.executeJavaScript(`alert('Error initializing application: ${err.message}')`);
  }
}

// Reset application data and restart
async function resetApp() {
  const { dialog } = require('electron');
  
  // Show native confirmation dialog
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Reset'],
    defaultId: 0,
    cancelId: 0,
    title: 'Reset Minima',
    message: 'Reset Minima Data',
    detail: 'This will permanently delete all Minima data and saved passwords. Are you sure?'
  });
  
  // If user clicked Cancel (button index 0), return early
  if (result.response === 0) {
    return;
  }
  
  try {
    if (app.isPackaged) {
      // Delete data directory if it exists
      if (fs.existsSync(CONFIG.PATHS.DATA_DIR)) {
        fs.rmSync(CONFIG.PATHS.DATA_DIR, { recursive: true, force: true });
      }

      // Delete password from keychain
      await passwordManager.delete();
      console.log('Password and data directory removed.');
    } else {
      // In development, run npm reset with confirmation flag
      await new Promise((resolve, reject) => {
        exec('npm run reset -- --confirm', { cwd: process.cwd() }, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error running reset: ${error.message}`);
            reject(error);
            return;
          }
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
          resolve();
        });
      });
    }
  } catch (err) {
    console.error('Error during reset:', err);
  } finally {
    // Always restart the app
    app.relaunch();
    app.exit(0);
  }
}

// Create application menu
function createAppMenu() {
  const template = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'Reset',
          click: resetApp
        },
        {
          label: 'Show App Info',
          click: () => {
            const info = {
              isPackaged: app.isPackaged,
              appPath: app.getAppPath(),
              resourcesPath: process.resourcesPath,
              userData: app.getPath('userData'),
              minimaJarPath: CONFIG.PATHS.JAR,
              minimaJarExists: fs.existsSync(CONFIG.PATHS.JAR)
            };

            dialog.showMessageBox({
              title: 'App Information',
              message: 'Application Information',
              detail: JSON.stringify(info, null, 2),
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Open DevTools',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.openDevTools();
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create system tray
function createTray() {
  const trayIcon = nativeImage.createFromPath(CONFIG.PATHS.TRAY_ICON).resize({ width: 16, height: 16 });
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
        // Kill Java process before quitting
        if (global.java && !global.java.killed) {
          global.java.kill();
        }
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Minima');
  tray.setContextMenu(contextMenu);

  // For macOS, clicking the tray icon should show the window
  if (process.platform === 'darwin') {
    tray.on('click', () => {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
        app.dock.show();
      }
    });
  }
}

// Initialize app when ready
app.whenReady().then(() => {
  createAppMenu();

  // For macOS, set the dock icon
  if (process.platform === 'darwin') {
    app.dock.setIcon(CONFIG.PATHS.ICON);
  }

  createTray();
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