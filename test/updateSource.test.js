'use strict'

// 更新源解析/迁移单测：默认源、旧 hubproxy 源自动迁移、自定义源不被覆盖
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')

const {DEFAULT_UPDATE_MIRROR, resolveUpdateSource} = require('../main/update-source')

// 三个仓库名都曾是客户端的默认更新源（仓库改过两次名，GitHub 自动重定向）
const LEGACY_EARLY = 'https://hubproxy.khbit.cn/https://github.com/daizihan233/ElectronClassSchedule/releases/latest/download'
const LEGACY_IA32 = 'https://hubproxy.khbit.cn/https://github.com/daizihan233/AstraSchedule/releases/latest/download'
const LEGACY_WIN10 = 'https://hubproxy.khbit.cn/https://github.com/AstraSchedule/desktop/releases/latest/download'

test('未配置过更新源时使用新默认源', () => {
    assert.deepStrictEqual(resolveUpdateSource(undefined), {url: DEFAULT_UPDATE_MIRROR, usingDefault: true, migrated: false})
    assert.deepStrictEqual(resolveUpdateSource('   '), {url: DEFAULT_UPDATE_MIRROR, usingDefault: true, migrated: false})
})

test('已是新默认源时保持不变', () => {
    const r = resolveUpdateSource(DEFAULT_UPDATE_MIRROR)
    assert.strictEqual(r.url, DEFAULT_UPDATE_MIRROR)
    assert.strictEqual(r.usingDefault, true)
    assert.strictEqual(r.migrated, false)
})

test('旧的 hubproxy 源（含历史持久化值）自动迁移到新默认源', () => {
    for (const legacy of [LEGACY_EARLY, LEGACY_IA32, LEGACY_WIN10]) {
        const r = resolveUpdateSource(legacy)
        assert.strictEqual(r.url, DEFAULT_UPDATE_MIRROR, legacy)
        assert.strictEqual(r.usingDefault, true, legacy)
        assert.strictEqual(r.migrated, true, legacy)
    }
})

test('自定义更新源一律保留', () => {
    const customs = [
        'https://cdn.example.com/app',
        'https://yanmo-objects.cn-nb1.rains3.com/AstraSchedule/202609.26.144/',
        // 同一台 hubproxy 上的自定义路径 / 第三方仓库代理都不算历史默认源，必须保留
        'https://hubproxy.khbit.cn/mirror/app',
        'https://hubproxy.khbit.cn/https://github.com/other/repo/releases/latest/download'
    ]
    for (const custom of customs) {
        const r = resolveUpdateSource(custom)
        assert.strictEqual(r.url, custom)
        assert.strictEqual(r.usingDefault, false, custom)
        assert.strictEqual(r.migrated, false, custom)
    }
})

test('无法解析的字符串按自定义源保留，不误判为旧默认源', () => {
    const r = resolveUpdateSource('not a url')
    assert.strictEqual(r.url, 'not a url')
    assert.strictEqual(r.usingDefault, false)
})
