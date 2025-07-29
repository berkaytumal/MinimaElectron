const { Menu, Tray, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(config, mainWindow, createSettingsWindow) {
    this.config = config;
    this.mainWindow = mainWindow;
    this.createSettingsWindow = createSettingsWindow;
    this.tray = null;
  }

  create() {
    const trayIcon = nativeImage.createFromPath(this.config.PATHS.TRAY_ICON).resize({ width: 16, height: 16 });
    this.tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Minima',
        click: () => {
          this.mainWindow.show();
          if (process.platform === 'darwin') {
            app.dock.show();
          }
        }
      },
      {
        label: 'Settings',
        click: () => {
          this.createSettingsWindow();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          // Trigger the quit confirmation dialog
          app.quit();
        }
      }
    ]);

    this.tray.setToolTip('Minima');
    this.tray.setContextMenu(contextMenu);

    // For macOS, clicking the tray icon should show the window
    // Removed automatic window show on tray click
    // Users can use the context menu 'Show Minima' option instead

    return this.tray;
  }

  getTray() {
    return this.tray;
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;