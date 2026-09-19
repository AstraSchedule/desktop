'use strict'

// 「重绘不得触发云端拉取」回归测试。
// 历史缺陷：主进程下发自动客户端配置（clientConfig.updateFromSchedule）
// -> applySetting 下发 ClassHidden/AlwaysMinimized/ClassCountdown
// -> 渲染进程 tick(true) -> send('getScheduleFromCloud')
// 构成自激回路，表现为请求全部成功却仍在持续快速轮询。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const vm = require('node:vm')

const {createClock, createStorage, plain, createIpcStub, loadRendererScripts} = require('./support/vmEnv')
const clientConfig = require('../main/clientConfig')

// 固定时钟：2026-09-15 10:20（本地时间，星期二），第 2 节进行中
const FIXED_NOW = new Date(2026, 8, 15, 10, 20, 0, 0)
// 第 2 节下课后的课间，用于验证真实的时间驱动变化仍会拉取
const NEXT_PERIOD_NOW = new Date(2026, 8, 15, 10, 45, 0, 0)

// 需要真实 DOM 的绘制函数在本测试里替换成空实现，tick 本体的判断逻辑保持真实
const DRAWING_STUBS = [
    'setCountdownerContent = function () {}',
    'setScheduleClass = function () {}',
    'setCountdownerPosition = function () {}',
    'setSidebar = function () {}',
    'setBackgroundDisplay = function () {}'
].join('; ')

// tick 末尾用 jQuery 深拷贝上一帧状态，测试环境注入最小实现
const JQUERY_STUB = {
    extend: (deep, target, source) => Object.assign(target, JSON.parse(JSON.stringify(source)))
}

// main.js 里「渲染进程配置项 -> IPC 通道」的接线
const CLIENT_CONFIG_CHANNELS = {
    isDuringClassHidden: 'ClassHidden',
    isAlwaysMinimized: 'AlwaysMinimized',
    isDuringClassCountdown: 'ClassCountdown'
}

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

function setup() {
    const clock = createClock(FIXED_NOW)
    const ipc = createIpcStub()
    const {context} = loadRendererScripts({
        clock,
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
    return {clock, ipc, context}
}

function countChannel(ipc, channel) {
    return ipc.sent.filter((message) => message.channel === channel).length
}

test('重绘（reset）不拉取云端配置与天气', () => {
    const {ipc, context} = setup()

    vm.runInContext('tick(true)', context)

    assert.deepStrictEqual(plain(ipc.sent), [], 'reset 只应重绘，不得触发 getScheduleFromCloud/getWeather')
})

test('进入下一个日程时仍会拉取云端配置与天气', () => {
    const {clock, ipc, context} = setup()

    clock.set(NEXT_PERIOD_NOW)
    vm.runInContext('tick()', context)

    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 1)
    assert.strictEqual(countChannel(ipc, 'getWeather'), 1)
})

test('云端配置下发不再自激出新的拉取请求', () => {
    const {ipc} = setup()

    // 完全按 main.js 的接线初始化：配置生效值由主进程下发到渲染进程
    clientConfig.init({
        getLocalSetting: (key, fallback) => fallback,
        applySetting: (key, value) => {
            const channel = CLIENT_CONFIG_CHANNELS[key]
            const handler = channel ? ipc.handlers.get(channel) : null
            if (handler) handler({}, Boolean(value))
        }
    })
    try {
        clientConfig.updateFromSchedule(baseConfig())
    } finally {
        clientConfig.dispose()
    }

    assert.deepStrictEqual(plain(ipc.sent), [], '配置下发只应重绘，不得再触发网络请求')
})
