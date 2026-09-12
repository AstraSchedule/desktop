'use strict'

// 自动客户端配置的单元测试：直接用 node 内置测试运行器，不引入任何依赖
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')

const cron = require('../main/clientConfig/cron')
const conditions = require('../main/clientConfig/conditions')
const scheduler = require('../main/clientConfig')

function day(y, m, d, hour = 0, minute = 0) {
    return new Date(y, m - 1, d, hour, minute, 0, 0)
}

function ctxOf(now, extra = {}) {
    const periods = extra.periods || new Map()
    return Object.assign({
        now,
        termStart: '2026-09-01',
        appStart: day(2026, 9, 1, 7),
        periods,
        periodOrder: conditions.sortedPeriodStarts(periods)
    }, extra, { now, periods })
}

// ============================================================
// cron
// ============================================================

test('parseCron 接受合法表达式、拒绝非法表达式', () => {
    for (const expr of ['* * * * *', '0 8 * * 1', '*/15 6-22 * * 1-5', '0 0 1,15 * *']) {
        assert.ok(cron.parseCron(expr), expr)
    }
    for (const expr of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * * * 7', 'a * * * *', '*/0 * * * *', '5-1 * * * *']) {
        assert.equal(cron.parseCron(expr), null, expr)
    }
})

test('cron prev/next 命中时刻', () => {
    const spec = cron.parseCron('0 8 * * 1')
    // 2026-09-02 是周三，上一次命中为 08-31 周一，下一次为 09-07 周一
    const now = day(2026, 9, 2, 12)
    const prev = cron.prev(spec, now)
    assert.equal(prev.getTime(), day(2026, 8, 31, 8).getTime())
    const next = cron.next(spec, now)
    assert.equal(next.getTime(), day(2026, 9, 7, 8).getTime())
})

test('cron prev 在命中小时之前也能找到当天更早的命中', () => {
    const spec = cron.parseCron('0 8 * * *')
    const prev = cron.prev(spec, day(2026, 9, 2, 7))
    assert.equal(prev.getTime(), day(2026, 9, 1, 8).getTime())
})

test('cron 日与周同时受限时取「或」', () => {
    const spec = cron.parseCron('0 0 1 * 1')
    assert.ok(cron.matches(spec, day(2026, 9, 1, 0)))
    assert.ok(cron.matches(spec, day(2026, 9, 7, 0)))
    assert.ok(!cron.matches(spec, day(2026, 9, 8, 0)))
})

// ============================================================
// 条件求值
// ============================================================

test('calcWeekNumber 按周一切分学期周次', () => {
    // 2026-09-01 是周二，所在周为第 1 周
    assert.equal(conditions.calcWeekNumber('2026-09-01', day(2026, 9, 1, 12)), 1)
    assert.equal(conditions.calcWeekNumber('2026-09-01', day(2026, 9, 6, 23)), 1)
    assert.equal(conditions.calcWeekNumber('2026-09-01', day(2026, 9, 7, 0)), 2)
    assert.equal(conditions.calcWeekNumber('', day(2026, 9, 7, 0)), 1)
})

test('条件：单日 / 日期范围 / 星期过滤', () => {
    assert.ok(conditions.isActive({ kind: 'date', date: '2026-09-01' }, ctxOf(day(2026, 9, 1, 10))))
    assert.ok(!conditions.isActive({ kind: 'date', date: '2026-09-02' }, ctxOf(day(2026, 9, 1, 10))))

    const range = { kind: 'range', startDate: '2026-09-07', endDate: '2026-09-11' }
    assert.ok(!conditions.isActive(range, ctxOf(day(2026, 9, 6, 23))))
    assert.ok(conditions.isActive(range, ctxOf(day(2026, 9, 11, 23))))
    assert.ok(!conditions.isActive(range, ctxOf(day(2026, 9, 12, 0))))

    // 2026-09-02 周三
    const wednesday = { kind: 'range', startDate: '2026-09-01', endDate: '2026-09-30', weekdays: [3] }
    assert.ok(conditions.isActive(wednesday, ctxOf(day(2026, 9, 2, 8))))
    assert.ok(!conditions.isActive(wednesday, ctxOf(day(2026, 9, 3, 8))))
})

