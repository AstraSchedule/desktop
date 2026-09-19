'use strict'

// 临时调课（按天生效）回归测试
// js/index.js 是渲染进程的经典脚本，这里用 vm 构造最小运行环境后加载，
// 只依赖 node 内置测试运行器，不引入任何依赖。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const INDEX_JS = path.join(__dirname, '..', 'js', 'index.js')
const STORAGE_KEY = 'lesson_override'

function createStorage(seed = {}) {
    const data = { ...seed }
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

// 跨 vm 边界的对象需要转成本 realm 的普通对象再比较
function plain(value) {
    return JSON.parse(JSON.stringify(value))
}

function dateKeyOf(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

// 构造“今天”的课表：第 1 节为每周轮换课程（第 1 周语文 / 第 2 周数学），第 2 节固定英语
function setupToday(storage) {
    const context = vm.createContext({
        localStorage: storage,
        console: { warn() {}, log() {}, error() {} }
    })
    vm.runInContext(fs.readFileSync(INDEX_JS, 'utf8'), context, { filename: 'js/index.js' })
    const config = {
        daily_class: {
            [new Date().getDay()]: { classList: [['语文', '数学'], '英语'] }
        }
    }
    vm.runInContext(`var scheduleConfig = ${JSON.stringify(config)}`, context)
    vm.runInContext('weekIndex = 1', context)
    return { context, config: plain(config) }
}

test('临时调课覆盖当天课表且不破坏每周轮换课表', () => {
    const storage = createStorage()
    const { context, config } = setupToday(storage)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['数学', '英语'])

    context.setLessonOverride(0, '体育')

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '英语'])
    // 原始 classList 未被修改 → 每周轮换课表仍然保留
    assert.deepStrictEqual(plain(vm.runInContext('scheduleConfig', context)), config)
})

test('临时调课在云端配置刷新后依然生效', () => {
    const storage = createStorage()
    const { context, config } = setupToday(storage)
    context.setLessonOverride(0, '体育')

    // 模拟 newConfig：整份 scheduleConfig 被云端下发的对象替换
    vm.runInContext(`scheduleConfig = ${JSON.stringify(config)}`, context)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '英语'])
})

test('跨天后自动恢复云端配置并清除过期数据', () => {
    const storage = createStorage({
        [STORAGE_KEY]: JSON.stringify({ date: '2000-01-01', changes: { 0: '体育' } })
    })
    const { context } = setupToday(storage)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['数学', '英语'])
    assert.strictEqual(storage.getItem(STORAGE_KEY), null)
})

test('当天多次调课互相叠加并记录当天日期', () => {
    const storage = createStorage()
    const { context } = setupToday(storage)
    context.setLessonOverride(0, '体育')
    context.setLessonOverride(1, '音乐')

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['体育', '音乐'])

    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    assert.strictEqual(saved.date, dateKeyOf(new Date()))
    assert.deepStrictEqual(saved.changes, { 0: '体育', 1: '音乐' })
})

test('损坏的临时调课数据不会中断课表显示', () => {
    const storage = createStorage({ [STORAGE_KEY]: '{不是 JSON' })
    const { context } = setupToday(storage)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['数学', '英语'])
})

test('缺少日期字段的临时调课数据视为过期', () => {
    const storage = createStorage({
        [STORAGE_KEY]: JSON.stringify({ changes: { 0: '体育' } })
    })
    const { context } = setupToday(storage)

    assert.deepStrictEqual(plain(context.getCurrentDaySchedule()), ['数学', '英语'])
    assert.strictEqual(storage.getItem(STORAGE_KEY), null)
})
