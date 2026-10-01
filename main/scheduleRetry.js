'use strict'

// 网络就绪前的重试编排：按固定间隔反复探测，直到连通或次数用尽。
//
// 这里刻意用递归而不是循环——循环体内的 await 会命中 SonarCloud
// javascript:S9382（Unexpected `await` inside a loop）。
// main.js 依赖 electron 无法直接加载，所以用依赖注入实现，行为可单测。

/**
 * 反复探测网络，直到连通或达到最大次数。
 * @param {object} options
 * @param {number} options.maxRetries 最多探测次数
 * @param {Function} options.isConnected 探测一次，返回是否连通（可返回 Promise）
 * @param {Function} options.sleep 两次探测之间的等待（可返回 Promise）
 * @param {Function} options.onConnected 连通时回调，参数是命中的第几次
 * @param {Function} options.onAttemptFailed 每次探测失败时回调，参数是第几次
 * @param {Function} [options.onExhausted] 次数用尽时回调
 * @param {number} [options.attempt] 当前是第几次（内部递归用）
 * @returns {Promise<boolean>} 是否连通
 */
async function retryUntilConnected(options) {
    const { maxRetries, isConnected, sleep, onConnected, onAttemptFailed, onExhausted, attempt = 1 } = options
    if (await isConnected()) {
        onConnected(attempt)
        return true
    }
    onAttemptFailed(attempt)
    if (attempt >= maxRetries) {
        if (onExhausted) onExhausted(maxRetries)
        return false
    }
    await sleep()
    return retryUntilConnected({ ...options, attempt: attempt + 1 })
}

module.exports = { retryUntilConnected };
