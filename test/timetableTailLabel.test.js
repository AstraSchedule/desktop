'use strict'

// 作息表文本时段显示回归测试
// 最后一个课程序号之后往往还有多个文本时段（课间/晚读/晚自习/就寝/放学…），
// 每一段都必须显示自己在 timetable 中配置的文字，不能被下一段的文字顶替，
// 否则整条尾巴会错位一格（AstraSchedule/desktop#53）。
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
        subject_name: {语: '语文', 数: '数学'},
        daily_class: {
            [FIXED_NOW.getDay()]: {classList: ['语', '数'], timetable: '常日'}
        },
        timetable: {常日: timetable},
        divider: {常日: []},
        ...extraConfig
    }
    vm.runInContext(`var scheduleConfig = ${JSON.stringify(config)}`, context)
    return {context, clock}
}

function highlightAt(clock, context, hour, minute = 1) {
    const date = new Date(FIXED_NOW)
    date.setHours(hour, minute, 0, 0)
    clock.set(date)
    return plain(context.getScheduleData().currentHighlight)
}

test('最后一个课程序号之后的每个文本时段都显示自身标签', () => {
    // 复刻 njx 班级「常日」的尾部结构：第 2 节之后是连续的文本时段
    const {context, clock} = setup({
        '08:00-08:39': 0,
        '08:40-09:29': 1,
        '09:30-16:04': '课间',
        '16:05-18:14': '课间',
        '18:15-18:29': '晚读',
        '18:30-19:09': '晚自习',
        '19:10-23:59': '就寝'
    })

    assert.strictEqual(highlightAt(clock, context, 16, 30).fullName, '课间')
    assert.strictEqual(highlightAt(clock, context, 18, 20).fullName, '晚读')
    assert.strictEqual(highlightAt(clock, context, 18, 40).fullName, '晚自习')
    assert.strictEqual(highlightAt(clock, context, 20, 30).fullName, '就寝')
})

test('课程之间的课间仍显示自身标签', () => {
    const {context, clock} = setup({
        '08:00-08:39': 0,
        '08:40-08:49': '课间',
        '08:50-09:29': 1,
        '09:30-23:59': '放学'
    })

    const current = highlightAt(clock, context, 8, 45)
    assert.strictEqual(current.fullName, '课间')
    assert.strictEqual(current.type, 'upcoming')
    assert.strictEqual(current.countdownText, '05:00', '倒计时应指向本时段结束时间 08:49')
})

test('当前时段没有标签时回退到 end_of_day_label', () => {
    const {context, clock} = setup({'08:00-23:59': ''}, {end_of_day_label: '放学啦'})

    assert.strictEqual(highlightAt(clock, context, 10).fullName, '放学啦')
})
