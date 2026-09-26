'use strict'

// 更新环路保护单测：更新源残留旧安装包/旧 yml 时不得无限重启
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')

const {shouldAttemptInstall, recordAttempt} = require('../main/updater-guard')

test('首次收到更新时允许安装', () => {
    assert.strictEqual(shouldAttemptInstall('202609.26.143', '202609.26.100', null), true)
})

test('同一目标版本装完仍停在旧版本时不再重复安装（打断无限重启）', () => {
    const attempt = recordAttempt('202609.26.143', '202609.26.100')
    assert.strictEqual(shouldAttemptInstall('202609.26.143', '202609.26.100', attempt), false)
})

test('安装生效后（当前版本已变为目标版本）不误伤', () => {
    const attempt = recordAttempt('202609.26.143', '202609.26.100')
    assert.strictEqual(shouldAttemptInstall('202609.26.143', '202609.26.143', attempt), true)
})

test('出现更新的目标版本时照常放行', () => {
    const attempt = recordAttempt('202609.26.143', '202609.26.100')
    assert.strictEqual(shouldAttemptInstall('202609.27.1', '202609.26.100', attempt), true)
})

test('缺少目标版本号时不允许安装', () => {
    assert.strictEqual(shouldAttemptInstall('', '202609.26.100', null), false)
})
