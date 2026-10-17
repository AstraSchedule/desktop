'use strict'

// /status 的状态判定回归测试：快照字段必须与界面同源
// （getCurrentDaySchedule / getCurrentTime / isClassCurrent / calculateCountdown）。
// 重点覆盖三件事：上课中的下课时刻是「配置结束时间 +1 分钟」、课间的下一次变动是上课、
// 当天没有后续课时 nextLesson/nextChange 必须为 null 而不是伪造值。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')

const {createScheduleFixture, FIXED_NOW, plain} = require('./support/vmEnv')

const SUBJECTS = {语: '语文', 数: '数学', 英: '英语@1'}

function setup(timetable, options = {}) {
    return createScheduleFixture(timetable, {subjects: SUBJECTS, ...options})
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

test('/subjects：今天课表上的科目按课序去重，全部科目另给 catalog', () => {
    const {context, clock} = setup(DAY)
    const status = statusAt(clock, context, 8, 10)

    assert.deepStrictEqual(status.subjects, [
        {shortName: '语', fullName: '语文'},
        {shortName: '数', fullName: '数学'}
    ])
    // '英' 今天没有课，只出现在 catalog 里；'@1' 是下角标标记，输出归一为 '英语1'
    assert.deepStrictEqual(status.catalog, [
        {shortName: '语', fullName: '语文'},
        {shortName: '数', fullName: '数学'},
        {shortName: '英', fullName: '英语1'}
    ])
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
    assert.deepStrictEqual(status.subjects, [
        {shortName: '英', fullName: '英语1'},
        {shortName: '数', fullName: '数学'}
    ], '换过的科目要反映在课程清单里，且不重复出现')
})

test('未加载课表（缺当日班级）时不抛错，返回下课中', () => {
    // extraConfig 覆盖掉整份 daily_class/timetable，模拟「课表还没加载到本机」
    const {context, clock} = setup(DAY, {subjects: {}, extraConfig: {daily_class: {}, timetable: {}}})

    const status = statusAt(clock, context, 8, 10)
    assert.strictEqual(status.inClass, false)
    assert.strictEqual(status.nextLesson, null)
    assert.deepStrictEqual(status.subjects, [])
    assert.deepStrictEqual(status.catalog, [], '课表未加载时课程清单为空，不伪造科目')
})
