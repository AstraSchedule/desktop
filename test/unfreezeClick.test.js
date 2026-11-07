'use strict'

// 解冻完成态点击行为：100% 后只发 channel 打开视频，不再播音频；100% 前仍播音频。
// 用 vm 直接加载仓库里的 js/unfreeze.js（源码来自仓库，不是外部输入），验证真实分支。
// 运行：node --test

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'unfreeze.js'), 'utf8')

// js/unfreeze.js 用 globalThis.addEventListener('DOMContentLoaded', init) 注册。
// vm 上下文里 globalThis===ctx，捕获该回调后手动触发以模拟页面加载完成。
function loadWithInit(fixedNowIso) {
    const sent = []
    const handlers = new Map()
    const listeners = new Map()
    const audio = { volume: 0, currentTime: 0, loop: false, paused: false, played: false,
        pause() { this.paused = true }, play() { this.played = true; return Promise.resolve() } }
    const container = { style: {}, cursor: '', addEventListener(n, f) { listeners.set(n, f) }, click() { const f = listeners.get('click'); if (f) f() } }
    const countdownEl = { style: { display: '' }, textContent: '' }
    const startLayer = { style: { clipPath: '' } }
    let domReady = null
    const ctx = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        window: { astraIPC: { send: (...a) => sent.push(a), on: (c, fn) => handlers.set(c, fn) } },
        document: { getElementById: (id) => (id === 'countdown' ? countdownEl : id === 'startLayer' ? startLayer : null),
            querySelector: (sel) => (sel === '.container' ? container : null), addEventListener() {} },
        Audio: function () { return audio },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame() {},
        Date: class extends Date { constructor(...a) { if (a.length === 0) super(fixedNowIso); else super(...a) } static now() { return new Date(fixedNowIso).getTime() } },
        addEventListener(event, fn) { if (event === 'DOMContentLoaded') domReady = fn },
    })
    ctx.globalThis = ctx
    new vm.Script(SOURCE, { filename: 'js/unfreeze.js' }).runInContext(ctx)
    if (domReady) domReady()
    return { ctx, sent, handlers, audio, container, countdownEl, startLayer }
}

function applyConfig(handlers, startTime, endTime) {
    const fn = handlers.get('unfreeze-config')
    assert.ok(fn, 'unfreeze-config handler 应已注册')
    fn(null, { startTime, endTime })
}

// 完成态：now 在 endTime 之后
test('100% 后点击只发 unfreeze-open-video，不播音频', () => {
    const s = loadWithInit('2026-12-31T14:00:00')
    applyConfig(s.handlers, '2026-12-29 00:00:00', '2026-12-31 13:00:00')
    s.audio.played = false
    s.audio.paused = false
    s.container.click()
    assert.deepStrictEqual(s.sent, [['unfreeze-open-video']], '应只发一个无参数 channel')
    assert.strictEqual(s.audio.played, false, '完成态不得播放音频')
})

// 进行中：now 在窗口内
test('100% 前点击仍播放《恭喜发财》，不发 channel', () => {
    const s = loadWithInit('2026-12-30T12:00:00')
    applyConfig(s.handlers, '2026-12-29 00:00:00', '2026-12-31 13:00:00')
    s.audio.played = false
    s.container.click()
    assert.strictEqual(s.audio.played, true, '未完成时点击应播放音频')
    assert.deepStrictEqual(s.sent, [], '未完成时不发 open-video channel')
})

test('完成态显示 end 图且隐藏倒计时', () => {
    const s = loadWithInit('2026-12-31T14:00:00')
    applyConfig(s.handlers, '2026-12-29 00:00:00', '2026-12-31 13:00:00')
    assert.strictEqual(s.startLayer.style.clipPath, 'inset(100% 0 0 0)')
    assert.strictEqual(s.countdownEl.style.display, 'none')
})
