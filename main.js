const electron = require('electron');
const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell } = electron
const path = require('node:path');
const fs = require('node:fs')
const os = require('node:os')
const createShortcut = require('windows-shortcuts')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const prompt = require('electron-prompt');
const Store = require('electron-store');
const store = new Store();
const clientConfig = require('./main/clientConfig');

// 安装器可在安装目录写入一次性初始化文件。仅打包应用读取，避免开发目录中的文件
// 意外影响开发配置；导入成功后删除文件，后续运行完全依赖 electron-store。
function getInstallConfigPath() {
    if (!app.isPackaged || !process.execPath) return null;
    return path.join(path.dirname(process.execPath), 'install-config.ini');
}

function parseInstallConfig(raw) {
    const text = raw.includes('\u0000') ? raw.replace(/^\uFFFE/, '').replace(/^\uFEFF/, '') : raw.replace(/^\uFEFF/, '');
    const result = {};
    let section = '';
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            section = trimmed.slice(1, -1).trim().toLowerCase();
            continue;
        }
        if (section !== 'app') continue;
        const separator = trimmed.indexOf('=');
        if (separator < 1) continue;
        const key = trimmed.slice(0, separator).trim();
        result[key] = trimmed.slice(separator + 1).trim();
    }
    return result;
}

function parseInstallBoolean(value) {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
    return undefined;
}

function importInstallConfig() {
    const configPath = getInstallConfigPath();
    if (!configPath || !fs.existsSync(configPath)) return;

    try {
        const buffer = fs.readFileSync(configPath);
        const raw = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8');
        const config = parseInstallConfig(raw);
        const stringKeys = ['server', 'class', 'local'];
        const booleanKeys = ['isFromCloud', 'isSecureConnection', 'isAutoLaunch', 'isWindowAlwaysOnTop'];
        let imported = false;

        for (const key of stringKeys) {
            if (typeof config[key] === 'string' && config[key].length > 0) {
                store.set(key, config[key]);
                imported = true;
            }
        }
        for (const key of booleanKeys) {
            if (typeof config[key] !== 'string') continue;
            const value = parseInstallBoolean(config[key]);
            if (value !== undefined) {
                store.set(key, value);
                imported = true;
            }
        }

        // 只有配置成功解析并至少导入一个允许字段后才删除，避免损坏文件导致配置丢失。
        if (imported) fs.unlinkSync(configPath);
    } catch (error) {
        console.error('[InstallConfig] import failed:', error?.message || error);
    }
}

importInstallConfig();
const {countdownState} = require('./main/countdown/state');
const {registerCountdownIpc} = require('./main/countdown/ipc');
const {processCountdownFromSchedule, pushCountdownItems} = require('./main/countdown/service');
const {showCountdownWindow, hideCountdownWindow} = require('./main/countdown/window');
const { OfflineCache } = require('./main/offline-cache');

// 初始化离线缓存
const offlineCache = new OfflineCache();



// 添加全局错误处理，防止未捕获的异常导致弹窗
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // 不显示错误弹窗，仅记录错误
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // 不显示错误弹窗，仅记录错误
});
let tray;
let form;
let win;
let template = []
// 统一资源路径解析，兼容 asar
const asset = (...p) => path.join(__dirname, ...p)

// ============================================================
// 自动客户端配置：把服务端下发的客户端配置规则应用到窗口与渲染进程
// （规则求值与调度细节见 main/clientConfig/，这里只做接线）
// ============================================================
const CLIENT_CONFIG_CHANNELS = {
    isDuringClassHidden: 'ClassHidden',
    isAlwaysMinimized: 'AlwaysMinimized',
    isDuringClassCountdown: 'ClassCountdown'
}

// 把生效值下发到渲染进程。页面未加载完时 webContents.send 会被静默丢弃，
// 必须抛错让调用方不要记账：clientConfig 一旦记下「已下发」，值不变时就永远不会重发，
// 渲染进程会永久停在默认值；带错误码是为了让调用方按预期/故障分级记录
function pushRendererSetting(channel, value) {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return
    if (win.webContents.isLoading()) {
        const notReady = new Error('renderer not ready for ' + channel)
        notReady.code = 'RENDERER_NOT_READY'
        throw notReady
    }
    win.webContents.send(channel, Boolean(value))
}

function applyClientConfigSetting(key, value, fromRule) {
    // 托盘勾选跟随「求值结果」，与 IPC 是否投递成功无关：先同步，
    // 避免窗口不可用或页面未就绪时的提前 return/throw 把它一起跳过
    syncTrayCheckbox(key, Boolean(value), fromRule)
    if (key === 'isWindowAlwaysOnTop') {
        if (win && !win.isDestroyed()) {
            if (value) win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
            else win.setAlwaysOnTop(false)
        }
        return
    }
    const channel = CLIENT_CONFIG_CHANNELS[key]
    if (channel) pushRendererSetting(channel, value)
}

// 托盘里的勾选状态跟随实际生效值；被自动任务接管的项置灰，避免用户误以为点了会生效
function syncTrayCheckbox(key, value, fromRule) {
    if (!form || typeof form.getMenuItemById !== 'function') return
    const item = form.getMenuItemById(key)
    if (!item) return
    if (item.checked !== value) item.checked = value
    if (item.enabled === fromRule) item.enabled = !fromRule
}

clientConfig.init({
    getLocalSetting: (key, fallback) => store.get(key, fallback),
    applySetting: applyClientConfigSetting
})

// JSONC 简易去注释
function stripJsonComments(str) {
    try {
        // 去掉块注释
        str = str.replaceAll(/\/\*[\s\S]*?\*\//g, '');
        // 去掉行注释（忽略字符串内 // 的复杂情况，这里假设用户配置较为简单）
        str = str.replaceAll(/^\s*\/\/.*$/gm, '');
        return str;
    } catch {
        return str
    }
}

// 仅读取用户配置（JSONC），不写回，避免破坏注释
function getUserConfigPath() {
    try {
        return path.join(app.getPath('userData'), 'scheduleConfig.user.jsonc')
    } catch (error) {
        // 只记录错误类别：路径与配置内容都不进日志
        console.warn('[Startup] Failed to resolve local user config path:', error?.code || error?.name || 'unknown error')
        return null
    }
}

function readUserConfigSafe() {
    try {
        const p = getUserConfigPath();
        if (!p) return null;
        if (!fs.existsSync(p)) return null;
        const raw = fs.readFileSync(p, 'utf-8');
        const cleaned = stripJsonComments(raw);
        try {
            return JSON.parse(cleaned)
        } catch (error) {
            // 区分"没有本地配置"与"本地配置坏了"：后者此前完全静默
            console.warn('[Startup] Failed to parse local user config:', error?.name || 'unknown error')
            return null
        }
    } catch (error) {
        console.warn('[Startup] Failed to read local user config:', error?.code || error?.name || 'unknown error')
        return null
    }
}

function doNothing(_) { /* 一些 dialog 会返回一个 promise 但并不需要处理 */ }

// 使用函数动态获取协议与服务器，避免缓存导致不一致
function getProtocols() {
    const secure = store.get('isSecureConnection', true)
    return { agreement: secure ? 'https' : 'http', agreementWs: secure ? 'wss' : 'ws' }
}
function getServer() {
    return String(store.get('server', 'class.getastra.cn'))
}

// 单次请求的超时上限：超时即按失败处理，交给调用方沿用既有重试策略。
// 没有它，半开连接会让「无响应」永远不收敛（天气请求中标志、兜底显示判定都会卡死）
const ASTRA_REQUEST_TIMEOUT_MS = 20000

// 统一 HTTP 请求，注入 User-Agent，不请求客户端证书（mTLS）
function astraRequest(options) {
    const https = require('node:https')
    const ua = `AstraSchedule/${app.getVersion()}`
    const url = typeof options === 'string' ? options : options.url
    const method = (typeof options === 'object' ? options.method : null) || 'GET'
    const headers = { 'User-Agent': ua, ...(typeof options === 'object' ? (options.headers || {}) : {}) }
    const parsed = new URL(url)
    const request = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        requestCert: false,
        rejectUnauthorized: true,
    })
    // 总时限必须从创建请求起算：request.setTimeout() 只在 socket 分配后才生效，
    // 连接建立阶段（DNS/TCP/TLS）卡住时它永远不会触发，请求会一直挂着
    const deadline = setTimeout(() => {
        request.destroy(new Error('astraRequest timeout'))
    }, ASTRA_REQUEST_TIMEOUT_MS)
    request.on('close', () => clearTimeout(deadline))
    return request
}
let classId = String(store.get("class", "39/2023/1"))
let isFromCloud = store.get('isFromCloud', false)
let lastScheduleConfig = null
// 当前画面配置的来源：'cloud'（云端）/ 'cache'（本地缓存）/ null（还没有可用配置）
let lastScheduleSource = null
console.log('Class:', classId, 'Server:', getServer(), 'Secure:', store.get("isSecureConnection", true), 'Cloud:', isFromCloud);

