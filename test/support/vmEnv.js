'use strict'

// 渲染进程测试的公共环境：可控时钟、假 localStorage、假 IPC 桥、vm 上下文小工具。
// 目的是让测试不依赖真实系统时间，也不需要在每个测试文件里重复样板（SonarQube 重复率）。

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const INDEX_JS = path.join(__dirname, '..', '..', 'js', 'index.js')
const RENDERER_JS = path.join(__dirname, '..', '..', 'js', 'renderer.js')

// createClock 返回一个可控时钟：注入到 vm 上下文后，脚本里的 `new Date()` 都返回当前设定时刻
function createClock(initial) {
    let current = initial.getTime()
    return {
        now: () => new Date(current),
        set(date) {
            current = date.getTime()
        },
        DateClass: class extends Date {
            constructor(...args) {
                if (args.length === 0) {
                    super(current)
                } else {
                    super(...args)
                }
            }
        }
    }
}

// 屏蔽脚本自身的日志输出，避免测试噪声
function quietConsole() {
    return {log() {}, warn() {}, error() {}, info() {}}
}

function createStorage(seed = {}) {
    const data = {...seed}
    return {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
        },
        setItem(key, value) {
            data[key] = String(value)
        },
        removeItem(key) {
            delete data[key]
        }
    }
}

// 跨 vm 边界的对象要转成本 realm 的普通对象再比较
function plain(value) {
    return JSON.parse(JSON.stringify(value))
}

function dateKeyOf(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

// createIpcStub 模拟 preload 暴露的 window.astraIPC：
// handlers 记录渲染进程注册的回调（主进程可用它模拟下发），sent 记录渲染进程发出的消息
function createIpcStub() {
    const handlers = new Map()
    const sent = []
    return {
        handlers,
        sent,
        api: {
            on(channel, callback) {
                handlers.set(channel, callback)
            },
            send(channel, ...args) {
                sent.push({channel, args})
            },
            invoke: async () => null,
        },
    }
}

// runRepoScript 执行仓库内的渲染脚本（源码来自测试仓库文件，不是外部输入），
// 用 vm.Script 显式承载源码，避免把拼接出来的字符串交给 vm.runInContext
function runRepoScript(file, filename, context) {
    const source = fs.readFileSync(file, 'utf8')
    // 源码来自仓库内的渲染脚本（测试夹具），不是用户输入；vm 无法用字面量源码执行文件内容
    new vm.Script(source, {filename}).runInContext(context) // NOSONAR
}

// loadRendererScripts 在最小 DOM 桩上加载 index.js + renderer.js。
// 需要真实 DOM 的绘制函数由调用方按需替换；sandbox 用于注入 $ 之类的额外全局量。
function loadRendererScripts({clock, storage, config, ipc, weekIndex = 1, sandbox = {}}) {
    // index.js 从 localStorage 读取周次，用种子值代替向 vm 里注入赋值语句
    storage.setItem('weekIndex', String(weekIndex))
    const context = vm.createContext({
        localStorage: storage,
        console: quietConsole(),
        window: {astraIPC: ipc.api},
        document: {addEventListener() {}, getElementById: () => null},
        addEventListener() {},
        requestAnimationFrame: () => 0,
        Date: clock.DateClass,
        // 课表配置作为沙箱全局量注入，同样避免执行拼接代码
        _scheduleConfig: config,
        scheduleConfig: config,
        ...sandbox,
    })
    runRepoScript(INDEX_JS, 'js/index.js', context)
    runRepoScript(RENDERER_JS, 'js/renderer.js', context)
    return {context, ipc}
}

module.exports = {
    createClock,
    quietConsole,
    createStorage,
    plain,
    dateKeyOf,
    createIpcStub,
    loadRendererScripts,
}
