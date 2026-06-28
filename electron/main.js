const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

let mainWindow = null;
let serverProcess = null;
let serverPort = 0;
let storageFile = null;

function persistentStoragePath() {
  if (!storageFile) {
    storageFile = path.join(app.getPath('userData'), 'desktop-local-storage.json');
  }
  return storageFile;
}

function loadPersistentStorage() {
  try {
    const raw = fs.readFileSync(persistentStoragePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string') out[key] = value;
    }
    return out;
  } catch (_error) {
    return {};
  }
}

function savePersistentStorage(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  const out = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof key === 'string' && typeof value === 'string') out[key] = value;
  }
  const file = persistentStoragePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
  fs.renameSync(tmp, file);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findServerPort() {
  const preferred = Number(process.env.PLAYER_DESKTOP_PORT || 18765);
  if (Number.isInteger(preferred) && preferred > 1024 && preferred < 65535) {
    if (await canUsePort(preferred)) return preferred;
  }
  return findFreePort();
}

function packagedServerPath() {
  return path.join(process.resourcesPath, 'backend', 'player-server', 'player-server.exe');
}

function serverCommand() {
  if (app.isPackaged) {
    return { command: packagedServerPath(), args: [] };
  }
  return { command: 'python', args: [path.join(app.getAppPath(), 'serve.py')] };
}

function waitForServer(port, timeoutMs = 16000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get({
        host: '127.0.0.1',
        port,
        path: '/',
        timeout: 1200,
      }, (res) => {
        res.resume();
        resolve();
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('本地播放器服务启动超时'));
        } else {
          setTimeout(ping, 240);
        }
      });
    };
    ping();
  });
}

async function startBackend() {
  serverPort = await findServerPort();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const { command, args } = serverCommand();
  serverProcess = spawn(command, [...args, String(serverPort)], {
    cwd: app.isPackaged ? path.dirname(command) : app.getAppPath(),
    env: Object.assign({}, process.env, {
      PLAYER_DATA_DIR: dataDir,
      PYTHONIOENCODING: 'utf-8',
    }),
    stdio: app.isPackaged ? 'ignore' : 'inherit',
    windowsHide: true,
  });
  serverProcess.on('exit', (code) => {
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-exit', code);
    }
  });
  await waitForServer(serverPort);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 900,
    minHeight: 680,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#087eaf',
    thickFrame: true,
    fullscreenable: true,
    hasShadow: true,
    roundedCorners: true,
    title: 'Immersive Lyrics',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const sendWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.webContents.once('did-finish-load', sendWindowState);
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (!mainWindow.isMaximized()) mainWindow.maximize();
});

ipcMain.handle('window:restore', () => {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    return;
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
});

ipcMain.handle('window:fullscreen', () => {
  if (mainWindow && !mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(true);
  }
});

ipcMain.handle('window:exit-fullscreen', () => {
  if (mainWindow && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('storage:load-sync', (event) => {
  event.returnValue = loadPersistentStorage();
});

ipcMain.on('storage:save', (_event, snapshot) => {
  try {
    savePersistentStorage(snapshot);
  } catch (error) {
    console.warn('[storage] save failed', error);
  }
});

ipcMain.on('storage:save-sync', (event, snapshot) => {
  try {
    savePersistentStorage(snapshot);
    event.returnValue = true;
  } catch (error) {
    console.warn('[storage] sync save failed', error);
    event.returnValue = false;
  }
});

function stopBackend() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  serverProcess = null;
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', stopBackend);
