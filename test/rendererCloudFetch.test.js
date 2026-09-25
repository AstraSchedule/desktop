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
    // 捕获 DOMContentLoaded 回调：默认 fixture 把 addEventListener 设成空实现，
    // 无法验证「初始化后回放暂存配置」这条真实路径
    const domReadyListeners = []
    const {context} = loadRendererScripts({
        clock,
        storage: createStorage(),
        config: baseConfig(),
        ipc,
        weekIndex: 0,
        sandbox: {
            $: JQUERY_STUB,
            addEventListener: (type, callback) => {
                if (type === 'DOMContentLoaded') domReadyListeners.push(callback)
            }
        }
    })
    vm.runInContext(DRAWING_STUBS, context)
    // 先跑一帧建立基线，后续断言只看新增消息
    vm.runInContext('tick()', context)
    ipc.sent.length = 0
    return {clock, ipc, context, domReadyListeners}
}

function countChannel(ipc, channel) {
    return ipc.sent.filter((message) => message.channel === channel).length
}

// 模拟 main.js 的接线：配置成功返回后由主进程把生效值下发到渲染进程
function applyClientConfig(ipc) {
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
}

test('重绘（reset）不拉取云端配置，但仍会请求天气', () => {
    const {ipc, context} = setup()

    vm.runInContext('tick(true)', context)

    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 0, 'reset 只应重绘，不得拉取云端配置')
    assert.strictEqual(countChannel(ipc, 'getWeather'), 1, '重绘应顺带刷新天气')
})

test('进入下一个日程时仍会拉取云端配置与天气', () => {
    const {clock, ipc, context} = setup()

    clock.set(NEXT_PERIOD_NOW)
    vm.runInContext('tick()', context)

    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 1)
    assert.strictEqual(countChannel(ipc, 'getWeather'), 1)
})

test('临时调课等本地改动不拉取云端配置', () => {
    const {ipc, context} = setup()

    // 临时调课先改 scheduleArray 再要求重绘，stateChanged 为真也不该拉取云端配置
    vm.runInContext('setLessonOverride(0, "英语"); tick(true)', context)

    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 0, '本地改动不得拉取云端配置')
})

test('云端配置下发不自激拉取课表，但必须顺带请求天气', () => {
    const {ipc} = setup()

    applyClientConfig(ipc)

    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 0, '配置下发不得自激出新的课表拉取')
    // 启动时云端配置往往早于第一次周期 tick 到达，天气请求就搭在这条重绘路径上，
    // 一旦被一起掐掉，客户端启动后会一直显示默认的 000℃
    assert.ok(countChannel(ipc, 'getWeather') >= 1, '配置下发触发的重绘必须请求天气')
})

// 启动竞速回归：云端配置可能早于 DOM 就绪（root 尚未绑定）送达。
// 历史缺陷：此时直接应用会在 root.style 上空引用抛错，而 hasConfigFromCloud 已置真，
// 配置既没生效、也不会再走 8s 兜底显示，窗口停在默认画面上。
test('DOM 未就绪时 newConfig 暂存，DOMContentLoaded 后回放', async () => {
    const {ipc, context, domReadyListeners} = setup()
    assert.strictEqual(domReadyListeners.length, 1, '应注册 DOMContentLoaded 回调')

    assert.strictEqual(vm.runInContext('root', context), null, '初始化前 root 尚未绑定')
    assert.doesNotThrow(
        () => ipc.handlers.get('newConfig')({}, {...baseConfig(), week_display: true}),
        '配置早到不得抛错'
    )
    assert.strictEqual(vm.runInContext('hasConfigFromCloud', context), true, '配置送达后兜底显示不再介入')
    assert.strictEqual(vm.runInContext('pendingNewConfig !== null', context), true, '配置应被暂存')

    // 只隔离 DOM 初始化，回放接线走真实代码：删掉回放逻辑本用例必须失败
    vm.runInContext(
        'root = {style: {setProperty() {}}}; classContainer = {}; initDomAndStart = async () => {}',
        context
    )
    domReadyListeners[0]()
    await new Promise((resolve) => setImmediate(resolve))

    assert.strictEqual(vm.runInContext('pendingNewConfig === null', context), true, '回放后应清空暂存位')
    assert.strictEqual(vm.runInContext('scheduleConfig.week_display', context), true, '暂存的配置应已应用')
    assert.strictEqual(countChannel(ipc, 'getScheduleFromCloud'), 0, '应用配置本身不得自激拉取')
})

// 揭示时序回归：showMainWindow 必须先把「上课隐藏/始终缩小」的可见状态算出来再显示，
// 否则会先画出未应用隐藏规则的画面、下一秒的 tick 再把它藏掉（"闪一下又消失"）。
// 同时必须重算位置：setCountdownerContent 会让倒计时框重新可见，而 tick 只在日程变化时
// 才重算坐标，漏掉就会把框显示在旧坐标上（历史缺陷：倒计时框压在日程行上）。
test('揭示窗口时立即收敛可见状态与位置，不留下会闪或错位的中间态', () => {
    const {ipc, context} = setup()

    vm.runInContext(
        'root = {style: {display: null}}; revealCalls = 0; positionCalls = 0; ' +
        'setCountdownerContent = () => { revealCalls++ }; ' +
        'setCountdownerPosition = () => { positionCalls++ }',
        context
    )
    ipc.handlers.get('showMainWindow')({})

    assert.strictEqual(vm.runInContext('root.style.display', context), 'block')
    assert.strictEqual(context.revealCalls, 1, '揭示时应同步收敛可见状态')
    assert.strictEqual(context.positionCalls, 1, '揭示时必须重算坐标，否则会停在旧位置')
})
