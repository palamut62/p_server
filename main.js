const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, clipboard } = require('electron');
const path = require('path');
const { scanServers, stopServerTree, stopAllServers } = require('./server-monitor');

let tray = null;
let popupWindow = null;
let refreshTimer = null;
let refreshing = false;
const POPUP_MARGIN = 8;
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 440;
let appState = {
  servers: [],
  summary: {
    activeCount: 0,
    portCount: 0,
    totalMemoryMb: 0,
    refreshedAt: new Date().toISOString(),
    error: ''
  }
};

function updateStateError(message) {
  appState = {
    ...appState,
    summary: {
      ...appState.summary,
      refreshedAt: new Date().toISOString(),
      error: message
    }
  };
  updateTrayPresentation();
  broadcastState();
  return appState;
}

function broadcastState() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('state-update', appState);
  }
}

async function refreshState() {
  if (refreshing) {
    return appState;
  }

  refreshing = true;

  try {
    appState = await scanServers();
  } catch (error) {
    appState = {
      ...appState,
      summary: {
        ...appState.summary,
        refreshedAt: new Date().toISOString(),
        error: error.message
      }
    };
  } finally {
    refreshing = false;
    updateTrayPresentation();
    broadcastState();
  }

  return appState;
}

async function handleStopServer(pid) {
  try {
    await stopServerTree(pid);
  } catch (error) {
    await refreshState();
    return updateStateError(error.message);
  }

  return refreshState();
}

async function handleStopAllServers() {
  await stopAllServers(appState.servers);
  return refreshState();
}

function buildTrayMenu() {
  const serverItems = appState.servers.slice(0, 8).map((server) => ({
    label: `${server.displayName}  :${server.primaryPort || '-'}`,
    submenu: [
      { label: `PID ${server.pid}`, enabled: false },
      { label: server.command, enabled: false },
      { type: 'separator' },
      { label: 'Kapat', click: () => handleStopServer(server.pid) }
    ]
  }));

  const template = [
    { label: `Aktif sunucu: ${appState.summary.activeCount}`, enabled: false },
    { label: 'Paneli Ac', click: () => createPopupWindow() },
    { label: 'Yenile', click: () => refreshState() }
  ];

  if (appState.servers.length > 0) {
    template.push({ label: 'Tumunu Kapat', click: () => handleStopAllServers() });
    template.push({ type: 'separator' });
    template.push(...serverItems);
  }

  template.push({ type: 'separator' });
  template.push({ label: 'Cikis', click: () => app.quit() });

  return Menu.buildFromTemplate(template);
}

function updateTrayPresentation() {
  if (!tray) {
    return;
  }

  tray.setToolTip(`Server Keeper - ${appState.summary.activeCount} aktif sunucu`);
  tray.setContextMenu(buildTrayMenu());
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPopupBounds(display, trayBounds) {
  const { bounds, workArea } = display;
  const width = Math.min(POPUP_WIDTH, Math.max(260, workArea.width - POPUP_MARGIN * 2), workArea.width);
  const height = Math.min(POPUP_HEIGHT, Math.max(380, workArea.height - POPUP_MARGIN * 2), workArea.height);
  const workAreaRight = workArea.x + workArea.width;
  const workAreaBottom = workArea.y + workArea.height;
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const taskbarTop = workArea.y > bounds.y;
  const taskbarBottom = workAreaBottom < boundsBottom;
  const taskbarLeft = workArea.x > bounds.x;
  const taskbarRight = workAreaRight < boundsRight;

  let x = workAreaRight - width - POPUP_MARGIN;
  let y = workAreaBottom - height - POPUP_MARGIN;

  if (taskbarBottom || taskbarTop) {
    const trayCenterX = trayBounds.x + Math.round(trayBounds.width / 2);
    x = clamp(
      trayCenterX - Math.round(width / 2),
      workArea.x + POPUP_MARGIN,
      workAreaRight - width - POPUP_MARGIN
    );
    y = taskbarTop
      ? workArea.y + POPUP_MARGIN
      : workAreaBottom - height - POPUP_MARGIN;
  } else if (taskbarLeft || taskbarRight) {
    const trayCenterY = trayBounds.y + Math.round(trayBounds.height / 2);
    y = clamp(
      trayCenterY - Math.round(height / 2),
      workArea.y + POPUP_MARGIN,
      workAreaBottom - height - POPUP_MARGIN
    );
    x = taskbarLeft
      ? workArea.x + POPUP_MARGIN
      : workAreaRight - width - POPUP_MARGIN;
  }

  return { x, y, width, height };
}

function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
    return;
  }

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const popupBounds = getPopupBounds(display, trayBounds);

  popupWindow = new BrowserWindow({
    width: popupBounds.width,
    height: popupBounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#0f0f11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popupWindow.setBounds(popupBounds);
  popupWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
    broadcastState();
  });

  popupWindow.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const baseIcon = nativeImage.createFromPath(iconPath);

  if (baseIcon.isEmpty()) {
    throw new Error(`Tray icon could not be loaded: ${iconPath}`);
  }

  const trayIconSize = process.platform === 'win32' ? 16 : 18;
  return baseIcon.resize({ width: trayIconSize, height: trayIconSize, quality: 'best' });
}

function createTray() {
  tray = new Tray(getTrayIcon());
  updateTrayPresentation();

  tray.on('click', () => {
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
      popupWindow.hide();
    } else {
      createPopupWindow();
    }
  });
}

ipcMain.handle('get-state', () => appState);
ipcMain.handle('refresh-state', () => refreshState());
ipcMain.handle('stop-server', (_, pid) => handleStopServer(pid));
ipcMain.handle('stop-all-servers', () => handleStopAllServers());
ipcMain.handle('copy-text', (_, value) => {
  clipboard.writeText(String(value || ''));
});
ipcMain.handle('quit-app', () => {
  app.quit();
});

app.whenReady().then(async () => {
  createTray();
  await refreshState();

  refreshTimer = setInterval(() => {
    refreshState();
  }, 5000);
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
