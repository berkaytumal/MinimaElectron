const { BrowserWindow, ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

class SettingsManager {
  constructor(config) {
    this.config = config;
    this.settingsWindow = null;
    this.setupIpcHandlers();
  }

  createWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 600,
      height: 400,
      title: 'Minima Settings',
      icon: this.config.PATHS.ICON,
      resizable: true,
      minimizable: true,
      maximizable: true,
      modal: false,
      transparent: true,
      titleBarStyle: 'hiddenInset', // Hide default title bar for custom styling
      vibrancy: 'fullscreen-ui', // macOS blur effect matching main window
      backgroundMaterial: 'acrylic', // Windows acrylic effect
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: false,
        webSecurity: true
      }
    });

    // Create settings HTML content
    const settingsHTML = this.generateSettingsHTML();

    // Handle window closed
    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    // Center the window on screen
    this.settingsWindow.center();

    // Load settings HTML
    this.settingsWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(settingsHTML));
  }

  generateSettingsHTML() {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Minima Settings</title>
      <style>
        :root {
          --bg-primary: rgba(255, 255, 255, 0.8);
          --bg-secondary: rgba(245, 245, 245, 0.9);
          --text-primary: #333;
          --text-secondary: #666;
          --border-color: rgba(224, 224, 224, 0.6);
          --shadow: rgba(0, 0, 0, 0.1);
          --button-cancel: rgba(229, 229, 231, 0.9);
          --button-cancel-hover: rgba(209, 209, 214, 0.9);
          --button-save: rgba(0, 122, 255, 0.9);
          --button-save-hover: rgba(0, 86, 204, 0.9);
        }
        
        @media (prefers-color-scheme: dark) {
          :root {
            --bg-primary: rgba(40, 40, 40, 0.8);
            --bg-secondary: rgba(30, 30, 30, 0.9);
            --text-primary: #ffffff;
            --text-secondary: #cccccc;
            --border-color: rgba(80, 80, 80, 0.6);
            --shadow: rgba(0, 0, 0, 0.3);
            --button-cancel: rgba(80, 80, 80, 0.9);
            --button-cancel-hover: rgba(100, 100, 100, 0.9);
            --button-save: rgba(0, 122, 255, 0.9);
            --button-save-hover: rgba(0, 86, 204, 0.9);
          }
        }
        
        * {
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 0;
          background: transparent;
          color: var(--text-primary);
          height: 100vh;
          display: flex;
          flex-direction: column;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .title-bar {
          height: var(--title-bar-height, 40px);
          background: var(--bg-primary);
          border-bottom: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          -webkit-app-region: drag;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .title-bar-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          user-select: none;
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        
        .setting-item {
          background: var(--bg-primary);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 12px;
          box-shadow: 0 2px 8px var(--shadow);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .setting-label {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
        }
        .setting-description {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .setting-left {
          flex: 1;
        }
        input[type="checkbox"] {
          width: 18px;
          height: 18px;
          margin-left: 16px;
          cursor: pointer;
          accent-color: #007AFF;
        }
        .setting-select {
          margin-left: 16px;
          padding: 8px 12px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 13px;
          cursor: pointer;
          min-width: 160px;
          outline: none;
          transition: all 0.2s ease;
        }
        .setting-select:focus {
          border-color: #007AFF;
          box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
        }
        .setting-select option {
          background: var(--bg-primary);
          color: var(--text-primary);
        }
        .buttons {
          position: sticky;
          bottom: 0;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
          padding: 16px 20px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          box-shadow: 0 -2px 10px var(--shadow);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        button {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .cancel-btn {
          background: var(--button-cancel);
          color: var(--text-primary);
        }
        .cancel-btn:hover {
          background: var(--button-cancel-hover);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px var(--shadow);
        }
        .save-btn {
          background: var(--button-save);
          color: white;
        }
        .save-btn:hover {
          background: var(--button-save-hover);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px var(--shadow);
        }
        button:active {
          transform: translateY(0);
        }
      </style>
    </head>
    <body>
        <div class="title-bar">
          <div class="title-bar-title">Minima Settings</div>
        </div>
      <div class="settings-content">
        <div class="setting-item">
          <div class="setting-left">
            <div class="setting-label">Start Minima on system boot</div>
            <div class="setting-description">Automatically launch Minima when your computer starts</div>
          </div>
          <input type="checkbox" id="startOnBoot">
        </div>

        <div class="setting-item">
          <div class="setting-left">
            <div class="setting-label">Show notifications</div>
            <div class="setting-description">Display system notifications for important events</div>
          </div>
          <input type="checkbox" id="showNotifications">
        </div>
        <div class="setting-item">
          <div class="setting-left">
            <div class="setting-label">Quit Behavior</div>
            <div class="setting-description">Choose what happens when you quit the application</div>
          </div>
          <select id="quitBehavior" class="setting-select">
            <option value="ask">Ask every time (default)</option>
            <option value="minimize">Minimize to tray</option>
            <option value="quit">Quit application</option>
            <option value="kill">Kill immediately</option>
          </select>
        </div>

      </div>
      
      <div class="buttons">
        <button class="cancel-btn" onclick="closeSettings()">Cancel</button>
        <button class="save-btn" onclick="saveSettings()">Save</button>
      </div>
      
      <script>
        const { ipcRenderer } = require('electron');
        
        // Load current settings
        window.addEventListener('DOMContentLoaded', () => {
          // Set a default title bar height for the settings window
          document.documentElement.style.setProperty('--title-bar-height', '45px');
          
          ipcRenderer.invoke('get-settings').then(settings => {
            document.getElementById('startOnBoot').checked = settings.startOnBoot || false;
            document.getElementById('showNotifications').checked = settings.showNotifications !== false;
            document.getElementById('quitBehavior').value = settings.quitBehavior || 'ask';
          }).catch(error => {
            console.error('Error loading settings:', error);
          });
        });
        
        function saveSettings() {
          const settings = {
            startOnBoot: document.getElementById('startOnBoot').checked,
            showNotifications: document.getElementById('showNotifications').checked,
            quitBehavior: document.getElementById('quitBehavior').value
          };
          
          ipcRenderer.invoke('save-settings', settings).then(() => {
            closeSettings();
          });
        }
        
        function closeSettings() {
          window.close();
        }
      </script>
    </body>
    </html>
  `;
  }

  setupIpcHandlers() {
    // Handle settings
    ipcMain.handle('get-settings', async () => {
      try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsPath)) {
          const settingsData = fs.readFileSync(settingsPath, 'utf8');
          return JSON.parse(settingsData);
        }
        return {
          startOnBoot: false,
          showNotifications: true,
          quitBehavior: 'ask'
        };
      } catch (error) {
        console.error('Error loading settings:', error);
        return {
          startOnBoot: false,
          showNotifications: true,
          quitBehavior: 'ask'
        };
      }
    });

    ipcMain.handle('save-settings', async (event, settings) => {
      try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        // Apply settings immediately
        if (settings.startOnBoot) {
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true
          });
        } else {
          app.setLoginItemSettings({
            openAtLogin: false
          });
        }

        return true;
      } catch (error) {
        console.error('Error saving settings:', error);
        return false;
      }
    });
  }

  getWindow() {
    return this.settingsWindow;
  }

  destroy() {
    if (this.settingsWindow) {
      this.settingsWindow.close();
      this.settingsWindow = null;
    }
  }
}

module.exports = SettingsManager;