const countdownCtx = {
    BrowserWindow,
    screen,
    ipcMain,
    net: electron.net,
    state: countdownState,
    getClassId: () => classId,
};

const COUNTDOWN_STARTUP_RETRY_DELAY_MS = 8000;

function clearCountdownStartupRetryTimer() {
    if (countdownState.startupRetryTimer) {
        clearTimeout(countdownState.startupRetryTimer);
        countdownState.startupRetryTimer = null;
    }
}

function scheduleCountdownStartupRetry(reason = 'unknown') {
    if (countdownState.firstSuccessLocked) return;
    if (countdownState.startupRetryTimer) return;
    countdownState.startupRetryTimer = setTimeout(() => {
        countdownState.startupRetryTimer = null;
        refreshCountdownWindow('startup-retry').catch(() => {
        });
    }, COUNTDOWN_STARTUP_RETRY_DELAY_MS);
    console.warn(`[Countdown] schedule startup retry in ${COUNTDOWN_STARTUP_RETRY_DELAY_MS}ms by ${reason}`);
}

async function refreshCountdownWindow(reason = 'manual') {
    if (countdownState.firstSuccessLocked) {
        // 首次成功后保持当前显示状态，不再触发刷新/隐藏逻辑
        return;
    }
    if (countdownState.startupBehavior === 'stay') {
        hideCountdownWindow(countdownState);
        return;
    }
    if (countdownState.loading) return;
    countdownState.loading = true;
    try {
        const records = countdownState.scheduleCountdownRecords || [];
        const classId = countdownCtx.getClassId();
        const result = processCountdownFromSchedule(records, classId);
        if (result?.loading) {
            countdownState.latestItems = [];
            hideCountdownWindow(countdownState);
            scheduleCountdownStartupRetry(`${reason}-loading`);
            console.log(`[Countdown] hidden by ${reason}: backend loading`);
            return;
        }

        const items = Array.isArray(result?.items) ? result.items : [];
        if (items.length === 0) {
            countdownState.latestItems = [];
            clearCountdownStartupRetryTimer()
            hideCountdownWindow(countdownState);
            console.log(`[Countdown] hidden by ${reason}: empty items from backend`);
            return;
        }

        countdownState.latestItems = items;
        const cwin = showCountdownWindow(countdownCtx);
        if (cwin && !cwin.isDestroyed() && cwin.webContents && !cwin.webContents.isDestroyed()) {
            if (cwin.webContents.isLoading()) {
                cwin.webContents.once('did-finish-load', () => {
                    pushCountdownItems(countdownState);
                });
            } else {
                pushCountdownItems(countdownState);
            }
        }
        countdownState.firstSuccessLocked = true;
        clearCountdownStartupRetryTimer();
        if (countdownState.pollTimer) {
            clearInterval(countdownState.pollTimer);
            countdownState.pollTimer = null;
        }
        console.log('[Countdown] first success reached, lock display state and stop further refresh triggers');
        console.log(`[Countdown] refreshed by ${reason}, items=${items.length}`);
    } catch (e) {
        console.error('[Countdown] refresh failed:', e?.message || e);
        countdownState.latestItems = [];
        hideCountdownWindow(countdownState);
        scheduleCountdownStartupRetry(`${reason}-error`);
        console.warn(`[Countdown] hidden by ${reason}: request failed`);
    } finally {
        countdownState.loading = false;
    }
}
const WebSocket = require('ws');
let ws;
let heartbeatTimer = null;
let reconnectTimer = null;

function clearHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
}

let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // 最大重连延迟30秒
const INITIAL_RECONNECT_DELAY = 1000; // 初始重连延迟1秒

function scheduleReconnect() {
    // 检查是否禁用了 WebSocket 连接
    if (ws?.disableReconnect) {
        console.log('WebSocket reconnection is disabled, not reconnecting');
        return;
    }

    // error 与 close 会先后触发，已有重连计划时不再重复排程：
    // 重复排程会让每轮失败多加一次计数，退避节奏被打乱
    if (reconnectTimer) {
        console.log('WebSocket reconnect already scheduled, skip duplicate');
        return;
    }

    // 指数退避算法，最大延迟30秒
    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;

    console.log(`WebSocket will reconnect in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // 不在此处重置 reconnectAttempts：指数退避需要在连续失败之间累积，
        // 归零只发生在连接成功（ws.on('open')）时，否则延迟会永远停在 1 秒
        connect();
    }, delay);
}

// 在主进程中直接更新 Tray Tooltip 的辅助函数
let websocketDisabled = false; // 全局标志，表示 WebSocket 是否被禁用
let currentConnectionState = false; // 全局标志，记录当前连接状态

// 云端不可用时，在托盘提示里说明当前画面的数据来源。
// 离线标志不再画在窗口里，状态统一在托盘图标悬停提示中体现。
// 注意：只有真的取了缓存才能说「数据来源: 本地离线缓存」，否则会误导排查方向。
function offlineTraySuffix() {
    if (!offlineCache.getOfflineStatus().isOffline) return '';
    if (lastScheduleSource === 'cache') return '\n数据来源: 本地离线缓存（云端暂不可用）';
    if (lastScheduleSource === 'cloud') return '\n云端暂不可用（显示上次成功获取的配置）';
    return '\n云端暂不可用，且无可用缓存';
}

function updateTrayTooltip(connected, forceGreen) {
    // 无论 tray 是否存在，都更新全局状态
    currentConnectionState = connected;
    websocketDisabled = forceGreen || false;

    if (!tray) return;

    const baseTooltip = `星程 - by KuoHu - ${app.getVersion()}`;

    let statusText;
    if (forceGreen) {
        statusText = '在线 (Serverless)';
    } else {
        statusText = connected ? '在线' : '离线';
    }

    const tooltipText = `${baseTooltip} - 状态: ${statusText}${offlineTraySuffix()}`;

    tray.setToolTip(tooltipText);
    console.log('[Main] Tray tooltip updated to:', tooltipText);
}

// 离线状态一变化就刷新托盘提示，无需等下一次连接状态变化
offlineCache.onStatusChange = () => {
    if (tray) updateTrayTooltip(currentConnectionState, websocketDisabled);
}

// 断开 WebSocket 连接并停止重连机制
function disconnectWebSocket() {
    if (ws) {
        // 设置标志，阻止进一步的重连尝试
        ws.disableReconnect = true;

        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        } catch (e) {
            console.error('Error closing WebSocket:', e);
        }

        // 清除重连定时器
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // 清除心跳定时器
        clearHeartbeat();

        // 通知渲染进程连接已断开，但保持绿色显示
        if (win && !win.isDestroyed()) {
            win.webContents.send('ws-status', {connected: false, forceGreen: true});
            // 同时更新tray tooltip
            win.webContents.send('update-tray-status', {connected: false, forceGreen: true});
        }

        // 直接在主进程中更新 Tooltip
        updateTrayTooltip(false, true);

        console.log('WebSocket disconnected and reconnection disabled');
    }
}

function connect(rejectUnauthorized = true) {
    const { agreementWs } = getProtocols()
    const server = getServer()
    const url = `${agreementWs}://${server}/ws/${classId}`

    try {
        // 关闭旧连接与心跳
        try {
            if (ws) {
                ws.removeAllListeners();
                ws.close();
            }
        } catch {
        }
        clearHeartbeat()
        ws = new WebSocket(url, [], {rejectUnauthorized})
        // 为WebSocket实例添加错误监听器，确保任何错误都不会导致弹窗
        // 重要：必须在WebSocket实例创建后立即添加错误监听器，以捕获所有错误
        ws.on('error', (error) => {
            console.error('WebSocket error:', error)
            clearHeartbeat()
            // 通知渲染进程连接已断开
            if (win && !win.isDestroyed()) {
                win.webContents.send('ws-status', {connected: false});
                // 同时更新tray tooltip
                win.webContents.send('update-tray-status', {connected: false});
            }

            // 直接在主进程中更新 Tooltip
            updateTrayTooltip(false, websocketDisabled);

            // 安全修复：不再降级为“不验证证书”重连（fail-open）。
            // 证书验证失败时按正常策略重连，保持 TLS 证书校验，防止中间人（MITM）攻击
            scheduleReconnect();
        })
    } catch (err) {
        console.error('WebSocket create error:', err)
        // 不显示错误弹窗，仅重连
        scheduleReconnect();
        return
    }


    ws.on('open', () => {
        console.log('Connected to server')
        clearHeartbeat()
        reconnectAttempts = 0; // 连接成功，重置重连计数
        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.ping()
                } catch (e) {
                    console.log('Heartbeat ping failed:', e?.message || e)
                }
                console.log('Heartbeat sent')
            } else {
                console.log('Disconnected from server, No heartbeat sent')
            }
        }, 25000)

        // 重连成功后，主动拉取一次课表，避免丢失推送
        try {
            getScheduleFromCloud()
        } catch (e) {
            console.error('Failed to get schedule after reconnect:', e)
        }
        // 通知渲染进程连接已恢复
        if (win && !win.isDestroyed()) {
            // 检查是否应保持 WebSocket 禁用状态
            const forceGreen = websocketDisabled;
            win.webContents.send('ws-status', {connected: true, forceGreen: forceGreen});
            // 同时更新tray tooltip
            win.webContents.send('update-tray-status', {connected: true, forceGreen: forceGreen});
        }

        // 直接在主进程中更新 Tooltip
        updateTrayTooltip(true, websocketDisabled);
    })
    // 处理接收到的消息
    ws.on('message', (message) => {
        const text = message?.toString?.() ?? ''
        console.log('Received from server:', text)
        if (text === 'SyncConfig') {
            console.log('SyncConfig')
            getScheduleFromCloud()
            refreshCountdownWindow('ws-sync').catch(() => {
            })
        }
    })
    // 处理连接关闭
    ws.on('close', (code, reason) => {
        console.log(`WebSocket disconnected (code: ${code}, reason: ${reason})`)
        clearHeartbeat()
        // 通知渲染进程连接已断开
        if (win && !win.isDestroyed()) {
            // 只有在 WebSocket 被禁用的情况下才强制绿色
            win.webContents.send('ws-status', {connected: false, forceGreen: websocketDisabled});
            // 同时更新tray tooltip
            win.webContents.send('update-tray-status', {connected: false, forceGreen: websocketDisabled});
        }

        // 直接在主进程中更新 Tooltip
        updateTrayTooltip(false, websocketDisabled);
        // 无条件进行重连，不区分关闭原因
        scheduleReconnect();

    })
}

