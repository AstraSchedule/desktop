'use strict'

// 网络重试编排单测：拿不到网时按次数重试、连通即停、次数用尽走兜底
// 运行：npm test / node --test

const test = require('node:test')
const assert = require('node:assert')

const {retryUntilConnected} = require('../main/scheduleRetry')

/** 造一个「第 connectedAt 次才连通」的探测函数，并记录调用序列 */
function makeOptions(connectedAt, maxRetries) {
    const seen = {connected: [], failed: [], sleeps: 0, exhausted: 0}
    let calls = 0
    return {
        seen,
        options: {
            maxRetries,
            isConnected: () => ++calls >= connectedAt,
            sleep: () => { seen.sleeps++ },
            onConnected: (attempt) => seen.connected.push(attempt),
            onAttemptFailed: (attempt) => seen.failed.push(attempt),
            onExhausted: () => { seen.exhausted++ },
        },
    }
}

test('第 3 次探测才连通时停止重试并返回 true', async () => {
    const {seen, options} = makeOptions(3, 10)
    assert.strictEqual(await retryUntilConnected(options), true)
    assert.deepStrictEqual(seen.failed, [1, 2])
    assert.deepStrictEqual(seen.connected, [3])
    assert.strictEqual(seen.sleeps, 2)
    assert.strictEqual(seen.exhausted, 0)
})

test('一直不连通时探测 maxRetries 次、等待 maxRetries-1 次并走兜底', async () => {
    const {seen, options} = makeOptions(Infinity, 3)
    assert.strictEqual(await retryUntilConnected(options), false)
    assert.deepStrictEqual(seen.failed, [1, 2, 3])
    assert.deepStrictEqual(seen.connected, [])
    assert.strictEqual(seen.sleeps, 2)
    assert.strictEqual(seen.exhausted, 1)
})

test('maxRetries 为 1 时不等待，探测一次即走兜底', async () => {
    const {seen, options} = makeOptions(Infinity, 1)
    assert.strictEqual(await retryUntilConnected(options), false)
    assert.deepStrictEqual(seen.failed, [1])
    assert.strictEqual(seen.sleeps, 0)
    assert.strictEqual(seen.exhausted, 1)
})