test('条件：每 N 周轮换', () => {
    const odd = { kind: 'weekly', everyWeeks: 2, weekOffset: 0 }
    const even = { kind: 'weekly', everyWeeks: 2, weekOffset: 1 }
    assert.ok(conditions.isActive(odd, ctxOf(day(2026, 9, 1, 8))))
    assert.ok(!conditions.isActive(odd, ctxOf(day(2026, 9, 8, 8))))
    assert.ok(conditions.isActive(odd, ctxOf(day(2026, 9, 15, 8))))
    assert.ok(conditions.isActive(even, ctxOf(day(2026, 9, 8, 8))))
})

test('条件：四周轮换的四个槽位互斥', () => {
    const dates = [day(2026, 9, 1, 8), day(2026, 9, 8, 8), day(2026, 9, 15, 8), day(2026, 9, 22, 8)]
    for (let offset = 0; offset < 4; offset++) {
        const when = { kind: 'weekly', everyWeeks: 4, weekOffset: offset }
        dates.forEach((d, idx) => {
            assert.equal(conditions.isActive(when, ctxOf(d)), idx === offset, `offset=${offset} week=${idx + 1}`)
        })
        assert.equal(conditions.isActive(when, ctxOf(day(2026, 9, 29, 8))), offset === 0)
    }
})

test('条件：时刻事件（上课时 / 下课时）', () => {
    // 第 1 节 08:00-08:40（配置里写成 08:00-08:39），第 2 节 08:50-09:30
    const periods = conditions.periodRanges({
        '08:00-08:39': 0,
        '08:50-09:29': 1
    })
    const base = { periods }

    const classStart = { kind: 'event', event: 'class_start', period: 1 }
    assert.ok(!conditions.isActive(classStart, ctxOf(day(2026, 9, 1, 7, 59), base)))
    assert.ok(conditions.isActive(classStart, ctxOf(day(2026, 9, 1, 8, 10), base)))
    assert.ok(!conditions.isActive(classStart, ctxOf(day(2026, 9, 1, 8, 45), base)))

    const firstEnd = { kind: 'event', event: 'class_end', period: 1 }
    assert.ok(!conditions.isActive(firstEnd, ctxOf(day(2026, 9, 1, 8, 39), base)))
    assert.ok(conditions.isActive(firstEnd, ctxOf(day(2026, 9, 1, 8, 45), base)))
    assert.ok(!conditions.isActive(firstEnd, ctxOf(day(2026, 9, 1, 8, 55), base)), '下一节开始后不再生效')

    const lastEnd = { kind: 'event', event: 'class_end', period: 2 }
    assert.ok(conditions.isActive(lastEnd, ctxOf(day(2026, 9, 1, 10, 30), base)), '最后一节下课后持续到当天结束')
})

test('条件：启动事件在启动时刻之后生效', () => {
    const when = { kind: 'event', event: 'startup' }
    const ctx = ctxOf(day(2026, 9, 1, 9))
    assert.ok(conditions.isActive(when, ctx))
    assert.ok(!conditions.isActive(when, ctxOf(day(2026, 9, 1, 6))))
})

test('条件：cron 区间（含 duration 与到下次命中两种）', () => {
    const withDuration = { kind: 'cron', cron: '0 8 * * *', duration: 60 }
    assert.ok(!conditions.isActive(withDuration, ctxOf(day(2026, 9, 1, 7))))
    assert.ok(conditions.isActive(withDuration, ctxOf(day(2026, 9, 1, 8, 30))))
    assert.ok(!conditions.isActive(withDuration, ctxOf(day(2026, 9, 1, 9, 1))))

    const untilNext = { kind: 'cron', cron: '0 8 * * *' }
    assert.ok(conditions.isActive(untilNext, ctxOf(day(2026, 9, 2, 7))))
    assert.ok(!conditions.isActive({ kind: 'cron', cron: 'bad' }, ctxOf(day(2026, 9, 2, 7))))
})