// 启动时不立即连接 WebSocket，延迟到第一次获取课表数据后
// connect(); 已移除，改为在 getScheduleFromCloud() 后根据 supportWebSocket 判断

// 防止多开
const gotTheLock = app.requestSingleInstanceLock({ key: 'classSchedule' })
if (!gotTheLock) {
    app.quit();
}
app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
    }
})

// 正确禁用缓存的开关名
app.commandLine.appendSwitch('disable-http-cache');

const createWindow = () => {
    // noinspection JSCheckFunctionSignatures
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: 200,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: store.get('isWindowAlwaysOnTop', true),
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        resizable: false,
        type: 'toolbar',
        webPreferences: {
            preload: path.join(__dirname, 'main', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    })
    // win.webContents.openDevTools()
    // noinspection JSIgnoredPromiseFromCall
    win.loadFile('index.html')
    if (store.get('isWindowAlwaysOnTop', true))
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
}

let hasShownWindow = false
function showMainWindow() {
    console.log('[Startup] showMainWindow called, hasShownWindow:', hasShownWindow)
    if (hasShownWindow || !win || win.isDestroyed()) return
    hasShownWindow = true
    win.webContents.send('showMainWindow')
}

// 拿到第一份配置后按 startup_behavior 决定窗口行为，云端配置与本地缓存共用。
// 返回 true 表示已安排退出应用，调用方不应再继续刷新其它窗口。
function applyStartupBehavior(config, source) {
    if (!isFromCloud) return false
    const startupBehavior = config?.startup_behavior || 'normal'
    countdownState.startupBehavior = startupBehavior
    console.log(`[Startup] startup_behavior=${startupBehavior} (${source})`)
    if (startupBehavior === 'exit') {
        console.log('[Startup] startup_behavior is exit, quitting app...')
        app.quit()
        return true
    }
    if (startupBehavior === 'normal') {
        showMainWindow()
    } else if (startupBehavior === 'stay' && win && !win.isDestroyed()) {
        win.hide()
    }
    return false
}

function setAutoLaunch() {
    const shortcutName = '星程(请勿重命名).lnk'
    app.setLoginItemSettings({ // backward compatible
        openAtLogin: false,
        openAsHidden: false
    })
    if (store.get('isAutoLaunch', true)) {
        createShortcut.create(startupFolderPath + '/' + shortcutName,
            {
                target: app.getPath('exe'),
                workingDir: app.getPath('exe').split('\\').slice(0, -1).join('\\'),
            }, (e) => { e && console.log(e); })
    } else {
        fs.unlink(startupFolderPath + '/' + shortcutName, () => { })
    }

}

// 简单 semver 校验（x.y.z，可带 -/+ 后缀）
function isSemver(v) {
    return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(v || ''))
}

// 是否为 Windows 10 或更高版本。Node 在 Windows 上 os.release() 返回内核版本：
// Win10/Win11 均为 10.x，Win8.1 为 6.3，Win7 为 6.1。新版本 Electron 只支持 Win10+，
// 分叉构建据此判断是否可以切换到 Win10+ 更新通道。
function isWindows10OrNewer() {
    if (process.platform !== 'win32') return false
    const major = Number.parseInt(String(os.release()).split('.')[0], 10)
    return Number.isFinite(major) && major >= 10
}

// 当前系统能否运行 x64 安装包（Win10+ 通道是 x64 构建）。当前发布的客户端是 ia32，
// 运行在 64 位 Windows 上时环境变量 PROCESSOR_ARCHITEW6432 为 AMD64；32 位 Windows 上不存在该变量。
// ARM64 的 Windows 10 没有 x64 模拟，保守处理：不切换通道，继续留在 ia32 兼容构建。
function canRunX64Build() {
    if (process.platform !== 'win32') return false
    if (process.arch === 'x64') return true
    return String(process.env.PROCESSOR_ARCHITEW6432 || '') === 'AMD64'
}

// 默认更新源地址（latest.yml / win10.yml 与安装包所在目录）- 适配 GitHub 最新发布路径
const DEFAULT_UPDATE_MIRROR = 'https://hubproxy.khbit.cn/https://github.com/daizihan233/AstraSchedule/releases/latest/download'
// 分叉构建的两个更新通道：两个构建共用同一个 release 与版本号，只是元数据文件名不同
// - 默认通道 latest.yml：Win7/8.1 兼容构建（旧版 Electron）
// - Win10+ 通道 win10.yml：新版本 Electron 构建
const WIN10_UPDATE_CHANNEL = 'win10'

