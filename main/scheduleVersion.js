// 课表版本号的复用规则。
//
// 边缘（ESA）按版本号缓存课表响应：客户端每次都带 version=0 会把边缘缓存整片打穿，
// 每次请求都回源。但版本号只用于「问服务端有没有变」，与本地缓存是否过期无关——
// 换了班级或服务端真的改了，版本不匹配照样会拿到 200 新数据，所以复用是安全的。
//
// 这里只做「从本地版本索引里挑一个能用的版本串」这一件事，便于单测；
// 拿它去赋值、发请求的动作留在 main.js。

/** 版本串形如 dataVersion:weekNumber[:boundary]；旧格式是纯数字 */
const VERSION_PATTERN = /^\d+(:\d+)*$/;

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

module.exports = { pickReusableVersion, VERSION_PATTERN };
