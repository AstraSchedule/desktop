'use strict'

// 426 Upgrade Required 的处理策略。
// SaaS 的边缘节点按 UA 判定客户端版本过旧，对过旧客户端直接回 426。客户端拿到 426 后
// 仍会按退避重试课表，但版本不升就不会成功——只是持续打边缘节点。所以要在收到 426 时
// 静默触发一次更新检查（下载与安装沿用 setupAutoUpdater 的既有流程）。
// 只在自动更新开启、打包运行、版本号是 semver（electron-updater 的前提）时才触发，
// 并用冷却期避免每次失败重试（最短 5 秒一次）都去拉更新源。

// 由 426 触发检查的最小间隔
const UPGRADE_CHECK_COOLDOWN_MS = 5 * 60 * 1000

/**
 * 本次 426 是否值得静默检查一次更新。
 * @param {object} options
 * @param {number} options.statusCode 本次响应状态码
 * @param {boolean} options.autoUpdateEnabled 用户是否开启自动更新
 * @param {boolean} options.packaged 是否打包运行（开发模式没有更新目标）
 * @param {boolean} options.semver 版本号是否可被 electron-updater 解析
 * @param {number} [options.lastCheckAt] 上次由 426 触发检查的时间戳，0 表示从未
 * @param {number} [options.now] 当前时间戳
 * @param {number} [options.cooldownMs] 冷却期
 * @returns {boolean}
 */
function shouldCheckForUpgrade(options) {
    const {
        statusCode,
        autoUpdateEnabled,
        packaged,
        semver,
        lastCheckAt = 0,
        now = Date.now(),
        cooldownMs = UPGRADE_CHECK_COOLDOWN_MS
    } = options
    if (Number(statusCode) !== 426) return false
    if (!autoUpdateEnabled || !packaged || !semver) return false
    return !lastCheckAt || now - lastCheckAt >= cooldownMs
}

module.exports = {shouldCheckForUpgrade, UPGRADE_CHECK_COOLDOWN_MS}
