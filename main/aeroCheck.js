const { app, systemPreferences, nativeTheme } = require('electron');
const os = require('node:os');

function getWindowsMajorVersion() {
    if (process.platform !== 'win32') return null;
    const version = os.release();
    const match = version.match(/^(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
}

function isAeroEnabled() {
    if (typeof systemPreferences.isAeroGlassEnabled !== 'function') {
        return true;
    }
    try {
        return systemPreferences.isAeroGlassEnabled();
    } catch (e) {
        console.error('[AeroCheck] Failed to check Aero status:', e);
        return true;
    }
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