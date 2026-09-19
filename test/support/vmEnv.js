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

// loadRendererScripts 在最小 DOM 桩上加载 index.js + renderer.js。
// 需要真实 DOM 的绘制函数由调用方按需替换；sandbox 用于注入 $ 之类的额外全局量。
function loadRendererScripts({clock, storage, config, ipc, weekIndex = 1, sandbox = {}}) {
    const context = vm.createContext({
        localStorage: storage,
        console: quietConsole(),
        window: {astraIPC: ipc.api},
        document: {addEventListener() {}, getElementById: () => null},
        addEventListener() {},
        requestAnimationFrame: () => 0,
        Date: clock.DateClass,
        ...sandbox,
    })
    vm.runInContext(fs.readFileSync(INDEX_JS, 'utf8'), context, {filename: 'js/index.js'})
    const json = JSON.stringify(config)
    vm.runInContext(`var _scheduleConfig = ${json}`, context)
    vm.runInContext(`var scheduleConfig = ${json}`, context)
    vm.runInContext(`weekIndex = ${weekIndex}`, context)
    vm.runInContext(fs.readFileSync(RENDERER_JS, 'utf8'), context, {filename: 'js/renderer.js'})
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
