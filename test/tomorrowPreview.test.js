'use strict'

// 明日课程预览回归测试：今日课程结束后，课表与侧栏切换到下一个有课日。
// 只覆盖 js/index.js 里的目标日选取与预览态课表生成（renderer 的绘制由 DOM 负责，
// 这里只验证它依赖的数据形状）。
// 运行：npm test

const test = require('node:test')
const assert = require('node:assert')

const {createClock, quietConsole, createStorage, plain, createIpcStub, runRepoScript, FIXED_NOW} = require('./support/vmEnv')

const path = require('node:path')
const vm = require('node:vm')

const INDEX_JS = path.join(__dirname, '..', 'js', 'index.js')

// 作息表：上午一节课，之后是放学；预览日要有完整的时间段才能生成课表行
const DAY_TIMETABLE = {'08:00-08:39': 0, '08:40-23:59': '放学'}
const NO_CLASS_TIMETABLE = {'00:00-00:00': 0, '00:01-23:59': '没课'}

// FIXED_NOW 是 2026-09-15 星期二；从星期二出发排 7 天的课表
function buildConfig(overrides = {}) {
    const classDay = {classList: ['语文'], timetable: '常日'}
    const offDay = {classList: [], timetable: '没课'}
    return {
        subject_name: {语: '语文'},
        timetable: {常日: DAY_TIMETABLE, 没课: NO_CLASS_TIMETABLE},
        divider: {常日: [], 没课: []},
        daily_class: {
            0: offDay, // 周日
            1: classDay, // 周一
            2: classDay, // 周二（今天）
            3: offDay, // 周三
            4: classDay, // 周四
            5: offDay, // 周五
            6: offDay, // 周六
        },
        ...overrides,
    }
}

function setup(now, config) {
    const clock = createClock(now)
    const context = vm.createContext({
        localStorage: createStorage(),
        console: quietConsole(),
        Date: clock.DateClass,
        scheduleConfig: config,
    })
    runRepoScript(INDEX_JS, 'js/index.js', context)
    return {context, clock}
}

test('放学后从明天起取第一个有课日：周三没课则跳到周四', () => {
    const {context} = setup(FIXED_NOW, buildConfig())
    const preview = plain(context.findPreviewDay(new Date(FIXED_NOW), 2))

    assert.strictEqual(preview.day, 4, '周三整天没课，应跳到周四')
    assert.strictEqual(new Date(preview.date).getDate(), 17, '日期跟着目标日走')
})

test('整周无课时返回 null，调用方只隐藏倒计时不换课表', () => {
    const config = buildConfig()
    for (const day of Object.keys(config.daily_class)) {
        config.daily_class[day] = {classList: [], timetable: '没课'}
    }
    const {context} = setup(FIXED_NOW, config)

    assert.strictEqual(context.findPreviewDay(new Date(FIXED_NOW), 2), null)
})

test('预览态课表不点亮任何课程，全部按未开始渲染', () => {
    const {context} = setup(FIXED_NOW, buildConfig())
    const preview = {day: 4, date: new Date(2026, 8, 17)}
    const data = plain(context.getScheduleData(preview))

    assert.strictEqual(data.currentHighlight.index, null, '预览态不点亮当前课')
    assert.strictEqual(data.currentHighlight.isEnd, undefined, '预览态不进入已放学状态')
    assert.strictEqual(data.timetable, '常日', '必须用目标日的作息表')
    assert.deepStrictEqual(data.scheduleArray, ['语文'])
    assert.strictEqual(new Date(data.previewDate).getDate(), 17)
})

test('预览不套用当天的临时调课', () => {
    const {context} = setup(FIXED_NOW, buildConfig())
    // 周三本来没课，先给它排一节课，再看预览跳过周三的行为不变
    context.setLessonOverride(0, '体育')
    const data = plain(context.getScheduleData({day: 4, date: new Date(2026, 8, 17)}))

    assert.deepStrictEqual(data.scheduleArray, ['语文'], '调课只影响当天')
})
