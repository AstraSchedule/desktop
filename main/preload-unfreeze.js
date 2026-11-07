// 解冻窗口 preload：contextIsolation 下通过 contextBridge 暴露受限 IPC API
const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
    'unfreeze-open-video',
]);

const ON_CHANNELS = new Set([
    'class-status-changed',
    'unfreeze-config',
]);

contextBridge.exposeInMainWorld('astraIPC', {
    send(channel) {
        if (!SEND_CHANNELS.has(channel)) {
            console.warn('[Preload] blocked send channel:', channel);
            return;
        }
        // 不转发任何参数：URL 由主进程固定，渲染进程无法夹带地址或协议
        ipcRenderer.send(channel);
    },
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
