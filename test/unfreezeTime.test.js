'use strict'

// 解冻时间格式转换：datetime-local(精确到分) <-> 存储格式
const test = require('node:test')
const assert = require('node:assert')
const {toLocalInput, fromLocalInput} = require('../main/unfreeze/time')

test('存储格式可回填到 datetime-local 输入框', () => {
    assert.strictEqual(toLocalInput('2026-12-29 00:00:00'), '2026-12-29T00:00')
    assert.strictEqual(toLocalInput('2026-12-31 13:05:00'), '2026-12-31T13:05')
    assert.strictEqual(toLocalInput('2026-12-31T13:05'), '2026-12-31T13:05')
})

test('datetime-local 输入转为存储格式，秒恒为 00', () => {
    assert.strictEqual(fromLocalInput('2026-12-29T00:00'), '2026-12-29 00:00:00')
    assert.strictEqual(fromLocalInput('2026-12-31T13:05'), '2026-12-31 13:05:00')
})

test('非法/越界输入被拒绝，不写入 store', () => {
    assert.strictEqual(toLocalInput('not-a-date'), '')
    assert.strictEqual(fromLocalInput('2026-12-29'), null)
    assert.strictEqual(fromLocalInput('2026-13-29T00:00'), null)
    assert.strictEqual(fromLocalInput('2026-02-30T00:00'), null)
    assert.strictEqual(fromLocalInput('2026-12-29T25:00'), null)
    assert.strictEqual(fromLocalInput(''), null)
})

// CodeRabbit 存量意见回归：主进程持久化时间校验
test('parseStoredTime 拒绝不可解析值并回退默认', () => {
    const {parseStoredTime} = require('../main/unfreeze/time')
    assert.strictEqual(parseStoredTime('not-a-date', 'FALLBACK'), 'FALLBACK')
    assert.strictEqual(parseStoredTime('2026-12-01 00:00:00', 'FALLBACK'), '2026-12-01 00:00:00')
    assert.strictEqual(parseStoredTime(null, 'FALLBACK'), 'FALLBACK')
    assert.strictEqual(parseStoredTime('2026-13-45 99:99:99', 'FALLBACK'), 'FALLBACK')
})
