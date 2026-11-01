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

// 「304 不得在已有本班配置时强制回源」的回归测试。
// 历史缺陷：304 分支只问 loadScheduleFromCache，而它遇到内存已有配置会返回 false
// （那是离线回落的守卫），于是每次日程切换都被当成「缓存读不出」→ version=0 强制回源，
// 边缘缓存被客户端自己打穿（线上 ESA 访问日志实测：带真实令牌的请求 100% 边缘命中 304，
// 却紧跟约 53 次/天的 version=0 穿透到源站，其中半数拉起冷启动）。
test('304 分支以「本班配置已显示」为前置，且判定早于强制回源', () => {
    const start = MAIN_JS.indexOf('if (statusCode === 304)')
    assert.notStrictEqual(start, -1, '找不到 304 分支')
    const block = MAIN_JS.slice(start, MAIN_JS.indexOf('\n        }', start))
    // 锚定真实代码 token，不能用裸函数名：注释里也会提到 loadScheduleFromCache
    const lines = block.split(/\r?\n/)
    // 锚定整行条件，不按字符位置切片：条件写在同一行里，切片会把前半截掉
    const guardLine = lines.findIndex((l) => /^\s*if \(!alreadyShown && !loadScheduleFromCache\('http-304'/.test(l))
    const declaredLine = lines.findIndex((l) => /^\s*const alreadyShown = /.test(l))
    const forceLine = lines.findIndex((l) => l.includes('force: true'))
    assert.notStrictEqual(declaredLine, -1, '304 分支必须显式判定「本班配置已显示」')
    assert.notStrictEqual(guardLine, -1, '补拉必须同时要求「本班配置未显示」与「本地缓存读不出」')
    assert.notStrictEqual(forceLine, -1, '冷启动拿不到配置时的一次性补拉必须保留')
    assert.ok(declaredLine < guardLine && guardLine < forceLine, '判定必须先于补拉条件，补拉条件必须先于强制回源')
    // 判定必须带班级归属，否则换班级后旧班配置会冒充新班（画面停在别的班的课表上）
    assert.ok(/lastScheduleConfigClass\s*===\s*classId/.test(lines[declaredLine]), '已显示判定必须比对班级归属')
})
test('内存配置的班级归属在写入路径上都被记录', () => {
    // 云端 200 与离线回落两条路径都要落归属，漏一条就等于没有这道守卫
    const cloudAssign = MAIN_JS.search(/lastScheduleConfig = scheduleConfigSync\s*\r?\n\s*lastScheduleConfigClass = requestClassId/)
    assert.notStrictEqual(cloudAssign, -1, '云端 200 写入必须同时记录配置归属班级')
    const cacheAssign = MAIN_JS.search(/lastScheduleConfig = cachedData\.data\s*\r?\n\s*(\/\/[^\r\n]*\r?\n\s*)?lastScheduleConfigClass = classId/)
    assert.notStrictEqual(cacheAssign, -1, '离线回落写入必须同时记录配置归属班级')
    // 请求 URL 用发出时的班级快照，避免响应在途时换班导致归属错位
    assert.ok(/const requestClassId = classId/.test(MAIN_JS), '请求发出时必须快照 classId')
})