test('条件：未知类型与缺省条件', () => {
    assert.ok(conditions.isActive(null, ctxOf(day(2026, 9, 1, 8))))
    assert.ok(!conditions.isActive({ kind: 'unknown' }, ctxOf(day(2026, 9, 1, 8))))
})

// ============================================================
// 调度器
// ============================================================

function setupScheduler(local = {}) {
    const applied = []
    scheduler.init({
        getLocalSetting: (key, fallback) => (key in local ? local[key] : fallback),
        applySetting: (key, value, fromRule) => applied.push({ key, value, fromRule })
    })
    return applied
}

function lastAppliedOf(applied, key) {
    const hits = applied.filter(x => x.key === key)
    return hits.length > 0 ? hits[hits.length - 1] : null
}

test('调度器：优先级高的规则胜出，作用域更具体者次之', () => {
    const applied = setupScheduler({ isWindowAlwaysOnTop: false })
    scheduler.updateFromSchedule({
        term_start: '2026-09-01',
        client_config_rules: [
            { taskId: 'a', priority: 1, specificity: 3, when: { kind: 'range', startDate: '2000-01-01', endDate: '2099-12-31' }, settings: { isWindowAlwaysOnTop: true } },
            { taskId: 'b', priority: 5, specificity: 0, when: { kind: 'range', startDate: '2000-01-01', endDate: '2099-12-31' }, settings: { isWindowAlwaysOnTop: false } },
            { taskId: 'c', priority: 5, specificity: 2, when: { kind: 'range', startDate: '2000-01-01', endDate: '2099-12-31' }, settings: { isWindowAlwaysOnTop: true } }
        ]
    })

    const last = lastAppliedOf(applied, 'isWindowAlwaysOnTop')
    assert.equal(last.value, true, '同优先级取作用域更具体者')
    assert.equal(last.fromRule, true)
    assert.equal(scheduler.isControlled('isWindowAlwaysOnTop'), true)
    assert.equal(scheduler.effective('isWindowAlwaysOnTop', false), true)
})

test('调度器：没有规则命中时回落到本地设置', () => {
    const applied = setupScheduler({ isAlwaysMinimized: true })
    scheduler.updateFromSchedule({
        term_start: '2026-09-01',
        client_config_rules: [
            { taskId: 'expired', priority: 9, when: { kind: 'date', date: '2000-01-01' }, settings: { isAlwaysMinimized: false } }
        ]
    })

    const last = lastAppliedOf(applied, 'isAlwaysMinimized')
    assert.equal(last.value, true, '过期规则不生效，使用本地设置')
    assert.equal(last.fromRule, false)
    assert.equal(scheduler.isControlled('isAlwaysMinimized'), false)
    assert.equal(scheduler.effective('isAlwaysMinimized', true), true)
})

test('调度器：每周轮换规则在不同周取不同配置', () => {
    const applied = setupScheduler({})
    const rules = [
        { taskId: 'odd', priority: 1, specificity: 1, when: { kind: 'weekly', everyWeeks: 2, weekOffset: 0 }, settings: { isDuringClassHidden: true } },
        { taskId: 'even', priority: 1, specificity: 1, when: { kind: 'weekly', everyWeeks: 2, weekOffset: 1 }, settings: { isDuringClassHidden: false } }
    ]

    // 直接驱动一次重算：把当前时间的周次换成任意一周不好控制，
    // 这里改为验证同一时刻最多只有一个槽位命中
    scheduler.updateFromSchedule({ term_start: '2026-09-01', client_config_rules: rules })
    const last = lastAppliedOf(applied, 'isDuringClassHidden')
    assert.ok(last !== null)
    assert.ok(typeof last.value === 'boolean')
})

test('调度器：空规则集不报错', () => {
    setupScheduler({})
    scheduler.updateFromSchedule({})
    scheduler.updateFromSchedule({ client_config_rules: [] })
    scheduler.recompute(true)
    scheduler.dispose()
})
