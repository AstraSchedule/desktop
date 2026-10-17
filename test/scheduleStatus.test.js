'use strict'

// /status 的状态判定回归测试：快照字段必须与界面同源
// （getCurrentDaySchedule / getCurrentTime / isClassCurrent / calculateCountdown）。
// 重点覆盖三件事：上课中的下课时刻是「配置结束时间 +1 分钟」、课间的下一次变动是上课、
// 当天没有后续课时 nextLesson/nextChange 必须为 null 而不是伪造值。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const {createClock, quietConsole, createStorage, plain} = require('./support/vmEnv')

const INDEX_JS = path.join(__dirname, '..', 'js', 'index.js')
// 固定时钟：2026-09-15（星期二），测试不依赖真实系统时间
const FIXED_NOW = new Date(2026, 8, 15, 8, 0, 0, 0)

function setup(timetable, extraConfig = {}) {
    const clock = createClock(FIXED_NOW)
    const context = vm.createContext({
        localStorage: createStorage(),
        console: quietConsole(),
        Date: clock.DateClass
    })
    vm.runInContext(fs.readFileSync(INDEX_JS, 'utf8'), context, {filename: 'js/index.js'})
    const config = {
        subject_name: {语: '语文', 数: '数学', 英: '英语@1' },
        daily_class: {
            [FIXED_NOW.getDay()]: {classList: ['语', '数', '英'], timetable: '常日'}
        },
        timetable: {常日: timetable},
        divider: {常日: []},
        ...extraConfig
    }
    vm.runInContext(`var scheduleConfig = ${JSON.stringify(config)}`, context)
    return {context, clock}
}

function statusAt(clock, context, hour, minute = 0, second = 0) {
    const date = new Date(FIXED_NOW)
    date.setHours(hour, minute, second, 0)
    clock.set(date)
    return plain(context.getScheduleStatus())
}

const DAY = {
    '08:00-08:39': 0,
    '08:40-08:49': '课间',
    '08:50-09:29': 1,
    '09:30-23:59': '放学'
}

test('上课中：报告当前课、下一节课与下课时刻', () => {
    const {context, clock} = setup(DAY)
    const status = statusAt(clock, context, 8, 10)

    assert.strictEqual(status.inClass, true)
    assert.strictEqual(status.state, 'in_class')
    assert.strictEqual(status.time, '08:10:00')
    assert.strictEqual(status.currentLesson.fullName, '语文')
    assert.strictEqual(status.currentLesson.startAt, '08:00')
    assert.strictEqual(status.currentLesson.endAt, '08:40', '结束时间按 +1 分钟惯例归一到 08:40')
    assert.strictEqual(status.nextLesson.fullName, '数学')
    assert.deepStrictEqual(status.nextChange, {type: 'class_end', at: '08:40', inSeconds: 1800})
})

test('课间：不在上课，下一次变动是下一节课开始', () => {
    const {context, clock} = setup(DAY)
    const status = statusAt(clock, context, 8, 45)

    assert.strictEqual(status.inClass, false)
    assert.strictEqual(status.state, 'break')
    assert.strictEqual(status.currentLesson, null)
    assert.strictEqual(status.nextLesson.fullName, '数学')
    assert.deepStrictEqual(status.nextChange, {type: 'class_start', at: '08:50', inSeconds: 300})
})

test('当天课程结束后：nextLesson 与 nextChange 都为 null', () => {
    const {context, clock} = setup(DAY)
    const status = statusAt(clock, context, 9, 40)

    assert.strictEqual(status.inClass, false)
    assert.strictEqual(status.currentLesson, null)
    assert.strictEqual(status.nextLesson, null)
    assert.strictEqual(status.nextChange, null)
})

test('文本时段（课间/放学）不算课时，也不会污染下一节课', () => {
    const {context, clock} = setup(DAY)
    const duringBreak = statusAt(clock, context, 8, 45)
    assert.strictEqual(duringBreak.currentLesson, null, '课间标签不能当成当前课')
    assert.strictEqual(duringBreak.nextLesson.fullName, '数学')
})

test('最后一段跨到 24:00 的课：下课时刻显示 24:00 而不是 00:00', () => {
    const {context, clock} = setup({
        '08:00-08:39': 0,
        '22:00-23:59': 1
    })
    const status = statusAt(clock, context, 22, 30)

    assert.strictEqual(status.inClass, true)
    assert.strictEqual(status.currentLesson.endAt, '24:00')
})

test('临时调课优先：当天被换掉的科目要体现在状态里', () => {
    const {context, clock} = setup(DAY)
    context.setLessonOverride(0, '英')

    const status = statusAt(clock, context, 8, 10)
    assert.strictEqual(status.currentLesson.shortName, '英')
    // '英语@1' 的 '@' 是下角标标记，输出纯文本时去标记、留下角标字符
    assert.strictEqual(status.currentLesson.fullName, '英语1')
})

test('未加载课表（缺当日班级）时不抛错，返回下课中', () => {
    const clock = createClock(FIXED_NOW)
    const context = vm.createContext({
        localStorage: createStorage(),
        console: quietConsole(),
        Date: clock.DateClass
    })
    vm.runInContext(fs.readFileSync(INDEX_JS, 'utf8'), context, {filename: 'js/index.js'})
    vm.runInContext('var scheduleConfig = {subject_name: {}, daily_class: {}, timetable: {}, divider: {}}', context)

    const status = statusAt(clock, context, 8, 10)
    assert.strictEqual(status.inClass, false)
    assert.strictEqual(status.nextLesson, null)
})
