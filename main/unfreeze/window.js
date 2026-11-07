const path = require('node:path');
const { BrowserWindow } = require('electron');

let unfreezeWin = null;

// 由调试选项设置的解冻时间（持久化在主进程侧，窗口重建/重载后立即补发）
let unfreezeConfig = {
    startTime: '2026-12-29 00:00:00',
    endTime: '2026-12-31 13:00:00'
};

// 创建刘德华解冻动画窗口（右下角置底，默认隐藏）
function createUnfreezeWindow(screen) {
    if (unfreezeWin && !unfreezeWin.isDestroyed()) return unfreezeWin;

    unfreezeWin = new BrowserWindow({
        width: 300,
        height: 300,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: false,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', '..', 'main', 'preload-unfreeze.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    const workArea = screen.getPrimaryDisplay().workAreaSize;
    unfreezeWin.setPosition(workArea.width - 300, workArea.height - 300);
    unfreezeWin.setAlwaysOnTop(false, 'desktop');
    // noinspection JSIgnoredPromiseFromCall
    unfreezeWin.loadFile(path.join(__dirname, '..', '..', 'unfreeze.html'));
    unfreezeWin.webContents.once('did-finish-load', () => {
        unfreezeWin.webContents.send('unfreeze-config', unfreezeConfig);
    });
    unfreezeWin.on('closed', () => {
        unfreezeWin = null;
    });
    console.log('[Unfreeze] Window created at bottom-right corner');
    return unfreezeWin;
}

function toggleUnfreezeWindow(show) {
    if (!unfreezeWin || unfreezeWin.isDestroyed()) return;
    if (show) {
        unfreezeWin.showInactive();
        console.log('[Unfreeze] Window shown');
    } else {
        unfreezeWin.hide();
        console.log('[Unfreeze] Window hidden');
    }
}

function destroyUnfreezeWindow() {
    if (unfreezeWin && !unfreezeWin.isDestroyed()) unfreezeWin.destroy();
    unfreezeWin = null;
}

// 主进程收到课程状态后转发给解冻窗口
function forwardClassStatus(arg) {
    if (unfreezeWin && !unfreezeWin.isDestroyed()) {
        unfreezeWin.webContents.send('class-status-changed', arg);
    }
}

// 调试选项设置时间：保存并立即下发给已存在的解冻窗口
function setUnfreezeTimes(startTime, endTime) {
    unfreezeConfig = {startTime, endTime};
    if (unfreezeWin && !unfreezeWin.isDestroyed()) {
        unfreezeWin.webContents.send('unfreeze-config', unfreezeConfig);
    }
}

function getUnfreezeTimes() {
    return unfreezeConfig;
}

module.exports = { createUnfreezeWindow, toggleUnfreezeWindow, destroyUnfreezeWindow, forwardClassStatus, setUnfreezeTimes, getUnfreezeTimes };
