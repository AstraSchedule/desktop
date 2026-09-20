'use strict'

// 课表轮询模块测试。
// 该模块只在服务端不支持 WebSocket 推送（usr-backend 的 serverless 模式会下发
// supportWebSocket=false）时生效，配置项是托盘菜单里的「轮询间隔」。
// 覆盖：输入解析、启停条件、定时触发、推送恢复后的让位。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')

const {
    ScheduleRefresh,
    parseIntervalSeconds,
    describeIntervalSeconds,
    STORE_KEY,
    DEFAULT_SECONDS,
    MIN_SECONDS,
    MAX_SECONDS,
} = require('../main/scheduleRefresh')

/** 构造被测实例：内存 store + 记录调用的 fetchSchedule + 可控的推送状态 */
function createHarness(options = {}) {
    let pushDisabled = options.pushDisabled !== false
    const stored = new Map(Object.entries(options.stored || {}))
    const calls = []
    const store = {
        get: (key, fallback) => (stored.has(key) ? stored.get(key) : fallback),
        set: (key, value) => {
            stored.set(key, value)
        },
    }
    const instance = new ScheduleRefresh({
        store,
        fetchSchedule: () => calls.push('fetch'),
        isPushDisabled: () => pushDisabled,
        log: () => {},
    })
    return {
        instance,
        stored,
        calls,
        setPushDisabled: (value) => {
            pushDisabled = value
        },
    }
}

test('解析：空输入按默认值（不轮询）处理', () => {
    assert.deepEqual(parseIntervalSeconds(''), { ok: true, seconds: DEFAULT_SECONDS })
    assert.deepEqual(parseIntervalSeconds(null), { ok: true, seconds: DEFAULT_SECONDS })
    assert.deepEqual(parseIntervalSeconds(undefined), { ok: true, seconds: DEFAULT_SECONDS })
    assert.deepEqual(parseIntervalSeconds('   '), { ok: true, seconds: DEFAULT_SECONDS })
})

test('解析：0 表示关闭，合法值原样返回', () => {
    assert.deepEqual(parseIntervalSeconds('0'), { ok: true, seconds: 0 })
    assert.deepEqual(parseIntervalSeconds('300'), { ok: true, seconds: 300 })
    assert.deepEqual(parseIntervalSeconds(`${MAX_SECONDS}`), { ok: true, seconds: MAX_SECONDS })
})

test('解析：拒绝非整数、过小与过大', () => {
    for (const bad of ['abc', '-1', '1.5', '60s', ' 6 0']) {
        assert.equal(parseIntervalSeconds(bad).ok, false, bad)
    }
    assert.equal(parseIntervalSeconds(String(MIN_SECONDS - 1)).ok, false)
    assert.equal(parseIntervalSeconds(String(MAX_SECONDS + 1)).ok, false)
})

test('describeIntervalSeconds 输出人类可读的说法', () => {
    assert.equal(describeIntervalSeconds(0), '不轮询')
    assert.equal(describeIntervalSeconds(30), '每 30 秒')
    assert.equal(describeIntervalSeconds(300), '每 5 分钟')
    assert.equal(describeIntervalSeconds(7200), '每 2 小时')
})

test('存储值被外部改坏时退回默认值而不是抛错', () => {
    const h = createHarness({ stored: { [STORE_KEY]: '垃圾数据' } })
    assert.equal(h.instance.savedSeconds(), DEFAULT_SECONDS)
    const below = createHarness({ stored: { [STORE_KEY]: String(MIN_SECONDS - 1) } })
    assert.equal(below.instance.savedSeconds(), DEFAULT_SECONDS)
})

test('推送可用时即使配了间隔也不启动', (t) => {
    const h = createHarness({ pushDisabled: false, stored: { [STORE_KEY]: '60' } })
    t.after(() => h.instance.stop())

    assert.equal(h.instance.apply(), false)
    assert.equal(h.instance.isRunning(), false)
})

test('间隔为 0 时不启动', (t) => {
    const h = createHarness({ stored: { [STORE_KEY]: '0' } })
    t.after(() => h.instance.stop())

    assert.equal(h.instance.apply(), false)
    assert.equal(h.instance.isRunning(), false)
})

test('未配置间隔时默认不启动（老用户升级后行为不变）', (t) => {
    const h = createHarness()
    t.after(() => h.instance.stop())

    assert.equal(h.instance.apply(), false)
    assert.equal(h.instance.isRunning(), false)
})

test('setSeconds 保存并立即生效，tick 触发拉取', (t) => {
    const h = createHarness()
    t.after(() => h.instance.stop())

    const result = h.instance.setSeconds('120')

    assert.equal(result.ok, true)
    assert.equal(h.stored.get(STORE_KEY), '120')
    assert.equal(h.instance.isRunning(), true)

    h.instance.tick()
    h.instance.tick()
    assert.equal(h.calls.length, 2)
})

test('非法输入不改变已保存的配置', (t) => {
    const h = createHarness({ stored: { [STORE_KEY]: '300' } })
    t.after(() => h.instance.stop())
    h.instance.apply()

    const result = h.instance.setSeconds('5')

    assert.equal(result.ok, false)
    assert.equal(h.stored.get(STORE_KEY), '300', '配置应保持不变')
    assert.equal(h.instance.savedSeconds(), 300)
})

test('推送恢复后 tick 立即让位并停止定时器', (t) => {
    const h = createHarness({ stored: { [STORE_KEY]: '60' } })
    t.after(() => h.instance.stop())
    h.instance.apply()
    assert.equal(h.instance.isRunning(), true)

    h.setPushDisabled(false)
    h.instance.tick()

    assert.equal(h.calls.length, 0, '推送可用时不应再主动拉取')
    assert.equal(h.instance.isRunning(), false)
})

test('重复 apply 不会叠加定时器', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const h = createHarness({ stored: { [STORE_KEY]: '60' } })
    t.after(() => h.instance.stop())

    h.instance.apply()
    h.instance.apply()
    h.instance.apply()

    t.mock.timers.tick(60 * 1000)
    assert.equal(h.calls.length, 1, '三次 apply 只能留下一个定时器')
})

test('定时器按配置的间隔反复触发', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const h = createHarness({ stored: { [STORE_KEY]: '60' } })
    t.after(() => h.instance.stop())
    h.instance.apply()

    t.mock.timers.tick(60 * 1000)
    t.mock.timers.tick(60 * 1000)
    t.mock.timers.tick(60 * 1000)

    assert.equal(h.calls.length, 3)
})

test('stop 可重复调用', (t) => {
    const h = createHarness({ stored: { [STORE_KEY]: '60' } })
    h.instance.apply()
    h.instance.stop()
    h.instance.stop()
    assert.equal(h.instance.isRunning(), false)
})

test('间隔被改小时会按新间隔重启', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const h = createHarness({ stored: { [STORE_KEY]: '60' } })
    t.after(() => h.instance.stop())
    h.instance.apply()

    h.instance.setSeconds('30')
    t.mock.timers.tick(30 * 1000)

    assert.equal(h.calls.length, 1, '旧定时器必须已被清掉，否则 30s 时会触发两次')
})
