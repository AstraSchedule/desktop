/**
 * 课表轮询模块
 *
 * 服务端不支持 WebSocket 推送时（usr-backend 的 serverless 模式会下发 supportWebSocket=false），
 * 客户端只剩「启动 / 进入下一个日程 / 失败重试」三个拉取时机，改完课表多久生效取决于课程节奏。
 * 这里提供一个用户可配置的定时拉取作为补充。配合 ESA 边缘版本缓存，单次拉取通常只是一个 304。
 *
 * 只在推送不可用时生效：自部署版本有推送，定时拉取是多余的，而且自部署没有边缘缓存，
 * 轮询会直接压到源站。
 *
 * 配置存在 electron-store 的 scheduleRefreshInterval（字符串形式的秒数），0 表示不轮询。
 */
'use strict'

const STORE_KEY = 'scheduleRefreshInterval'
// 默认不轮询：老用户升级后行为不变，需要的人自己开
const DEFAULT_SECONDS = 0
// 下限 30 秒：再密集也换不来更快的生效，只会白耗 ESA 函数配额与源站
const MIN_SECONDS = 30
const MAX_SECONDS = 86400

/**
 * 把用户输入解析成秒数。
 * 返回 { ok: true, seconds } 或 { ok: false, reason }；空输入按默认值处理。
 */
function parseIntervalSeconds(raw) {
    const text = String(raw ?? '').trim()
    if (text === '') return { ok: true, seconds: DEFAULT_SECONDS }
    if (!/^\d+$/.test(text)) return { ok: false, reason: '请输入非负整数秒数，0 表示不轮询' }
    const seconds = Number.parseInt(text, 10)
    if (seconds === 0) return { ok: true, seconds: 0 }
    if (seconds < MIN_SECONDS) return { ok: false, reason: `间隔不能小于 ${MIN_SECONDS} 秒` }
    if (seconds > MAX_SECONDS) return { ok: false, reason: `间隔不能大于 ${MAX_SECONDS} 秒` }
    return { ok: true, seconds }
}

/** 把秒数转成菜单/提示里用的说法 */
function describeIntervalSeconds(seconds) {
    if (!seconds) return '不轮询'
    if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`
    if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`
    return `每 ${seconds} 秒`
}

class ScheduleRefresh {
    constructor({ store, fetchSchedule, isPushDisabled, log }) {
        this.store = store
        this.fetchSchedule = fetchSchedule
        this.isPushDisabled = isPushDisabled
        this.log = typeof log === 'function' ? log : () => {}
        this.timer = null
        this.runningSeconds = 0
    }

    /** 读取已保存的间隔；值被外部改坏时退回默认值而不是抛错 */
    savedSeconds() {
        const parsed = parseIntervalSeconds(this.store.get(STORE_KEY, String(DEFAULT_SECONDS)))
        return parsed.ok ? parsed.seconds : DEFAULT_SECONDS
    }

    isRunning() {
        return this.timer !== null
    }

    /** 保存新的间隔（秒）并立即生效；非法值不改动已有配置 */
    setSeconds(seconds) {
        const parsed = parseIntervalSeconds(String(seconds))
        if (!parsed.ok) return parsed
        this.store.set(STORE_KEY, String(parsed.seconds))
        this.apply()
        return parsed
    }

    /**
     * 按当前配置与推送状态启动/停止定时器。
     * 每次拉取成功后都会调用：服务端是否支持推送是拿到响应之后才知道的。
     */
    apply() {
        const seconds = this.savedSeconds()
        if (seconds <= 0 || !this.isPushDisabled()) {
            this.stop()
            return false
        }
        if (this.isRunning() && this.runningSeconds === seconds) return true
        this.start(seconds)
        return true
    }

    start(seconds) {
        this.stop()
        this.runningSeconds = seconds
        this.timer = setInterval(() => this.tick(), seconds * 1000)
        // 定时器不应阻止进程退出
        if (typeof this.timer?.unref === 'function') this.timer.unref()
        this.log(`[ScheduleRefresh] 已启动定时拉取，${describeIntervalSeconds(seconds)}`)
    }

    tick() {
        // 推送恢复后立刻让位给推送，不必等下一次配置变更
        if (!this.isPushDisabled()) {
            this.stop()
            return
        }
        this.log(`[ScheduleRefresh] 定时拉取课表（${describeIntervalSeconds(this.runningSeconds)}）`)
        try {
            this.fetchSchedule()
        } catch (error) {
            // 单次触发失败不影响后续轮询；失败重试由拉取自身的退避负责
            this.log(`[ScheduleRefresh] 拉取触发失败: ${error?.message || error}`)
        }
    }

    stop() {
        if (this.timer === null) return
        clearInterval(this.timer)
        this.timer = null
        this.runningSeconds = 0
        this.log('[ScheduleRefresh] 已停止定时拉取')
    }
}

module.exports = {
    ScheduleRefresh,
    parseIntervalSeconds,
    describeIntervalSeconds,
    STORE_KEY,
    DEFAULT_SECONDS,
    MIN_SECONDS,
    MAX_SECONDS,
}
