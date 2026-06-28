const { contextBridge, ipcRenderer } = require('electron');

function snapshotLocalStorage() {
  const data = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key != null) data[key] = window.localStorage.getItem(key);
    }
  } catch (_error) {}
  return data;
}

function installPersistentLocalStorage() {
  try {
    const saved = ipcRenderer.sendSync('storage:load-sync') || {};
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value === 'string') window.localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn('[desktop-storage] restore failed', error);
  }

  let timer = null;
  const persist = (sync = false) => {
    const snapshot = snapshotLocalStorage();
    if (sync) {
      try { ipcRenderer.sendSync('storage:save-sync', snapshot); } catch (_error) {}
    } else {
      ipcRenderer.send('storage:save', snapshot);
    }
  };
  const schedulePersist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      persist(false);
    }, 120);
  };

  try {
    const proto = Object.getPrototypeOf(window.localStorage);
    for (const name of ['setItem', 'removeItem', 'clear']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function patchedStorageMethod(...args) {
        const result = original.apply(this, args);
        schedulePersist();
        return result;
      };
    }
  } catch (error) {
    console.warn('[desktop-storage] patch failed', error);
  }
  window.addEventListener('pagehide', () => persist(true));
  window.addEventListener('beforeunload', () => persist(true));
  setInterval(() => persist(false), 3000);
}

installPersistentLocalStorage();

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  restore: () => ipcRenderer.invoke('window:restore'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('window:exit-fullscreen'),
  close: () => ipcRenderer.invoke('window:close'),
  onWindowState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state || {});
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('desktop-shell');
});
