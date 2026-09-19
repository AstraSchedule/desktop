'use strict'

// 离线缓存回归测试。
// 后端下发的 version 形如 "<数据版本>:<周次>"（见 usr-backend router/client/getSchedule.go
// 的 scheduleVersion），客户端把它原样当作缓存版本传入 saveToCache。历史上 normalizeVersion
// 只接受非负整数，于是 Number("1758288000:5") 得到 NaN 直接抛错，
// 日志只剩 "[OfflineCache] Failed to save cache: Error"，缓存文件一个也写不出来。
// 另：版本索引排序用 version 相减，对复合版本号会得到 NaN，导致裁剪掉的是最新而不是最旧的版本。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const OFFLINE_CACHE_MODULE = '../main/offline-cache'
// 后端真实下发的复合版本号：<Unix 时间戳>:<学期周次>
const COMPOSITE_VERSION = '1758288000:5'
const SCHEDULE = {version: COMPOSITE_VERSION, daily_class: {'0': {classList: ['语文']}}}

// 主进程模块依赖 electron 的 app.getPath('userData')，这里注入最小桩并指向临时目录
function loadOfflineCache(userDataDir) {
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
        if (request === 'electron') return {app: {getPath: () => userDataDir}}
        return originalLoad.call(this, request, parent, isMain)
    }
    try {
        delete require.cache[require.resolve(OFFLINE_CACHE_MODULE)]
        return require(OFFLINE_CACHE_MODULE).OfflineCache
    } finally {
        Module._load = originalLoad
    }
}

function createCache(t) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-offline-cache-'))
    t.after(() => fs.rmSync(userDataDir, {recursive: true, force: true}))
    const OfflineCache = loadOfflineCache(userDataDir)
    return {cache: new OfflineCache(), cacheDir: path.join(userDataDir, 'schedule-cache')}
}

test('服务端复合版本号能写入缓存并可读回', (t) => {
    const {cache, cacheDir} = createCache(t)

    assert.strictEqual(cache.saveToCache(SCHEDULE, COMPOSITE_VERSION), true)
    // 冒号在 Windows 文件名里非法，落盘时统一换成连字符
    assert.deepStrictEqual(fs.readdirSync(cacheDir).sort(), [
        'schedule-1758288000-5.json',
        'schedule-latest.json',
        'version-index.json',
    ])
    assert.strictEqual(cache.hasCachedData(), true)
    assert.deepStrictEqual(cache.loadFromCache().data, SCHEDULE)
    assert.deepStrictEqual(cache.getVersionIndex().versions.map((v) => v.version), [COMPOSITE_VERSION])
})

test('旧版纯数字版本号仍然可用', (t) => {
    const {cache, cacheDir} = createCache(t)

    assert.strictEqual(cache.saveToCache(SCHEDULE, 1758288000), true)
    assert.ok(fs.readdirSync(cacheDir).includes('schedule-1758288000.json'))
    assert.deepStrictEqual(cache.loadFromCache(1758288000).data, SCHEDULE)
})

test('非法版本号（路径穿越）仍然被拒绝且不落盘', (t) => {
    const {cache, cacheDir} = createCache(t)

    for (const bad of ['../../evil', '1/2', '..', 'latest.json', '1:2:../x']) {
        assert.strictEqual(cache.saveToCache(SCHEDULE, bad), false, bad)
    }
    assert.deepStrictEqual(fs.readdirSync(cacheDir), [])
})

test('版本索引按时间保留最近 N 个版本', (t) => {
    const {cache} = createCache(t)

    const versionAt = (i) => `17582880${i}:1`
    for (let i = 0; i < 6; i++) {
        cache.updateVersionIndex(versionAt(i), 1000 + i)
    }

    const versions = cache.getVersionIndex().versions
    assert.strictEqual(versions.length, 5)
    assert.ok(!versions.some((v) => v.version === versionAt(0)), '应裁剪掉最早写入的版本')
    assert.ok(versions.some((v) => v.version === versionAt(5)), '最新写入的版本必须保留')
})