// 自动更新设置（仅打包且版本为 semver 时生效）
let updaterInitialized = false
function setupAutoUpdater() {
    try {
        if (!store.get('isAutoUpdate', true)) {
            console.log('[Updater] disabled by user setting');
            return;
        }
        if (!app.isPackaged) return;
        const v = app.getVersion();
        if (!isSemver(v)) {
            console.warn('[Updater] disabled due to non-semver version:', v)
            return;
        }
        if (updaterInitialized) return
        const { autoUpdater } = require('electron-updater')
        let updateBaseUrl = store.get('updateBaseUrl')
        let usingDefaultSource = false
        if (!updateBaseUrl || typeof updateBaseUrl !== 'string' || updateBaseUrl.trim().length === 0) {
            updateBaseUrl = DEFAULT_UPDATE_MIRROR
            store.set('updateBaseUrl', updateBaseUrl)
            usingDefaultSource = true
        } else {
            usingDefaultSource = updateBaseUrl.trim() === DEFAULT_UPDATE_MIRROR
        }
        autoUpdater.setFeedURL({ provider: 'generic', url: updateBaseUrl.trim() })
        // 分叉构建：仍在使用默认更新源、且当前系统为 Win10+ 并能运行 x64 安装包时，
        // 切换到 Win10+ 通道（同一下载目录下的 win10.yml），让用户升级到新依赖的构建而不是
        // 一直停留在 Win7 兼容版。32 位系统装不了 x64 包，必须留在 ia32 通道（CodeRabbit 意见 #2）。
        // 用户自行配置过更新源时不干预，每次启动重新判定，因此不持久化通道选择。
        if (usingDefaultSource && isWindows10OrNewer() && canRunX64Build()) {
            console.log('[Updater] Windows 10+ x64-capable detected, switching to win10+ update channel')
            autoUpdater.channel = WIN10_UPDATE_CHANNEL
            // electron-updater 的 channel 赋值会把 allowDowngrade 置为 true（AppUpdater.js），
            // 显式关闭：通道元数据滞后或代理返回旧 win10.yml 时不允许自动降级（CodeRabbit 意见 #3）
            autoUpdater.allowDowngrade = false
        }
        autoUpdater.autoDownload = true
        autoUpdater.autoInstallOnAppQuit = true
        autoUpdater.allowPrerelease = true
        autoUpdater.on('checking-for-update', () => console.log('[Updater] checking-for-update'))
        autoUpdater.on('update-available', (info) => {
            console.log('[Updater] update-available', info?.version)
            tray?.setToolTip(`星程 - 正在下载更新 ${info?.version || ''}`)
        })
        autoUpdater.on('update-not-available', () => console.log('[Updater] update-not-available'))
        autoUpdater.on('error', (err) => console.error('[Updater] error', err))
        autoUpdater.on('download-progress', (p) => {
            const percent = Math.floor(p.percent || 0)
            tray?.setToolTip(`星程 - 更新下载中 ${percent}%`)
        })
        autoUpdater.on('update-downloaded', () => {
            tray?.setToolTip(`星程 - 更新可用`)
            autoUpdater.quitAndInstall(true, true)
        })
        // 仅启动时检查一次
        const check = () => autoUpdater.checkForUpdates().catch(() => {})
        setTimeout(check, 3000)
        updaterInitialized = true
    } catch (e) {
        console.error('[Updater] setup failed', e)
    }
}

// 课表数据版本号（数值），仅用于判断版本是否推进，避免回退的旧配置覆盖新配置
let currentVersion = 0;
// 回传给服务端的版本令牌：服务端下发的是 "<数据版本>:<周次>[:<boundary>]" 复合串
// （见 usr-backend 的 scheduleVersion），必须原样回传才能命中 304。
// 服务端按不透明串解析，只回传数据版本会被判为旧客户端——week 记为 0，
// 条件永不成立，于是每次都返回全量配置。
let currentVersionToken = '0';
// 标志：是否已经进行过第一次课表数据获取和 WebSocket 初始化
let hasInitializedWebSocket = false;

// 检查网络连接
function checkNetworkConnection() {
    return new Promise((resolve) => {
        const {agreement} = getProtocols()
        const server = getServer()

        // 尝试连接到服务器的根路径（轻量级检查）
        const request = astraRequest({
            method: 'GET',
            url: `${agreement}://${server}/`
        })

        let isResolved = false

        request.on('response', (response) => {
            if (!isResolved) {
                isResolved = true
                console.log('[Network] Connection check successful, status:', response.statusCode)
                resolve(true)
            }
        })

        request.on('error', (err) => {
            if (!isResolved) {
                isResolved = true
                console.error('[Network] Connection check failed:', err?.message || err)
                resolve(false)
            }
        })

        request.on('abort', () => {
            if (!isResolved) {
                isResolved = true
                console.warn('[Network] Connection check aborted')
                resolve(false)
            }
        })

        // 5 秒超时后强制返回 false
        setTimeout(() => {
            if (!isResolved) {
                isResolved = true
                console.warn('[Network] Connection check timeout')
                request.abort()
                resolve(false)
            }
        }, 5000)

        request.end()
    })
}

// 云端不可用时回落到本地缓存。只在还没有任何可用配置时才使用
// （冷启动、或首次拉取就失败），避免用旧缓存覆盖正在显示的课表。
function loadScheduleFromCache(reason) {
    if (lastScheduleConfig) return false
    if (!offlineCache.hasCachedData()) {
        console.log(`[OfflineCache] No cached schedule to fall back to (${reason})`)
        return false
    }
    const cachedData = offlineCache.loadFromCache()
    if (!cachedData?.data) {
        console.warn(`[OfflineCache] Cached schedule is unreadable (${reason})`)
        return false
    }

    // 先落来源再改离线状态：setOfflineStatus 会在状态变化时同步触发托盘刷新，
    // 顺序反了那次刷新会读到旧的 lastScheduleSource，提示就变成上一句
    lastScheduleSource = 'cache'
    offlineCache.setOfflineStatus(true)
    lastScheduleConfig = cachedData.data
    countdownState.scheduleCountdownRecords = Array.isArray(cachedData.data.countdown_records)
        ? cachedData.data.countdown_records
        : []
    if (win && !win.isDestroyed()) win.webContents.send('newConfig', cachedData.data)
    // 自动客户端配置规则同样要生效（与云端成功路径一致），否则离线启动时
    // 窗口置顶/上课隐藏/始终缩小/课上倒计时整套规则失效，静默退回本地设置。
    // 规则只驱动窗口与托盘行为、不触发课表拉取，因此不会构成配置下发的自激回路。
    clientConfig.updateFromSchedule(cachedData.data)
    console.log(`[OfflineCache] Loaded schedule from cache (${reason})`)

    if (applyStartupBehavior(cachedData.data, 'cache')) return true
    refreshCountdownWindow('offline-cache').catch(() => {
    })
    return true
}

// 重试获取课表数据的辅助函数
async function getScheduleFromCloudWithRetry(maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
        const connected = await checkNetworkConnection()
        if (connected) {
            console.log(`[Network] Attempt ${i + 1}/${maxRetries}: Network connected, fetching schedule...`)
            getScheduleFromCloud()
            return true
        } else {
            console.warn(`[Network] Attempt ${i + 1}/${maxRetries}: Network not available`)
            if (i < maxRetries - 1) {
                console.log(`[Network] Retrying in 2 seconds...`)
                await new Promise(resolve => setTimeout(resolve, 2000))
            }
        }
    }
    console.error('[Network] Failed to establish network connection after', maxRetries, 'attempts')

    // 尝试从本地缓存加载课表数据（离线模式）
    if (loadScheduleFromCache('network-unreachable')) {
        return false
    }

    // 连续探测失败且没有缓存可用：这才是「云端确定不可用」，告知渲染进程可按本地配置兜底。
    // 不能用首次请求失败当信号：那时重试仍在排队，窗口会过早显示占位内容
    if (win && !win.isDestroyed()) win.webContents.send('scheduleUnavailable')

    // 即使没有缓存数据，也继续尝试获取课表（可能在移动网络等不稳定情况下）
    console.log('[Network] No cached data available, proceeding with schedule fetch despite network check failure')
    getScheduleFromCloud()
    return false
}

