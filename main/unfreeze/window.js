const path = require('node:path');
const { BrowserWindow, ipcMain, shell } = require('electron');
const { parseStoredTime } = require('./time');

// 解冻完成（100%）后点击跳转的视频链接：固定在主进程，不接受渲染进程传参，
// 避免 sandbox 窗口把任意 URL/协议带进 shell.openExternal
const UNFREEZE_VIDEO_URL = 'https://www.bilibili.com/video/BV1ad4y1V7wb';

ipcMain.on('unfreeze-open-video', () => {
    shell.openExternal(UNFREEZE_VIDEO_URL).catch((err) => {
        console.warn('[Unfreeze] Failed to open video link:', err?.message || err)
    })
});

let unfreezeWin = null;
let lastClassStatus = null;

// 由调试选项设置的解冻时间（持久化在主进程侧，窗口重建/重载后立即补发）
const DEFAULT_UNFREEZE_CONFIG = {
    startTime: '2026-12-01 00:00:00',
    endTime: '2026-12-31 13:00:00'
};
let unfreezeConfig = { ...DEFAULT_UNFREEZE_CONFIG };

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
        // 课程状态未必会再变化，补发一次缓存值，保证页面能拿到当前状态
        if (lastClassStatus) {
            unfreezeWin.webContents.send('class-status-changed', lastClassStatus);
        }
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

// 主进程收到课程状态后转发给解冻窗口，并缓存最新值供页面加载后补发
function forwardClassStatus(arg) {
    lastClassStatus = arg;
    if (unfreezeWin && !unfreezeWin.isDestroyed()) {
        unfreezeWin.webContents.send('class-status-changed', arg);
    }
}

// 调试选项设置时间：校验持久化值后保存并立即下发给已存在的解冻窗口
function setUnfreezeTimes(startTime, endTime) {
    unfreezeConfig = {
        startTime: parseStoredTime(startTime, DEFAULT_UNFREEZE_CONFIG.startTime),
        endTime: parseStoredTime(endTime, DEFAULT_UNFREEZE_CONFIG.endTime)
    };
    if (unfreezeWin && !unfreezeWin.isDestroyed()) {
        unfreezeWin.webContents.send('unfreeze-config', unfreezeConfig);
    }
}

function getUnfreezeTimes() {
    return unfreezeConfig;
}

module.exports = { createUnfreezeWindow, toggleUnfreezeWindow, destroyUnfreezeWindow, forwardClassStatus, setUnfreezeTimes, getUnfreezeTimes };
