const { test } = require('node:test');
const assert = require('node:assert');
const { createRevalidateScheduler } = require('./scheduleRevalidate');

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

test('重复 arm 只排一次复核', async () => {
    let runs = 0
    const scheduler = createRevalidateScheduler(1, () => { runs++ })
    assert.strictEqual(scheduler.arm(), true)
    assert.strictEqual(scheduler.arm(), false)
    assert.strictEqual(scheduler.pending, true)
    await tick()
    assert.strictEqual(runs, 1)
    assert.strictEqual(scheduler.pending, false)
});

test('cancel 之后不再触发，并且可以重新排期', async () => {
    let runs = 0
    const scheduler = createRevalidateScheduler(1, () => { runs++ })
    scheduler.arm()
    assert.strictEqual(scheduler.cancel(), true)
    assert.strictEqual(scheduler.cancel(), false)
    assert.strictEqual(scheduler.pending, false)
    await tick()
    assert.strictEqual(runs, 0)
    assert.strictEqual(scheduler.arm(), true)
    await tick()
    assert.strictEqual(runs, 1)
});

test('复核触发后仍只排一个', async () => {
    let runs = 0
    const scheduler = createRevalidateScheduler(1, () => { runs++ })
    scheduler.arm()
    await tick()
    scheduler.arm()
    scheduler.arm()
    await tick()
    assert.strictEqual(runs, 2)
});
