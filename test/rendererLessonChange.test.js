'use strict'

// 「随心配」改课回调（js/renderer.js 的 getSelectedChangingClass）集成回归测试：
// 用假的 IPC 桥注册并触发回调，观察它对临时调课覆盖表与重绘的真实调用。
// 覆盖 #64：改课要即时生效、云端配置刷新（newConfig）后仍生效、跨天后自动恢复。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const {createClock, quietConsole, createStorage, plain, dateKeyOf} = require('./support/vmEnv')

const INDEX_JS = path.join(__dirname, '..', 'js', 'index.js')
const RENDERER_JS = path.join(__dirname, '..', 'js', 'renderer.js')
const STORAGE_KEY = 'lesson_override'
// 固定时钟：2026-09-15 10:30（本地时间，星期二）
const FIXED_NOW = new Date(2026, 8, 15, 10, 30, 0, 0)
const SUBJECTS = ['语文', '数学', '英语', '物理', '体育']
// 第 1 节是每周轮换（第 1 周语文 / 第 2 周数学），第 2、3 节固定
const CLASS_LIST = [['语文', '数学'], '英语', '物理']
const CLOUD_SCHEDULE = ['数学', '英语', '物理']

// 七个星期都用同一份课表，便于验证跨天后回落到云端配置
function baseConfig() {
    const dailyClass = {}
    for (let day = 0; day < 7; day++) {
        dailyClass[day] = {classList: CLASS_LIST, timetable: '常日'}
    }
    return {
        daily_class: dailyClass,
        timetable: {'常日': {'08:00-08:40': 0, '08:50-09:30': 1, '09:40-10:20': 2}},
        divider: {'常日': []},
        subject_name: {'语文': '语文', '数学': '数学', '英语': '英语', '物理': '物理', '体育': '体育'},
        week_display: false
    }
}

// 加载 index.js + renderer.js，并返回可观测的上下文与 IPC 处理器表
function loadRenderer(clock, storage) {
    const handlers = new Map()
    const ipcRenderer = {
        on(channel, callback) {
            handlers.set(channel, callback)
        },
        send() {},
        invoke: async () => null
    }
    const config = baseConfig()
    const context = vm.createContext({
        localStorage: storage,
        console: quietConsole(),
        window: {astraIPC: ipcRenderer},
        document: {addEventListener() {}, getElementById: () => null},
        addEventListener() {},
        requestAnimationFrame: () => 0,
        Date: clock.DateClass,
        tickCalls: []
    })
    vm.runInContext(fs.readFileSync(INDEX_JS, 'utf8'), context, {filename: 'js/index.js'})
    vm.runInContext(`var _scheduleConfig = ${JSON.stringify(config)}`, context)
    vm.runInContext(`var scheduleConfig = ${JSON.stringify(config)}`, context)
    vm.runInContext('weekIndex = 1', context)
    vm.runInContext(fs.readFileSync(RENDERER_JS, 'utf8'), context, {filename: 'js/renderer.js'})
    // tick 会触发真实渲染，这里替换成可观测的桩
    vm.runInContext('tick = function (reset) { tickCalls.push(reset) }', context)
    return {context, handlers, config}
}

// 模拟主进程回复：index 是用户点击的科目下标，arg.arg.index 是要改的节次
function replyChangeClass(handlers, clicked, period) {
    handlers.get('getSelectedChangingClass')({}, {index: clicked, arg: {index: period, classes: SUBJECTS}})
}

test('改课回调写入当天覆盖表并触发重绘', () => {
    const clock = createClock(FIXED_NOW)
    const storage = createStorage()
    const {context, handlers} = loadRenderer(clock, storage)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), CLOUD_SCHEDULE)

    replyChangeClass(handlers, 4, 0)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '英语', '物理'])
    assert.deepStrictEqual(plain(context.tickCalls), [true], '改课成功后应立即重绘')

    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    assert.strictEqual(saved.date, dateKeyOf(clock.now()))
    assert.deepStrictEqual(saved.changes, {0: '体育'})
})

test('取消改课不写入覆盖也不重绘', () => {
    const storage = createStorage()
    const {context, handlers} = loadRenderer(createClock(FIXED_NOW), storage)

    replyChangeClass(handlers, -1, 0)

    assert.strictEqual(storage.getItem(STORAGE_KEY), null)
    assert.deepStrictEqual(plain(context.tickCalls), [])
    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), CLOUD_SCHEDULE)
})

test('云端配置刷新（newConfig）后改课仍然生效', () => {
    const storage = createStorage()
    const {context, handlers} = loadRenderer(createClock(FIXED_NOW), storage)

    replyChangeClass(handlers, 4, 0)

    // newConfig 会整份替换 scheduleConfig 并渲染，这里把渲染相关调用换成空实现
    vm.runInContext(
        'root = {style: {setProperty() {}}}; setScheduleClass = () => {}; setSidebar = () => {}; setBanner = () => {}',
        context
    )
    handlers.get('newConfig')({}, baseConfig())

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '英语', '物理'])
})

test('跨天后自动恢复云端配置', () => {
    const clock = createClock(FIXED_NOW)
    const storage = createStorage()
    const {context, handlers} = loadRenderer(clock, storage)

    replyChangeClass(handlers, 4, 0)
    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '英语', '物理'])

    // 时钟推进到第二天：临时调课应失效，回到云端配置
    clock.set(new Date(2026, 8, 16, 8, 0, 0, 0))
    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), CLOUD_SCHEDULE)
})
