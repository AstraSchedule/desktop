// 解冻窗口 preload：contextIsolation 下通过 contextBridge 暴露受限 IPC API
const { contextBridge, ipcRenderer } = require('electron');

const ON_CHANNELS = new Set([
    'class-status-changed',
    'unfreeze-config',
]);

contextBridge.exposeInMainWorld('astraIPC', {
    on(channel, listener) {
        if (!ON_CHANNELS.has(channel)) {
            console.warn('[Preload] blocked on channel:', channel);
            return () => {};
        }
        const wrapped = (_event, ...args) => listener(null, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    }
});
