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
