'use strict'

// 元旦解冻彩蛋：课程状态必须从渲染进程转发到主进程，
// 否则彩蛋窗口收不到「上课暂停《恭喜发财》」这条信号（端到端闭环断言）。
// 运行：npm test / node --test

const test = require('node:test')
const assert = require('node:assert')
const vm = require('node:vm')

const {createClock, createStorage, createIpcStub, loadRendererScripts} = require('./support/vmEnv')

// 固定时钟：2026-09-15 10:20（星期二），10:00-10:40 第 2 节正在上课
const FIXED_NOW = new Date(2026, 8, 15, 10, 20, 0, 0)

// 与仓库其余渲染进程测试一致的最小真实配置
function baseConfig() {
    const dailyClass = {}
    for (let day = 0; day < 7; day++) {
        dailyClass[day] = {classList: ['语文', '数学', '英语'], timetable: '常日'}
    }
    return {
        daily_class: dailyClass,
        timetable: {'常日': {'08:00-08:40': 0, '10:00-10:40': 1, '10:50-11:30': 2}},
        divider: {'常日': []},
        subject_name: {'语文': '语文', '数学': '数学', '英语': '英语'},
        week_display: false
    }
}

const DRAWING_STUBS = [
    'setCountdownerContent = function () {}',
    'setScheduleClass = function () {}',
    'setCountdownerPosition = function () {}',
    'setSidebar = function () {}',
    'setBackgroundDisplay = function () {}'
].join('; ')

const JQUERY_STUB = {
    extend: (deep, target, source) => Object.assign(target, JSON.parse(JSON.stringify(source)))
}

test('tick 将真实课程状态通过 class-status-changed 转发给解冻窗口', () => {
    const ipc = createIpcStub()
    const {context} = loadRendererScripts({
        clock: createClock(FIXED_NOW),
        storage: createStorage(),
        config: baseConfig(),
        ipc,
        weekIndex: 0,
        sandbox: {$: JQUERY_STUB}
    })
    vm.runInContext(DRAWING_STUBS, context)

    // 先跑一帧建立基线，后续断言只看新增消息
    vm.runInContext('tick()', context)
    ipc.sent.length = 0

    vm.runInContext('tick(true)', context)

    const forwarded = ipc.sent.filter((m) => m.channel === 'class-status-changed')
    assert.strictEqual(forwarded.length, 1, 'tick 应恰好发送一条 class-status-changed')
    const payload = forwarded[0].args[0]
    assert.ok(payload && typeof payload === 'object', 'payload 应为对象')
    assert.strictEqual(payload.type, 'current', '10:20 应处于上课状态')
    assert.ok(typeof payload.fullName === 'string' && payload.fullName.length > 0, 'payload 需携带真实课程名')
})
