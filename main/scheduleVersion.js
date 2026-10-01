// 课表版本号的复用规则。
//
// 边缘（ESA）按版本号缓存课表响应：客户端每次都带 version=0 会把边缘缓存整片打穿，
// 每次请求都回源。但版本号只用于「问服务端有没有变」，与本地缓存是否过期无关——
// 换了班级或服务端真的改了，版本不匹配照样会拿到 200 新数据，所以复用是安全的。
//
// 这里只做「从本地版本索引里挑一个能用的版本串」这一件事，便于单测；
// 拿它去赋值、发请求的动作留在 main.js。

/** 版本串形如 dataVersion:weekNumber[:boundary]（最多三段）；旧格式是纯数字 */
const VERSION_PATTERN = /^\d+(:\d+){0,2}$/;

/**
 * 从离线缓存的版本索引里挑出可复用的版本号。
 * 索引按时间倒序，取第一条；占位值（'latest'、空串等）一律不复用。
 * @param {Array<{version?: unknown}>} versions
 * @returns {string|null}
 */
function pickReusableVersion(versions) {
    if (!Array.isArray(versions) || versions.length === 0) return null
    const latest = versions[0] && versions[0].version
    if (!latest) return null
    const candidate = String(latest)
    return VERSION_PATTERN.test(candidate) ? candidate : null
}

/**
 * 本次请求该带哪个版本号。
 *
 * 默认带手里的令牌，让边缘（ESA）按版本号命中缓存；调用方显式要求刷新时带 '0'，
 * 保证这一次一定回源。只决定这一次请求发什么，不改写调用方手里的令牌——
 * 请求失败时不会留下副作用。
 * @param {boolean} force 本次是否强制回源
 * @param {string} token 手里的版本令牌
 * @returns {string}
 */
function resolveRequestVersion(force, token) {
    return force ? '0' : token
}

module.exports = { pickReusableVersion, resolveRequestVersion, VERSION_PATTERN };
