'use strict'

// 客户端出站请求统一 User-Agent：AstraSchedule/<version>。
// WAF 靠它区分官方客户端与自动化扫描（裸 curl / 扫描器的 UA 一律不是这个形态）。
// 例外：更新下载由 electron-updater 自行发起，不受此处约束。
function clientUserAgent(version) {
    return `AstraSchedule/${version}`
}

module.exports = {clientUserAgent}
