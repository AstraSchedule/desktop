'use strict'

// 自动客户端配置调度器：服务端下发的 client_config_rules 由客户端本地求值，
// 20 秒一个 tick + 规则更新时立即重算，保证幂等（离线/漏 tick 都不会错状态）。

const conditions = require('./conditions')

const SETTING_KEYS = ['isWindowAlwaysOnTop', 'isDuringClassHidden', 'isAlwaysMinimized', 'isDuringClassCountdown']
// 字符串类设置项：与布尔开关共用同一套「优先级 + 作用域具体度」选优，
// 但取值是文案而不是 true/false（结束横幅按条件换文案就靠它）
const TEXT_SETTING_KEYS = ['end_banner_text']

// 无规则生效时使用的兜底值（与托盘菜单里的默认值保持一致）
const DEFAULT_SETTINGS = {
    isWindowAlwaysOnTop: true,
    isDuringClassHidden: true,
    isAlwaysMinimized: false,
    isDuringClassCountdown: true,
    end_banner_text: ''
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

// 「没课」作息表名由管理端默认模板定义，与渲染进程的 NO_CLASS_TIMETABLE 保持一致
const NO_CLASS_TIMETABLE = '没课'

function buildContext(now) {
    const config = scheduleConfig || {}
    const daily = Array.isArray(config.daily_class) ? config.daily_class[now.getDay()] : null
    const timetableName = daily?.timetable
    const table = timetableName ? config.timetable?.[timetableName] : null
    const periods = conditions.periodRanges(table)
    // 「明天没课」条件要用到明天的课表：服务端下发的 daily_class 恒为 7 项且按 getDay() 排布
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const tomorrowDaily = Array.isArray(config.daily_class) ? config.daily_class[tomorrow.getDay()] : null
    const tomorrowHasClass = !!tomorrowDaily && tomorrowDaily.timetable !== NO_CLASS_TIMETABLE
    return {
        now,
        termStart: String(config.term_start || ''),
        appStart,
        periods,
        periodOrder: conditions.sortedPeriodStarts(periods),
        tomorrowHasClass
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
    for (const key of TEXT_SETTING_KEYS) {
        if (typeof settings[key] !== 'string') continue
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
    for (const key of [...SETTING_KEYS, ...TEXT_SETTING_KEYS]) {
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
    TEXT_SETTING_KEYS,
    DEFAULT_SETTINGS
}
