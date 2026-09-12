'use strict'

// 最小 5 字段 cron 实现（分 时 日 月 周），与服务端 service/cron.go 保持一致的语义：
// 支持 "*"、单值、范围 "a-b"、步长 "*/n" 与 "a-b/n"、逗号列表；
// 星期 0 表示周日（与 Date#getDay 一致）；日与周同时受限时按标准 cron 的「或」语义。

const FIELD_RANGES = [
    [0, 59], // 分
    [0, 23], // 时
    [1, 31], // 日
    [1, 12], // 月
    [0, 6]   // 周
]

// 搜索窗口取 8 年：2 月 29 日这类条件相邻两次命中可能相隔 8 年
//（如 2096-02-29 → 2104-02-29），按天推进即可覆盖，开销可忽略。
const MAX_SEARCH_DAYS = 366 * 8

// 严格十进制解析：parseInt 会接受 "5x" 这类带尾随字符的输入，导致非法表达式被静默当作合法值
const INT_RE = /^\d+$/

const FIELD_NAMES = ['minute', 'hour', 'day', 'month', 'weekday']

function toInt(raw) {
    if (!INT_RE.test(raw)) return null
    return Number.parseInt(raw, 10)
}

// parseBounds 解析 "a"、"a-b"、"*" 三种取值范围，非法返回 null
function parseBounds(body, min, max) {
    if (body === '*') return { lo: min, hi: max }
    const bounds = body.split('-')
    if (bounds.length > 2) return null
    const lo = toInt(bounds[0])
    if (lo === null) return null
    if (bounds.length === 1) return { lo, hi: lo }
    const hi = toInt(bounds[1])
    if (hi === null) return null
    return { lo, hi }
}

// parseTerm 解析逗号列表中的一项，返回 { step, lo, hi }
function parseTerm(part, min, max) {
    if (part === '') return null
    const slash = part.indexOf('/')
    let step = 1
    let body = part
    if (slash >= 0) {
        const parsedStep = toInt(part.slice(slash + 1))
        if (parsedStep === null || parsedStep <= 0) return null
        step = parsedStep
        body = part.slice(0, slash)
    }
    const bounds = parseBounds(body, min, max)
    if (!bounds) return null
    if (bounds.lo < min || bounds.hi > max || bounds.lo > bounds.hi) return null
    return { step, lo: bounds.lo, hi: bounds.hi }
}

function parseField(raw, min, max) {
    if (raw === '*') return { any: true, values: new Set() }
    const field = { any: false, values: new Set() }
    for (const part of raw.split(',')) {
        const term = parseTerm(part, min, max)
        if (!term) return null
        for (let v = term.lo; v <= term.hi; v += term.step) field.values.add(v)
    }
    return field
}

function parseCron(expr) {
    const fields = String(expr || '').trim().split(/\s+/)
    if (fields.length !== 5) return null
    const spec = {}
    for (let i = 0; i < 5; i++) {
        const parsed = parseField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1])
        if (!parsed) return null
        spec[FIELD_NAMES[i]] = parsed
    }
    return spec
}

function fieldMatch(field, value) {
    return field.any || field.values.has(value)
}

function matchDay(spec, date) {
    if (!fieldMatch(spec.month, date.getMonth() + 1)) return false
    const dayOk = fieldMatch(spec.day, date.getDate())
    const weekdayOk = fieldMatch(spec.weekday, date.getDay())
    if (spec.day.any && spec.weekday.any) return true
    if (spec.day.any) return weekdayOk
    if (spec.weekday.any) return dayOk
    return dayOk || weekdayOk
}

function matches(spec, date) {
    return matchDay(spec, date) && fieldMatch(spec.hour, date.getHours()) && fieldMatch(spec.minute, date.getMinutes())
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function truncateToMinute(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), 0, 0)
}

function atMinute(day, hour, minute) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0)
}

function shiftDay(day, delta) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + delta, 0, 0, 0, 0)
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// lastMatchingMinute 在 [0, maxMinute] 内从大到小找第一个命中的分钟，找不到返回 null
function lastMatchingMinute(field, maxMinute) {
    for (let minute = maxMinute; minute >= 0; minute--) {
        if (fieldMatch(field, minute)) return minute
    }
    return null
}

// firstMatchingMinute 在 [0, 59] 内从小到大找第一个命中的分钟，找不到返回 null
function firstMatchingMinute(field) {
    for (let minute = 0; minute <= 59; minute++) {
        if (fieldMatch(field, minute)) return minute
    }
    return null
}

// lastHitOfDay 找出该日不晚于 limit 的最后一次命中
function lastHitOfDay(spec, day, limit) {
    const onLimitDay = sameDay(day, limit)
    const startHour = onLimitDay ? limit.getHours() : 23
    for (let hour = startHour; hour >= 0; hour--) {
        if (!fieldMatch(spec.hour, hour)) continue
        const maxMinute = onLimitDay && hour === limit.getHours() ? limit.getMinutes() : 59
        const minute = lastMatchingMinute(spec.minute, maxMinute)
        if (minute === null) continue
        const candidate = atMinute(day, hour, minute)
        if (candidate.getTime() <= limit.getTime()) return candidate
    }
    return null
}

// firstHitOfDay 找出该日严格晚于 limit 的第一次命中；strictlyAfterDay 为真时整天都算
function firstHitOfDay(spec, day, limit, strictlyAfterDay) {
    for (let hour = 0; hour <= 23; hour++) {
        if (!fieldMatch(spec.hour, hour)) continue
        const minute = firstMatchingMinute(spec.minute)
        if (minute === null) continue
        const candidate = atMinute(day, hour, minute)
        if (strictlyAfterDay || candidate.getTime() > limit.getTime()) return candidate
    }
    return null
}

// 返回不晚于 date 的上一次命中时刻（秒被截断到整分），找不到返回 null
function prev(spec, date) {
    const limit = truncateToMinute(date)
    let day = startOfDay(limit)
    for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
        if (matchDay(spec, day)) {
            const hit = lastHitOfDay(spec, day, limit)
            if (hit) return hit
        }
        day = shiftDay(day, -1)
    }
    return null
}

// 返回严格晚于 date 的下一次命中时刻，找不到返回 null
function next(spec, date) {
    const limit = truncateToMinute(date)
    let day = startOfDay(limit)
    for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
        if (matchDay(spec, day)) {
            const hit = firstHitOfDay(spec, day, limit, i > 0)
            if (hit) return hit
        }
        day = shiftDay(day, 1)
    }
    return null
}

module.exports = { parseCron, matches, prev, next }
