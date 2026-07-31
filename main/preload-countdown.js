// 倒数日窗口 preload：contextIsolation 下通过 contextBridge 暴露受限 IPC API
// 替代 nodeIntegration，防止渲染进程 XSS 被升级为 Node.js 远程代码执行（RCE）
const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
    'countdown:toggle-minimize',
    'countdown:set-ignore-mouse',
]);

const INVOKE_CHANNELS = new Set([
    'countdown:get-mode',
]);

const ON_CHANNELS = new Set([
    'countdown:update',
    'countdown:mode',
]);

contextBridge.exposeInMainWorld('astraIPC', {
    send(channel, ...args) {
        if (!SEND_CHANNELS.has(channel)) {
            console.warn('[Preload] blocked send channel:', channel);
            return;
        }
        ipcRenderer.send(channel, ...args);
    },
    invoke(channel, ...args) {
        if (!INVOKE_CHANNELS.has(channel)) {
            console.warn('[Preload] blocked invoke channel:', channel);
            return Promise.reject(new Error('blocked channel: ' + channel));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, listener) {
        if (!ON_CHANNELS.has(channel)) {
            console.warn('[Preload] blocked on channel:', channel);
            return () => {};
        }
        // 保留 event 占位参数（null），与渲染进程既有 (e, arg) 回调签名兼容；
        // 不暴露真实的 IpcRendererEvent（含 sender 等内部对象）
        const wrapped = (_event, ...args) => listener(null, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },
});
