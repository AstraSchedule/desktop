const { app, systemPreferences, nativeTheme } = require('electron');
const os = require('node:os');

function getWindowsMajorVersion() {
    if (process.platform !== 'win32') return null;
    const version = os.release();
    const match = version.match(/^(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
}

function isAeroEnabled() {
    // 主要方法：使用 Electron 原生 API（deprecated 但仍可用）
    if (typeof systemPreferences.isAeroGlassEnabled === 'function') {
        try {
            return systemPreferences.isAeroGlassEnabled();
        } catch (e) {
            console.error('[AeroCheck] isAeroGlassEnabled() failed:', e);
        }
    }

    // 备用方法：通过系统颜色检测（Basic 主题颜色特征不同）
    try {
        if (typeof systemPreferences.getColor === 'function') {
            const caption = systemPreferences.getColor('activeCaption');
            // Windows 7 Basic 主题的 activeCaption 通常是纯色（如 #0055EE）
            // 而 Aero 主题通常是渐变或半透明色
            // 简单检测：如果颜色值较短（纯色），可能是 Basic 主题
            if (caption && caption.length <= 7) {
                console.log('[AeroCheck] Detected Basic theme via color:', caption);
                return false;
            }
        }
    } catch (e) {
        console.error('[AeroCheck] Color detection failed:', e);
    }

    // 所有方法都失败时，假定 Aero 可用（安全降级）
    console.log('[AeroCheck] Cannot determine Aero status, assuming enabled');
    return true;
}

function shouldCheckAero() {
    const major = getWindowsMajorVersion();
    return major !== null && major < 10;
}

let lastAeroState = null;

function checkAndExitIfBasic() {
    if (!shouldCheckAero()) return false;
    const aeroEnabled = isAeroEnabled();
    if (lastAeroState === null) {
        lastAeroState = aeroEnabled;
        if (!aeroEnabled) {
            console.log('[AeroCheck] Aero is not enabled at startup, exiting.');
            app.quit();
            return true;
        }
    } else if (lastAeroState !== aeroEnabled) {
        console.log('[AeroCheck] Aero state changed to', aeroEnabled ? 'enabled' : 'disabled');
        if (!aeroEnabled) {
            console.log('[AeroCheck] Aero disabled at runtime, exiting.');
            app.quit();
            return true;
        }
        lastAeroState = aeroEnabled;
    }
    return false;
}

function onThemeChanged() {
    checkAndExitIfBasic();
}

function startAeroMonitoring() {
    if (!shouldCheckAero()) return false;
    if (checkAndExitIfBasic()) return true;

    nativeTheme.on('updated', onThemeChanged);
    if (typeof systemPreferences.on === 'function') {
        systemPreferences.on('accent-color-changed', onThemeChanged);
    }
    console.log('[AeroCheck] Listening for theme changes via nativeTheme.updated + accent-color-changed');
    return false;
}

function stopAeroMonitoring() {
    nativeTheme.removeListener('updated', onThemeChanged);
    if (typeof systemPreferences.removeListener === 'function') {
        systemPreferences.removeListener('accent-color-changed', onThemeChanged);
    }
}

module.exports = { startAeroMonitoring, stopAeroMonitoring };