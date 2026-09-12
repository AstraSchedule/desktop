'use strict'

// 自动客户端配置调度器：服务端下发的 client_config_rules 由客户端本地求值，
// 20 秒一个 tick + 规则更新时立即重算，保证幂等（离线/漏 tick 都不会错状态）。

const conditions = require('./conditions')

const SETTING_KEYS = ['isWindowAlwaysOnTop', 'isDuringClassHidden', 'isAlwaysMinimized', 'isDuringClassCountdown']

// 无规则生效时使用的兜底值（与托盘菜单里的默认值保持一致）
const DEFAULT_SETTINGS = {
    isWindowAlwaysOnTop: true,
    isDuringClassHidden: true,
    isAlwaysMinimized: false,
    isDuringClassCountdown: true
}

const TICK_MS = 20000

let deps = null
let rules = []
let scheduleConfig = null
let timer = null
let applied = {}
let controlled = {}
const appStart = new Date()

function init(options) {
    deps = options
    if (!timer) {
        timer = setInterval(() => recompute(), TICK_MS)
        if (typeof timer.unref === 'function') timer.unref()
    }
}

function dispose() {
    if (timer) {
        clearInterval(timer)
        timer = null
    }
}

function updateFromSchedule(config) {
    scheduleConfig = config || null
    rules = Array.isArray(scheduleConfig?.client_config_rules) ? scheduleConfig.client_config_rules : []
    recompute(true)
}

function buildContext(now) {
    const config = scheduleConfig || {}
    const daily = Array.isArray(config.daily_class) ? config.daily_class[now.getDay()] : null
    const timetableName = daily?.timetable
    const table = timetableName ? config.timetable?.[timetableName] : null
    const periods = conditions.periodRanges(table)
    return {
        now,
        termStart: String(config.term_start || ''),
        appStart,
        periods,
        periodOrder: conditions.sortedPeriodStarts(periods)
    }
}

// 每个配置项各自选出胜出规则：优先级高者胜，同优先级取作用域更具体者
function resolveSettings(ctx) {
    const winners = {}
    for (const rule of rules) {
        const settings = rule?.settings
        if (!settings || typeof settings !== 'object') continue
        let active = false
        try {
            active = conditions.isActive(rule.when, ctx)
        } catch (e) {
            console.error('[ClientConfig] 条件求值失败', rule?.taskId, e)
        }
        if (!active) continue
        for (const key of SETTING_KEYS) {
            if (typeof settings[key] !== 'boolean') continue
            const priority = Number(rule.priority) || 0
            const specificity = Number(rule.specificity) || 0
            const current = winners[key]
            const better = !current ||
                priority > current.priority ||
                (priority === current.priority && specificity >= current.specificity)
            if (better) winners[key] = { value: settings[key], priority, specificity }
        }
    }
    return winners
}

function recompute(force) {
    if (!deps) return
    const ctx = buildContext(new Date())
    const winners = resolveSettings(ctx)
    for (const key of SETTING_KEYS) {
        const winner = winners[key]
        controlled[key] = !!winner
        const value = winner ? winner.value : deps.getLocalSetting(key, DEFAULT_SETTINGS[key])
        if (!force && applied[key] === value) continue
        applied[key] = value
        try {
            deps.applySetting(key, value, !!winner)
        } catch (e) {
            console.error('[ClientConfig] 应用配置失败:', key, e)
        }
    }
}

// effective 返回某个配置项当前的实际值（供托盘勾选状态显示）
function effective(key, fallback) {
    if (controlled[key] && typeof applied[key] === 'boolean') return applied[key]
    return fallback
}

function isControlled(key) {
    return !!controlled[key]
}

module.exports = {
    init,
    dispose,
    updateFromSchedule,
    recompute,
    effective,
    isControlled,
    SETTING_KEYS,
    DEFAULT_SETTINGS
}
