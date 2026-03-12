const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  refreshState: () => ipcRenderer.invoke('refresh-state'),
  stopServer: (pid) => ipcRenderer.invoke('stop-server', pid),
  stopAllServers: () => ipcRenderer.invoke('stop-all-servers'),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  quit: () => ipcRenderer.invoke('quit-app'),
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (_, state) => callback(state))
});
