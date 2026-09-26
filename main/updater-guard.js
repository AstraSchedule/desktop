'use strict'

// 更新安装环路保护。
// 更新源目录（OSS/镜像）里可能同时残留旧安装包与旧 latest.yml / win10.yml：
// electron-updater 只比对 yml 里声明的版本与 app.getVersion()，不校验安装包的实际版本，
// 于是会出现「下载 → 安装 → 重启后版本没变 → 再下载」的无限重启。
// 这里按「目标版本 + 安装前版本」只放行一次安装尝试：安装没生效就停手，
// 由日志与托盘提示把问题暴露出来，而不是让客户端无限重启。

const STORE_KEY = 'updateInstallAttempt'

// 是否允许为 target 版本执行一次 quitAndInstall。
// lastAttempt 形如 {version, from}，记录上一次安装尝试的目标版本与安装前的应用版本。
function shouldAttemptInstall(target, current, lastAttempt) {
    if (!target) return false
    if (!lastAttempt || typeof lastAttempt !== 'object') return true
    // 目标版本没变、安装前的版本也没变 → 上一次安装没有生效，不再重试
    return !(lastAttempt.version === target && lastAttempt.from === current)
}

// 记录一次安装尝试（对象形状只在这里定义，避免各调用点各自拼装）
function recordAttempt(target, current) {
    return {version: target, from: current}
}

module.exports = {shouldAttemptInstall, recordAttempt, STORE_KEY}
