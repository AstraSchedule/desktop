'use strict'

// 426 Upgrade Required 自动升级单测：只有自动更新开着、打包运行、版本号合法时才检查，
// 且冷却期内不重复检查（课表失败重试最短 5 秒一次，不能每次都打更新源）
// main.js 依赖 electron 无法直接加载，接线部分做源码断言
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {shouldCheckForUpgrade, UPGRADE_CHECK_COOLDOWN_MS} = require('../main/upgrade-required')

const FILE_MAIN = path.join(__dirname, '..', 'main.js')
const READY = {statusCode: 426, autoUpdateEnabled: true, packaged: true, semver: true}
const NOW = 1750000000000

test('426 + 自动更新开启 + 打包 + semver 时触发更新检查', () => {
    assert.strictEqual(shouldCheckForUpgrade({...READY, now: NOW}), true)
})

test('非 426 不触发', () => {
    for (const statusCode of [200, 304, 403, 500]) {
        assert.strictEqual(shouldCheckForUpgrade({...READY, statusCode, now: NOW}), false)
    }
})

test('自动更新关闭时不触发', () => {
    assert.strictEqual(shouldCheckForUpgrade({...READY, autoUpdateEnabled: false, now: NOW}), false)
})

test('开发模式（未打包）不触发', () => {
    assert.strictEqual(shouldCheckForUpgrade({...READY, packaged: false, now: NOW}), false)
})

test('非 semver 版本不触发', () => {
    assert.strictEqual(shouldCheckForUpgrade({...READY, semver: false, now: NOW}), false)
})

test('冷却期内不重复触发，过期后再次触发', () => {
    const lastCheckAt = NOW
    assert.strictEqual(shouldCheckForUpgrade({...READY, lastCheckAt, now: NOW + 1000}), false)
    assert.strictEqual(
        shouldCheckForUpgrade({...READY, lastCheckAt, now: NOW + UPGRADE_CHECK_COOLDOWN_MS - 1}),
        false
    )
    assert.strictEqual(shouldCheckForUpgrade({...READY, lastCheckAt, now: NOW + UPGRADE_CHECK_COOLDOWN_MS}), true)
})

test('main.js 把 426 触发入口接在课表请求与 WebSocket 升级失败上', () => {
    const src = fs.readFileSync(FILE_MAIN, 'utf8')
    // 1 处函数定义 + 课表非 2xx 与 WS 非 101 两条调用路径
    assert.strictEqual((src.match(/triggerUpgradeCheck\(statusCode\)/g) || []).length, 3)
    assert.match(src, /ws\.on\('unexpected-response', \(_req, res\) => \{/)
    // 接管后必须让 ws 自行 abort 握手，否则连接会卡在 CONNECTING（CodeRabbit 意见）
    assert.match(src, /ws\.terminate\(\)/)
    // 触发前必须经过 shouldCheckForUpgrade 判定（开关、打包、semver、冷却期）
    assert.match(src, /if \(!shouldCheckForUpgrade\(\{/)
})