// 课表拉取并发控制：记录最新一次请求的序号。托盘连点 / WS 推送 / 自动刷新 / 失败重试
// 可能并发触发，响应到达时只允许最新请求生效，过期响应直接丢弃，防止旧配置覆盖新配置
let scheduleFetchSeq = 0

// 课表拉取失败重试的退避参数：服务端异常或离线时避免长期按固定间隔高频重试
const SCHEDULE_RETRY_BASE_DELAY_MS = 5000
const SCHEDULE_RETRY_MAX_DELAY_MS = 60000
// 边缘节点（CDN/WAF，如阿里云 ESA）的频次控制规则按来源 IP 封禁，本站配置的封禁时长为 1 小时。
// 官方文档只说明"拦截封禁 10 秒–24 小时"，未说明封禁期间的新请求是否会重置计时，
// 因此退避间隔必须最终超过封禁时长：即便边缘实现是"每次命中就重新计时"，
// 客户端也不会把自己续成永久封禁（间隔 4 小时 > 封禁 1 小时，中间始终有可用窗口）。
// 序列 1m → 4m → 16m → 64m → 4h → 4h…：1 小时内只探测 3 次，
// 配置的 1 小时封禁若已到期，最迟在 64 分钟那次就能恢复
const EDGE_BLOCK_RETRY_DELAY_MS = 60000
const EDGE_BLOCK_RETRY_FACTOR = 4
const EDGE_BLOCK_MAX_RETRY_DELAY_MS = 14400000
let scheduleRetryDelayMs = SCHEDULE_RETRY_BASE_DELAY_MS
// 当前是否处于边缘限流状态；非 0 时走上面那条更长的独立退避序列
let edgeBlockRetryDelayMs = 0

// 识别边缘节点（CDN/WAF）的拦截响应，例如阿里云 ESA 限流：
// X-Tengine-Error: denied by http_ratelimit。
// 只认这个响应头：它是边缘节点自己生成拦截页的确定性标志，而 Server: ESA
// 在正常经过 ESA 的响应上也会出现，用它判断会把应用自身的 4xx 误判成限流。
// 只记录该响应头（基础设施信息），不落响应体，避免把服务端内容写进日志。
function edgeBlockReason(response) {
    return String(response.headers?.['x-tengine-error'] || '')
}

// 服务端恢复可达后把两条退避序列都复位
function resetScheduleRetryBackoff() {
    scheduleRetryDelayMs = SCHEDULE_RETRY_BASE_DELAY_MS
    edgeBlockRetryDelayMs = 0
}

// 计算下一次重试的间隔：边缘限流走独立的更长序列，其它失败走普通退避
function nextScheduleRetryDelay() {
    if (edgeBlockRetryDelayMs) return edgeBlockRetryDelayMs
    const delay = scheduleRetryDelayMs
    scheduleRetryDelayMs = Math.min(delay * 2, SCHEDULE_RETRY_MAX_DELAY_MS)
    return delay
}

// 仅最新请求允许安排重试；被替代的请求不得发起后续请求（调度时与执行时双重校验）
function scheduleFetchRetry(mySeq) {
    if (mySeq !== scheduleFetchSeq) return
    const delay = nextScheduleRetryDelay()
    // 把实际退避间隔写进日志：边缘限流时会拉长到分钟/小时级，便于判断是被封还是真离线
    console.log(`[Schedule] Next retry in ${Math.round(delay / 1000)}s`)
    setTimeout(() => {
        if (mySeq === scheduleFetchSeq) {
            getScheduleFromCloud()
        }
    }, delay)
}

function getScheduleFromCloud() {
    const { agreement } = getProtocols()
    // 添加 version 查询参数
    const url = `${agreement}://${getServer()}/${classId}?version=${encodeURIComponent(currentVersionToken)}`
    console.log('Requesting schedule from cloud:', url);

    // 本次请求的序号，响应到达时校验是否仍为最新请求
    const mySeq = ++scheduleFetchSeq

    // noinspection JSCheckFunctionSignatures
    const request = astraRequest({
        method: 'GET',
        url: url
    })
    let raw = ''
    request.on('response', (response) => {
        const statusCode = response.statusCode;
        console.log('getScheduleFromCloud response status:', statusCode);

        // 已被更新请求取代的响应不得改动共享状态（离线标记、边缘限流退避）。
        // 下面 end 里还有一道检查，两者覆盖不同的竞态窗口：这里防的是"响应头已到、
        // 期间又发起了新请求"，那里防的是"读响应体期间被取代"
        if (mySeq !== scheduleFetchSeq) {
            console.warn('[Schedule] Discard stale response before handling: superseded by a newer request')
            response.resume()
            return;
        }

        // 处理 304 状态码
        if (statusCode === 304) {
            console.log('Schedule not modified (304), no action taken');
            // 能拿到 304 说明服务端可达：离线状态与失败退避都要复位，
            // 否则「离线期间服务端无改动 → 恢复后首个请求命中 304」会让客户端一直显示离线
            offlineCache.setOfflineStatus(false)
            resetScheduleRetryBackoff()
            return;
        }

        if (statusCode < 200 || statusCode >= 300) {
            const edgeBlock = edgeBlockReason(response)
            if (edgeBlock) {
                console.error(`getScheduleFromCloud blocked by edge node: status=${statusCode}, ${edgeBlock}`)
                edgeBlockRetryDelayMs = edgeBlockRetryDelayMs
                    ? Math.min(edgeBlockRetryDelayMs * EDGE_BLOCK_RETRY_FACTOR, EDGE_BLOCK_MAX_RETRY_DELAY_MS)
                    : EDGE_BLOCK_RETRY_DELAY_MS
            } else {
                console.error('getScheduleFromCloud request failed with status:', statusCode);
                // 不是边缘拦截了：说明边缘限流已解除，回到普通退避序列，
                // 否则会继续按分钟/小时级退避，服务端恢复后也要很久才重试
                edgeBlockRetryDelayMs = 0
            }
            // 403（限流）等非 2xx 同样属于云端不可用：冷启动时必须回落到本地缓存，
            // 否则课表会一直空着（原先只有「连不上主机」才会用缓存）
            loadScheduleFromCache(`http-${statusCode}`)
            offlineCache.setOfflineStatus(true)
            scheduleFetchRetry(mySeq)
            return;
        }

        // 按流编码解码：多字节字符（中文课程名）可能被分片切断，
        // 逐块 toString() 会把断开的半个字符解成 U+FFFD（乱码方块）
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
            raw += chunk
        })
        response.on('end', () => {
            try {
                const scheduleConfigSync = JSON.parse(raw)
                if (mySeq !== scheduleFetchSeq) {
                    console.warn('[Schedule] Discard stale response: superseded by a newer request')
                    return
                }
                // 服务端可达，重置失败重试退避（含边缘限流的独立序列）
                resetScheduleRetryBackoff()

                // 检查返回的 JSON 中是否含有 version 键
                if (scheduleConfigSync.version !== undefined) {
                    // 回传令牌原样保留（含周次与 boundary），不要把数值比较用的 currentVersion 当令牌发出去
                    currentVersionToken = String(scheduleConfigSync.version)
                    const newVersion = Number.parseInt(scheduleConfigSync.version);
                    if (!Number.isNaN(newVersion) && newVersion > currentVersion) {
                        currentVersion = newVersion;
                        console.log('Updated version to:', currentVersion);
                    }
                }

                // 检查是否含有 supportWebSocket 键
                const supportWebSocket = scheduleConfigSync["supportWebSocket"] !== undefined ?
                    Boolean(scheduleConfigSync["supportWebSocket"]) : true;

                console.log(`[WebSocket] supportWebSocket=${supportWebSocket}, hasInitialized=${hasInitializedWebSocket}`);

                // 根据 supportWebSocket 值决定是否连接 WebSocket
                websocketDisabled = !supportWebSocket; // 更新全局状态

                if (!supportWebSocket) {
                    // 如果不支持 WebSocket，则断开现有连接并停止重连机制
                    console.log('[WebSocket] Server does not support WebSocket, disconnecting...');
                    disconnectWebSocket();
                    // 无论如何都要更新 Tooltip 状态，确保 Serverless 提示正确显示
                    updateTrayTooltip(false, true);
                } else if (!hasInitializedWebSocket || !ws || ws.readyState !== WebSocket.OPEN) {
                    console.log('[WebSocket] Server supports WebSocket, connecting...');
                    if (!hasInitializedWebSocket) {
                        hasInitializedWebSocket = true;
                    }
                    connect();
                }

                // 缓存倒数日数据，供 countdown 窗口使用
                countdownState.scheduleCountdownRecords = Array.isArray(scheduleConfigSync.countdown_records)
                    ? scheduleConfigSync.countdown_records
                    : [];

                if (win && !win.isDestroyed()) win.webContents.send('newConfig', scheduleConfigSync)
                lastScheduleConfig = scheduleConfigSync
                lastScheduleSource = 'cloud'
                // 自动客户端配置：规则与时间基准随课表配置一起下发
                clientConfig.updateFromSchedule(scheduleConfigSync)

                // 保存到本地缓存（离线模式支持）
                offlineCache.saveToCache(scheduleConfigSync, scheduleConfigSync.version || currentVersionToken)
                offlineCache.setOfflineStatus(false)

                // 根据 startup_behavior 决定窗口行为
                if (applyStartupBehavior(scheduleConfigSync, 'cloud')) {
                    return
                }

                refreshCountdownWindow('schedule-sync').catch(() => {
                })
            } catch (err) {
                console.error('getScheduleFromCloud JSON parse error:', err)
                // 不显示错误弹窗，仅记录错误
            }
            console.log('No more data in response.')
        })
    })
    request.on('error', (err) => {
        // 已被更新请求取代的失败不得改动离线状态、也不推进重试：
        // 过期的请求 A 出错时若请求 B 已成功，A 会把离线标记重新点亮
        if (mySeq !== scheduleFetchSeq) {
            console.warn('[Schedule] Discard stale request error: superseded by a newer request')
            return
        }
        console.error('getScheduleFromCloud request error:', err)
        // 连接层错误不是边缘拦截的判据，同样回到普通退避序列
        edgeBlockRetryDelayMs = 0
        loadScheduleFromCache('request-error')
        offlineCache.setOfflineStatus(true)
        // 不显示错误弹窗，仅记录错误
        scheduleFetchRetry(mySeq)
    })
    request.end()
}
const { startAeroMonitoring, stopAeroMonitoring } = require('./main/aeroCheck');

