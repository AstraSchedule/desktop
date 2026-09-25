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

function isRuleActive(rule, ctx) {
    try {
        return conditions.isActive(rule.when, ctx)
    } catch (e) {
        console.error('[ClientConfig] 条件求值失败', rule?.taskId, e)
        return false
    }
}

// 优先级高者胜；同优先级取作用域更具体者
function isBetterCandidate(candidate, current) {
    if (!current) return true
    if (candidate.priority !== current.priority) return candidate.priority > current.priority
    return candidate.specificity >= current.specificity
}

function mergeRuleSettings(winners, rule, ctx) {
    const settings = rule?.settings
    if (!settings || typeof settings !== 'object' || !isRuleActive(rule, ctx)) return
    const priority = Number(rule.priority) || 0
    const specificity = Number(rule.specificity) || 0
    for (const key of SETTING_KEYS) {
        if (typeof settings[key] !== 'boolean') continue
        const candidate = { value: settings[key], priority, specificity }
        if (isBetterCandidate(candidate, winners[key])) winners[key] = candidate
    }
}

// 每个配置项各自选出胜出规则
function resolveSettings(ctx) {
    const winners = {}
    for (const rule of rules) mergeRuleSettings(winners, rule, ctx)
    return winners
}

function recompute(force) {
    if (!deps) return
    const ctx = buildContext(new Date())
    const winners = resolveSettings(ctx)
    for (const key of SETTING_KEYS) {
        const winner = winners[key]
        const wasControlled = !!controlled[key]
        const nowControlled = !!winner
        const value = winner ? winner.value : deps.getLocalSetting(key, DEFAULT_SETTINGS[key])
        // 值没变但「是否被规则接管」变了也要重新下发：托盘勾选/置灰依赖 fromRule
        if (!force && applied[key] === value && wasControlled === nowControlled) continue
        try {
            deps.applySetting(key, value, nowControlled)
        } catch (e) {
            // 应用失败时不记录状态，下个 tick 会重试（避免状态与窗口实际不一致）
            if (e?.code === 'RENDERER_NOT_READY') {
                // 启动竞速下渲染进程未就绪属于预期，不是故障：一行 warn 即可，不刷 ERROR 堆栈
                console.warn('[ClientConfig] 渲染进程未就绪，页面加载完成后会重推:', key)
            } else {
                console.error('[ClientConfig] 应用配置失败:', key, e)
            }
            continue
        }
        controlled[key] = nowControlled
        applied[key] = value
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
