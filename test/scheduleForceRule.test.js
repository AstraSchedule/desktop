'use strict'

// 「强制回源只有人为操作才允许」的源级回归测试。
//
// 规则：客户端带手里的版本令牌请求课表，由边缘（ESA）按版本号决定是否回源；
// 只有用户点击托盘「更新课表」这一次人为操作（以及 304 后本地缓存读不出时的一次性补齐）
// 才允许把版本号写成 0 强制回源。
// 历史缺陷：渲染进程「进入下一个日程」的自动拉取曾被写成 currentVersionToken = '0'（#82），
// SyncConfig 推送也曾被改成 force: true（#87），结果每次日程切换都绕过边缘缓存、全部回源。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const MAIN_LINES = MAIN_JS.split(/\r?\n/)

// 唯一允许强制回源的两处：用户点击的托盘项、304 后缓存读不出时的一次性补齐
const ALLOWED_FORCE_CONTEXTS = ["label: '更新课表'", "'http-304'"]

test('除声明处外没有任何地方把版本令牌归零', () => {
    const offenders = MAIN_LINES.filter((line) => /^\s*currentVersionToken\s*=\s*'0'/.test(line))
    assert.deepStrictEqual(offenders, [], '令牌只允许在声明处初始化，不得在运行期归零')
})

test('force: true 只出现在允许强制回源的两处', () => {
    const indexes = []
    MAIN_LINES.forEach((line, index) => {
        if (line.includes('force: true')) indexes.push(index)
    })
    assert.ok(indexes.length > 0, '托盘「更新课表」必须保留强制回源')
    for (const index of indexes) {
        const context = MAIN_LINES.slice(Math.max(0, index - 12), index + 1).join('\n')
        assert.ok(
            ALLOWED_FORCE_CONTEXTS.some((marker) => context.includes(marker)),
            `第 ${index + 1} 行的 force: true 不在允许的上下文里：\n${context}`
        )
    }
})

test('渲染进程的自动拉取入口不得强制回源', () => {
    const start = MAIN_JS.indexOf("ipcMain.on('getScheduleFromCloud'")
    assert.notStrictEqual(start, -1, '找不到 IPC 处理器')
    const block = MAIN_JS.slice(start, MAIN_JS.indexOf('})', start))
    assert.ok(block.includes('getScheduleFromCloud()'), 'IPC 处理器必须调用 getScheduleFromCloud()')
    assert.ok(!block.includes('force'), '进入下一个日程的自动拉取不得强制回源')
})

test('SyncConfig 推送按版本号请求，不强制回源', () => {
    const start = MAIN_JS.indexOf("if (text === 'SyncConfig')")
    assert.notStrictEqual(start, -1, '找不到 SyncConfig 分支')
    const block = MAIN_JS.slice(start, MAIN_JS.indexOf('\n        }', start))
    assert.ok(block.includes('getScheduleFromCloud()'), 'SyncConfig 必须触发一次拉取')
    assert.ok(!block.includes('force'), 'SyncConfig 推送不得强制回源')
})
