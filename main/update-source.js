'use strict'

// 更新源解析与旧源迁移。
// hubproxy.khbit.cn 即将关停，而旧客户端把默认更新源持久化在 electron-store 里：
// 升级后必须自动换成新的默认源，否则客户端会继续指向一个即将下线的地址，
// 且「是否使用默认源」判定不成立，Win10+ 客户端也拿不到 win10.yml。
// 用户自行配置的其它更新源一律不动。

const DEFAULT_UPDATE_MIRROR = 'https://yanmo-objects.cn-nb1.rains3.com/AstraSchedule/latest/'

// 需要迁移的历史默认源：hubproxy 代理本仓库的 GitHub 发布地址。
// 只按「已知的历史默认地址形态」匹配（主机 + 本仓库 releases 代理路径），不按主机一刀切，
// 否则用户自行配置的其它 hubproxy 路径会被替换成默认源而丢配置（CodeRabbit 意见 #5）。
const LEGACY_MIRROR_HOST = 'hubproxy.khbit.cn'
const LEGACY_MIRROR_PATH = /^\/https?:\/\/github\.com\/(daizihan233\/AstraSchedule|AstraSchedule\/desktop)\/releases\//

function isLegacyMirror(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    return parsed.hostname === LEGACY_MIRROR_HOST && LEGACY_MIRROR_PATH.test(parsed.pathname)
}

// 解析最终生效的更新源。
// url：最终使用的源地址；usingDefault：是否等效使用默认源（决定是否切 Win10+ 通道）；
// migrated：是否把历史默认源迁移成了新默认源。
function resolveUpdateSource(stored) {
    const raw = typeof stored === 'string' ? stored.trim() : ''
    if (!raw) return {url: DEFAULT_UPDATE_MIRROR, usingDefault: true, migrated: false}
    if (raw === DEFAULT_UPDATE_MIRROR) return {url: raw, usingDefault: true, migrated: false}
    if (isLegacyMirror(raw)) {
        return {url: DEFAULT_UPDATE_MIRROR, usingDefault: true, migrated: true}
    }
    return {url: raw, usingDefault: false, migrated: false}
}

module.exports = {DEFAULT_UPDATE_MIRROR, isLegacyMirror, resolveUpdateSource}