app.whenReady().then(() => {
    if (startAeroMonitoring()) {
        // Aero 检查失败，app.quit() 已调用，直接返回
        return;
    }
    createWindow()
    Menu.setApplicationMenu(null)
    registerCountdownIpc(countdownCtx)
    setupAutoUpdater()
    // 先进行网络连接检查，然后获取课表数据
    getScheduleFromCloudWithRetry().then(() => {});
    refreshCountdownWindow('startup').catch(() => {
    })
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('getWeekIndex');
        if (lastScheduleConfig) {
            win.webContents.send('newConfig', lastScheduleConfig)
        }
        // 页面默认 display:none，只有收到 showMainWindow 才显示；
        // 首次拉取（尤其是离线回落到缓存）可能早于渲染进程注册监听，这里补发一次
        if (hasShownWindow) {
            win.webContents.send('showMainWindow')
        }
    })
    // 自动客户端配置（上课隐藏/始终缩小/上课倒计时/窗口置顶）同样只在首次拉取时下发一次，
    // 早于页面就绪的那次会被丢弃且不会重试（值没变即跳过），这里按当前生效值强制重推。
    // 必须挂 did-stop-loading：did-finish-load 触发时 webContents.isLoading() 仍为 true，
    // 挂那里会被「渲染进程未就绪」挡掉，只能退回 20s tick 兜底
    win.webContents.on('did-stop-loading', () => {
        clientConfig.recompute(true)
    })
    // powerMonitor 事件无 preventDefault
    electron.powerMonitor.on('suspend', () => {
        app.quit()
    })
    electron.powerMonitor.on('shutdown', () => {
        app.quit()
    })
    setAutoLaunch()
})

app.on('before-quit', () => {
    clientConfig.dispose()
    stopAeroMonitoring()
    clearCountdownStartupRetryTimer()
    if (countdownState.pollTimer) {
        clearInterval(countdownState.pollTimer)
        countdownState.pollTimer = null
    }
})



// 仅提供读取用户配置的 IPC
ipcMain.handle('readUserConfig', () => readUserConfigSafe())
ipcMain.handle('getUserConfigPath', () => getUserConfigPath())

// 离线模式相关 IPC
ipcMain.handle('getOfflineStatus', () => offlineCache.getOfflineStatus())
ipcMain.handle('getCachedVersions', () => offlineCache.getCachedVersions())
ipcMain.handle('getCacheStats', () => offlineCache.getCacheStats())
ipcMain.handle('loadCachedSchedule', (e, version) => {
    const cachedData = offlineCache.loadFromCache(version)
    if (cachedData?.data) {
        return cachedData?.data || null
    }
})

