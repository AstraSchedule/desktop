// 状态接口（3011 端口 /status）的跨进程接线回归测试。
// 这条链路每一环失配都是静默失败：preload 白名单漏登记只 console.warn 后丢弃，
// 主进程漏登记 ipcMain.on 则接口永远停在 503——界面和其它功能都看不出异常。
// 所以这里跑真实的 main/preload.js，让 renderer -> preload -> ipcRenderer 真正走通。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const {createClock, createStorage, plain, createIpcStub, loadRendererScripts, runRepoScript} = require('./support/vmEnv')

const PRELOAD_JS = path.join(__dirname, '..', 'main', 'preload.js')
const MAIN_JS = path.join(__dirname, '..', 'main.js')

// 固定时钟：2026-09-15（星期二）08:10，第 1 节进行中
const FIXED_NOW = new Date(2026, 8, 15, 8, 10, 0, 0)

// 需要真实 DOM 的绘制函数替换成空实现，tick 本体的判断逻辑保持真实
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

function baseConfig() {
    const dailyClass = {}
    for (let day = 0; day < 7; day++) {
        dailyClass[day] = {classList: ['语', '数', '英'], timetable: '常日'}
    }
    return {
        daily_class: dailyClass,
        timetable: {常日: {'08:00-08:39': 0, '08:40-08:49': '课间', '08:50-09:29': 1}},
        divider: {常日: []},
        subject_name: {语: '语文', 数: '数学', 英: '英语@1'},
        week_display: false
    }
}

// 执行真实 preload.js：把 contextBridge 暴露的 API 接上可记录的 ipcRenderer。
// 被白名单拦截的告警单独收集，否则失败时只能看到「没收到消息」而不知道是被谁丢弃的
function loadPreload() {
    const sent = []
    const warnings = []
    let exposed = null
    const context = vm.createContext({
        require: (id) => {
            if (id !== 'electron') throw new Error('preload 不应 require: ' + id)
            return {
                contextBridge: {exposeInMainWorld: (name, api) => { exposed = {name, api} }},
                ipcRenderer: {
                    send: (channel, ...args) => sent.push({channel, args}),
                    on() {},
                    removeListener() {},
                    invoke: async () => null
                }
            }
        },
        console: {log() {}, info() {}, error() {}, warn: (...args) => warnings.push(args.join(' '))}
    })
    runRepoScript(PRELOAD_JS, 'main/preload.js', context)
    assert.ok(exposed, 'preload 应通过 contextBridge 暴露 astraIPC')
    assert.strictEqual(exposed.name, 'astraIPC')
    return {api: exposed.api, sent, warnings}
}

function setup() {
    const preload = loadPreload()
    const clock = createClock(FIXED_NOW)
    const {context} = loadRendererScripts({
        clock,
        storage: createStorage(),
        config: baseConfig(),
        ipc: createIpcStub(),
        weekIndex: 0,
        // 覆盖默认的假 IPC 桥：这里要跑通 preload 的白名单，而不是绕过它
        sandbox: {$: JQUERY_STUB, window: {astraIPC: preload.api}}
    })
    vm.runInContext(DRAWING_STUBS, context)
    return {preload, context}
}

test('渲染进程的状态经 preload 白名单送达主进程', () => {
    const {preload, context} = setup()

    vm.runInContext('tick()', context)

    const messages = preload.sent.filter((message) => message.channel === 'schedule-status')
    assert.strictEqual(
        messages.length, 1,
        'schedule-status 必须登记进 preload 白名单，否则被静默丢弃：' + preload.warnings.join(' | ')
    )
    // 快照来自 vm 上下文，转成本 realm 的普通对象再比对
    const status = plain(messages[0].args[0])
    assert.strictEqual(status.time, '08:10:00')
    assert.strictEqual(status.state, 'in_class')
    assert.strictEqual(status.inClass, true)
    assert.strictEqual(status.currentLesson.fullName, '语文')
    assert.strictEqual(status.nextLesson.fullName, '数学')
    assert.deepStrictEqual(status.nextChange, {type: 'class_end', at: '08:40', inSeconds: 1800})
    assert.deepStrictEqual(
        status.subjects,
        [{shortName: '语', fullName: '语文'}, {shortName: '数', fullName: '数学'}],
        '今天课表上的科目要跟着状态一起送达，否则 /subjects 永远是空清单'
    )
    assert.deepStrictEqual(status.catalog.map((item) => item.shortName), ['语', '数', '英'])
})

test('白名单仍然生效：未登记的 channel 被拦截', () => {
    const preload = loadPreload()

    preload.api.send('not-registered-channel', {x: 1})

    assert.strictEqual(preload.sent.length, 0, '未登记 channel 不得下发到 ipcRenderer')
    assert.ok(
        preload.warnings.some((line) => line.includes('not-registered-channel')),
        '被拦截时应留下告警，而不是静默丢弃'
    )
})

test('主进程登记了 schedule-status 并把状态交给状态服务', () => {
    const source = fs.readFileSync(MAIN_JS, 'utf8')

    const handler = source.match(/ipcMain\.on\(\s*'schedule-status'\s*,[\s\S]*?\n\}\)/)
    assert.ok(handler, 'main.js 必须登记 ipcMain.on(schedule-status)')
    assert.match(handler[0], /statusServer\.update\(status\)/, '状态必须交给 statusServer.update，否则接口永远 503')
    assert.match(source, /createStatusServer\(\)/, 'main.js 应创建状态服务实例')
})

test('主进程只将非 null、非数组的对象交给状态服务', () => {
    const source = fs.readFileSync(MAIN_JS, 'utf8')
    const handler = source.match(/ipcMain\.on\(\s*'schedule-status'\s*,[\s\S]*?\n\}\)/)
    assert.ok(handler, 'main.js 必须登记 ipcMain.on(schedule-status)')
    let onStatus
    const updates = []
    vm.runInNewContext(handler[0], {
        ipcMain: {on: (channel, callback) => { onStatus = callback }},
        statusServer: {update: (status) => updates.push(status)}
    })

    for (const status of [{}, {state: 'in_class'}]) {
        onStatus({}, status)
        assert.strictEqual(updates.at(-1), status)
    }
    for (const status of [null, undefined, [], [{state: 'in_class'}], '', 'status', 0, 1, false, true]) {
        onStatus({}, status)
    }
    assert.strictEqual(updates.length, 2, '非法状态不得交给状态服务')
})
