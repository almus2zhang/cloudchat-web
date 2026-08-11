const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400, // Expanded default width to accommodate DevTools side-by-side
    height: 800,
    title: "CloudChat Desktop",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Disables CORS checks to support direct WebDAV communication
    }
  });

  // Load the built vite output HTML file
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  
  // Set window menu to null for a cleaner, premium application feel
  mainWindow.setMenu(null);

  // Open Chrome Developer Tools if needed for debugging
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