ipcMain.on('getWeekIndex', (e, arg) => {
    // 销毁旧的 Tray 实例，避免重复创建和状态丢失
    if (tray) {
        try {
            tray.destroy();
        } catch (err) {
            console.error('Failed to destroy tray:', err);
        }
    }
    tray = new Tray(asset('image', store.get('trayIcon', 'icon') + '.png'))
    // 立即按当前状态初始化提示：离线启动时不会有 WS 事件来触发刷新，
    // 而离线判定往往早于托盘创建，onStatusChange 那次刷新会被 tray 为空挡掉
    updateTrayTooltip(currentConnectionState, websocketDisabled)
    template = [
        {
            label: '连接云端',
            type: 'checkbox',
            checked: store.get('isFromCloud', false),
            click: (e) => {
                store.set('isFromCloud', e.checked)
                isFromCloud = e.checked
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '更新源(可选)',
            click: () => {
                const current = store.get('updateBaseUrl', '') || ''
                prompt({
                    title: '更新源(可选)',
                    label: '请输入更新源基础地址(需包含 latest.yml 的目录，如 https://your.cdn.com/app)：',
                    value: current,
                    inputAttrs: { type: 'string' },
                    type: 'input',
                    height: 220,
                    width: 520,
                    icon: asset('image', 'toggle.png'),
                }).then((r) => {
                    if (r === null) {
                        console.log('[Updater] Mirror cancelled')
                    } else {
                        store.set('updateBaseUrl', r.toString())
                        dialog.showMessageBox(win, {message: '更新源已保存，重启应用后生效。'}).then(doNothing)
                    }
                })
            }
        },
        {
            label: '检查更新',
            click: () => {
                if (!app.isPackaged) {
                    dialog.showMessageBox(win, { message: '开发模式下不检查更新。' }).then(doNothing)
                    return
                }
                if (!isSemver(app.getVersion())) {
                    dialog.showMessageBox(win, { message: '当前版本号非语义化版本，已禁用自动更新。' }).then(doNothing)
                    return
                }
                setupAutoUpdater()
                // 按需加载再调用
                const { autoUpdater } = require('electron-updater')
                autoUpdater.checkForUpdates().catch((err) => {
                    console.error('[Updater] manual check failed', err)
                    dialog.showMessageBox(win, { type: 'error', message: '检查更新失败，请稍后再试。' }).then(doNothing)
                })
            }
        },
        {
            label: '自动更新',
            type: 'checkbox',
            checked: store.get('isAutoUpdate', true),
            click: (e) => {
                store.set('isAutoUpdate', e.checked)
                if (e.checked) {
                    setupAutoUpdater()
                } else {
                    console.log('[Updater] auto-update disabled by user');
                }
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '云端服务',
            click: () => {
                win.webContents.send('fromCloud')
            }
        },
        {
            label: '安全连接',
            type: 'checkbox',
            checked: store.get('isSecureConnection', true),
            click: (e) => {
                store.set('isSecureConnection', e.checked)
                win.webContents.send('setCloudSec', e.checked)
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '所在班级',
            click: () => {
                win.webContents.send('setClass')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '刷新天气',
            click: () => {
                win.webContents.send('updateWeather')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '当前地区',
            click: () => {
                prompt({
                    title: '地理位置',
                    label: '请设置当前所在地区:',
                    value: store.get('local', ""),
                    inputAttrs: {
                        type: 'string'
                    },
                    type: 'input',
                    height: 180,
                    width: 400,
                    icon: asset('image', 'toggle.png'),
                }).then((r) => {
                    if (r === null) {
                        console.log('[Local] User cancelled');
                    } else {
                        store.set('local', r.toString())
                        console.log('[Local] ', r.toString());
                    }
                })
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '更新课表',
            click: () => {
                // 与 Serverless 模式一致：直接拉取课表（服务端已废弃外部广播入口）
                getScheduleFromCloud();
            }
        },
        {
            type: 'separator'
        },
        {
            icon: asset('image', 'setting.png'),
            label: '配置课表',
            click: () => {
                win.webContents.send('openSettingDialog')
            }
        },
        {
            icon: asset('image', 'clock.png'),
            label: '矫正计时',
            click: () => {
                win.webContents.send('getTimeOffset')
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '切换日程',
            click: () => {
                win.webContents.send('setDayOffset')
            }
        },
        {
            type: 'separator'
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '调试选项',
            submenu: [
                {
                    label: '调试输入',
                    click: () => {
                        prompt({
                            title: '调试输入',
                            label: '',
                            value: store.get('debugInputValue', '0'),
                            inputAttrs: {
                                type: 'string'
                            },
                            type: 'input',
                            height: 140,
                            width: 300,
                        }).then((r) => {
                            if (r === null) return
                            store.set('debugInputValue', r.toString())
                            win.webContents.send('debugInputChanged', r.toString())
                        })
                    }
                },
                {
                    label: '调试矫正',
                    click: () => {
                        // 从渲染进程获取当前课表数据
                        win.webContents.send('getScheduleForDebugCalibration');
                    }
                },
                {
                    label: '开发调试',
                    click: () => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.openDevTools({ mode: 'detach' });
                        }
                    }
                },
            ]
        },
        {
            icon: asset('image', 'github.png'),
            label: '源码仓库',
            click: () => {
                shell.openExternal('https://github.com/daizihan233/AstraSchedule').then(doNothing);
            }
        },
        {
            type: 'separator'
        },
        {
            id: 'isDuringClassCountdown',
            label: '课上计时',
            type: 'checkbox',
            checked: clientConfig.effective('isDuringClassCountdown', store.get('isDuringClassCountdown', true)),
            enabled: !clientConfig.isControlled('isDuringClassCountdown'),
            click: (e) => {
                store.set('isDuringClassCountdown', e.checked)
                clientConfig.recompute(true)
            }
        },
        {
            id: 'isWindowAlwaysOnTop',
            label: '窗口置顶',
            type: 'checkbox',
            checked: clientConfig.effective('isWindowAlwaysOnTop', store.get('isWindowAlwaysOnTop', true)),
            enabled: !clientConfig.isControlled('isWindowAlwaysOnTop'),
            click: (e) => {
                store.set('isWindowAlwaysOnTop', e.checked)
                clientConfig.recompute(true)
            }
        },
        {
            id: 'isAlwaysMinimized',
            label: '始终缩小',
            type: 'checkbox',
            checked: clientConfig.effective('isAlwaysMinimized', store.get('isAlwaysMinimized', false)),
            enabled: !clientConfig.isControlled('isAlwaysMinimized'),
            click: (e) => {
                store.set('isAlwaysMinimized', e.checked)
                clientConfig.recompute(true)
            }
        },
        {
            id: 'isDuringClassHidden',
            label: '上课隐藏',
            type: 'checkbox',
            checked: clientConfig.effective('isDuringClassHidden', store.get('isDuringClassHidden', true)),
            enabled: !clientConfig.isControlled('isDuringClassHidden'),
            click: (e) => {
                store.set('isDuringClassHidden', e.checked)
                clientConfig.recompute(true)
            }
        },
        {
            label: '开机启动',
            type: 'checkbox',
            checked: store.get('isAutoLaunch', true),
            click: (e) => {
                store.set('isAutoLaunch', e.checked)
                setAutoLaunch()
            }
        },
        {
            icon: asset('image', 'toggle.png'),
            label: '切换图标',
            click: () => {
                const current = store.get('trayIcon', 'icon');
                const newIcon = current === 'icon' ? 'appIcon' : 'icon';
                store.set('trayIcon', newIcon);
                if (tray && !tray.isDestroyed()) {
                    tray.setImage(asset('image', newIcon + '.png'));
                }
            }
        },
        {
            type: 'separator'
        },
        {
            icon: asset('image', 'quit.png'),
            label: '退出程序',
            click: () => {
                dialog.showMessageBox(win, {
                    title: '请确认',
                    message: '你确定要退出程序吗?',
                    buttons: ['取消', '确定']
                }).then((data) => {
                    if (data.response) app.quit()
                })
            }
        }
    ]
    template[arg]?.checked !== undefined && (template[arg].checked = true)
    form = Menu.buildFromTemplate(template)
    // 恢复之前的 ToolTip 状态
    updateTrayTooltip(currentConnectionState, websocketDisabled)
    function trayClicked() {
        tray.popUpContextMenu(form)
    }
    tray.on('click', trayClicked)
    tray.on('right-click', trayClicked)
    tray.setContextMenu(form)
    // 托盘重建后按「规则优先、本地兜底」重新下发四项实际生效值
    clientConfig.recompute(true)
})

// 提供鼠标位置与窗口边界给渲染进程（用于穿透下的悬停检测）
ipcMain.handle('getCursorAndBounds', () => {
    try {
        const pt = screen.getCursorScreenPoint()
        const bounds = win?.getBounds?.() || { x: 0, y: 0, width: 0, height: 0 }
        return { cursor: pt, bounds }
    } catch (e) {
        console.error('getCursorAndBounds error:', e)
        return { cursor: { x: 0, y: 0 }, bounds: { x: 0, y: 0, width: 0, height: 0 } }
    }
})

ipcMain.on('log', (e, arg) => {
    console.log(arg);
})

ipcMain.on('setIgnore', (e, arg) => {
    if (arg)
        win.setIgnoreMouseEvents(true, { forward: true });
    else
        win.setIgnoreMouseEvents(false);
})

ipcMain.on('dialog', (e, arg) => {
    dialog.showMessageBox(win, arg.options).then((data) => {
        e.reply(arg.reply, { 'arg': arg, 'index': data.response })
    })
})

ipcMain.on('pop', () => {
    tray.popUpContextMenu(form)
})

const MAX_WEATHER_RETRIES = 5
const WEATHER_RETRY_DELAY_MS = 5000
let weatherRequestInFlight = false
let weatherRetryTimer = null
let weatherRetryCount = 0

function clearWeatherRetryTimer() {
    if (weatherRetryTimer) {
        clearTimeout(weatherRetryTimer)
        weatherRetryTimer = null
    }
}

function finishWeatherCycle() {
    weatherRequestInFlight = false
    clearWeatherRetryTimer()
    weatherRetryCount = 0
}

function scheduleWeatherRetry() {
    weatherRequestInFlight = false
    weatherRetryCount += 1
    if (weatherRetryCount >= MAX_WEATHER_RETRIES) {
        // 达到最大重试次数后静默停止，不提示、不改变 UI
        finishWeatherCycle()
        return
    }
    clearWeatherRetryTimer()
    weatherRetryTimer = setTimeout(() => {
        weatherRetryTimer = null
        requestWeatherWithRetry()
    }, WEATHER_RETRY_DELAY_MS)
}

function requestWeatherWithRetry() {
    if (weatherRequestInFlight) return
    weatherRequestInFlight = true

    const { agreement } = getProtocols()
    const request = astraRequest(
        `${agreement}://${getServer()}/api/weather/${store.get('local', "")}`
    )
    let raw = ''
    request.on('response', (response) => {
        const status = response.statusCode || 0
        // 同上：天气文案/预警文本含中文，必须按流编码解码
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
            raw += chunk
        })
        response.on('end', () => {
            if (status >= 200 && status < 300) {
                try {
                    const weatherData = JSON.parse(raw)
                    if (win && !win.isDestroyed()) win.webContents.send('setWeather', weatherData)
                    finishWeatherCycle()
                } catch {
                    // 解析失败按失败重试，静默处理
                    scheduleWeatherRetry()
                }
            } else {
                // 非 2xx 仅重试，不提示、不改变 UI
                scheduleWeatherRetry()
            }
        })
    })
    request.on('error', () => {
        // 网络错误仅重试，不提示、不改变 UI
        scheduleWeatherRetry()
    })
    request.end()
}

ipcMain.on('getWeather', () => {
    // 仅由触发方决定何时拉取；这里统一执行“最多 5 次”的静默重试策略
    if (weatherRequestInFlight || weatherRetryTimer) return
    weatherRetryCount = 0
    requestWeatherWithRetry()
})

// 处理来自渲染进程的tray状态更新请求

ipcMain.on('update-tray-status', (e, arg) => {
    if (tray) {
        const baseTooltip = `星程 - by KuoHu - ${app.getVersion()}`
        // 检查是否强制保持绿色显示（WebSocket 被禁用）
        const forceGreen = arg.forceGreen || false;

        // 更新全局 websocketDisabled 状态
        websocketDisabled = forceGreen;

        let statusText;
        if (forceGreen) {
            statusText = '在线 (轻量Serverless模式)';
        } else {
            statusText = arg.connected ? '在线' : '离线(弱网)'
        }

        // 如果 WebSocket 被禁用，添加额外的提示
        let tooltipText = `${baseTooltip} - 状态: ${statusText}`;
        if (forceGreen) {
            tooltipText += '\n服务端正处于轻量 Serverless 模式，数据更新可能延迟';
        }
        tooltipText += offlineTraySuffix();

        tray.setToolTip(tooltipText);
        console.log('[Main] Tray tooltip updated to:', tooltipText);
    }
})



ipcMain.on('getTimeOffset', (e, arg) => {
    prompt({
        title: '计时矫正',
        label: '请设置课表计时与系统时间的偏移秒数:',
        value: String(arg ?? 0),
        inputAttrs: {
            type: 'number'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'clock.png'),
    }).then((r) => {
        if (r === null) {
            console.log('[getTimeOffset] User cancelled');
        } else {
            win.webContents.send('setTimeOffset', Number(r) % 10000000000000)
        }
    })
})

// 调试矫正：接收渲染进程发来的课表数据，执行矫正逻辑
ipcMain.on('debugCalibrationData', (e, arg) => {
    const { classes, timetable, subjectNames } = arg;
    const timeRanges = Object.keys(timetable);

    // 构建课节选项
    const classOptions = [];
    const classTimeMap = new Map();

    for (const range of timeRanges) {
        const classIndex = timetable[range];
        if (typeof classIndex === 'number') {
            const [start, end] = range.split('-');
            if (!classTimeMap.has(classIndex)) {
                classTimeMap.set(classIndex, { startTime: start, endTime: end });
                const subjectShort = classes[classIndex] || `未知${classIndex}`;
                const subjectFull = subjectNames[subjectShort] || subjectShort;
                classOptions.push({
                    index: classIndex,
                    label: `第 ${classIndex + 1} 节: ${subjectFull}`,
                    startTime: start,
                    endTime: end
                });
            }
        }
    }

    if (classOptions.length === 0) {
        dialog.showErrorBox('调试矫正', '当前时间表为空，请先配置课表');
        return;
    }

    // 第一步：选择课节
    dialog.showMessageBox(win, {
        type: 'question',
        title: '调试矫正 - 选择课节',
        message: '请选择要矫正到的课节：',
        buttons: [...classOptions.map(o => o.label), '取消'],
        defaultId: 0,
        cancelId: classOptions.length,
    }).then(({ response }) => {
        if (response === classOptions.length) return;

        const selected = classOptions[response];

        // 第二步：选择前/后
        dialog.showMessageBox(win, {
            type: 'question',
            title: '调试矫正 - 选择时机',
            message: `要矫正到 "${selected.label}" 的什么时间点？`,
            buttons: ['上课前', '下课后', '取消'],
            defaultId: 0,
            cancelId: 2,
        }).then(({ response: timingResponse }) => {
            if (timingResponse === 2) return;

            const isBefore = timingResponse === 0;

            // 第三步：输入秒数
            prompt({
                title: '调试矫正 - 输入秒数',
                label: `矫正到${isBefore ? '上课前' : '下课后'}多少秒？`,
                value: '5',
                inputAttrs: {
                    type: 'number'
                },
                type: 'input',
                height: 180,
                width: 400,
            }).then((r) => {
                if (r === null) return;

                const seconds = Number.parseInt(r, 10);
                if (Number.isNaN(seconds)) {
                    dialog.showErrorBox('调试矫正', '请输入有效的秒数');
                    return;
                }

                                    // 计算目标时间
                                    const targetTime = isBefore ? selected.startTime : selected.endTime;
                                    const [targetH, targetM] = targetTime.split(':').map(Number);
                                    let targetSeconds = targetH * 3600 + targetM * 60;

                                    // timetable 结束时间比实际少1分钟，下课后需加60秒
                                    if (!isBefore) {
                                        targetSeconds += 60;
                                    }

                // 当前系统时间（秒）
                const now = new Date();
                const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

                // 计算偏移量：目标时间 - 当前时间 +/- n秒
                let offset = targetSeconds - currentSeconds;
                if (isBefore) {
                    offset -= seconds; // 上课前n秒
                } else {
                    offset += seconds; // 下课后n秒
                }

                // 应用偏移
                win.webContents.send('setTimeOffset', offset % 10000000000000);
                dialog.showMessageBox(win, {
                    type: 'info',
                    title: '调试矫正',
                    message: `已设置偏移 ${offset} 秒\n目标时间: ${targetTime} ${isBefore ? '前' : '后'} ${seconds} 秒`,
                    buttons: ['确定']
                }).then();
            });
        });
    });
})

ipcMain.on('fromCloud', (e, arg) => {
    prompt({
        title: '云端服务',
        label: '请设置云端服务：',
        value: String(arg ?? store.get('server', 'class.getastra.cn')),
        inputAttrs: {
            type: 'string'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'toggle.png'),
    }).then((r) => {
        if (r === null) {
            console.log('[Cloud] User cancelled');
        } else {
            win.webContents.send('setCloudUrl', r.toString())
            store.set('server', r.toString())
            console.log('[Cloud] ', r.toString());
        }
    })
})

// 新增：处理“所在班级”提示框与保存
ipcMain.on('setClass', (e, arg) => {
    prompt({
        title: '所在班级',
        label: '请输入班级标识(例如 39/2023/1)：',
        value: String(arg ?? store.get('class', '39/2023/1')),
        inputAttrs: {type: 'string'},
        type: 'input',
        height: 180,
        width: 400,
        icon: asset('image', 'toggle.png'),
    }).then((r) => {
        if (r === null) {
            console.log('[Class] User cancelled');
            return;
        }
        const val = r.toString();
        try {
            store.set('class', val)
        } catch {
        }
        try {
            win?.webContents?.send('setCloudClass', val)
        } catch {
        }
        // 同步内存中的 classId，随后重连以生效
        classId = val
        console.log('[Class] set to', val)
        refreshCountdownWindow('class-changed').catch(() => {
        })
        try {
            ws?.close?.()
        } catch {
        }
        try {
            connect()
        } catch {
        }
    })
})

// 添加 IPC 事件处理器，用于处理来自渲染进程的 getScheduleFromCloud 请求
ipcMain.on('getScheduleFromCloud', () => {
    // 直接调用 getScheduleFromCloud 函数
    getScheduleFromCloud();
});
