'use strict'

// 渲染进程测试的公共环境：可控时钟、假 localStorage、vm 上下文小工具。
// 目的是让测试不依赖真实系统时间，也不需要在每个测试文件里重复样板（SonarQube 重复率）。

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

module.exports = {createClock, quietConsole, createStorage, plain, dateKeyOf}
