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

const MAX_SEARCH_DAYS = 366

// 严格十进制解析：parseInt 会接受 "5x" 这类带尾随字符的输入，导致非法表达式被静默当作合法值
const INT_RE = /^\d+$/

function toInt(raw) {
    if (!INT_RE.test(raw)) return null
    return Number.parseInt(raw, 10)
}

function parseField(raw, min, max) {
    const field = { any: false, values: new Set() }
    if (raw === '*') {
        field.any = true
        return field
    }
    for (const part of raw.split(',')) {
        if (part === '') return null
        let step = 1
        let body = part
        const slash = part.indexOf('/')
        if (slash >= 0) {
            const parsedStep = toInt(part.slice(slash + 1))
            if (parsedStep === null || parsedStep <= 0) return null
            step = parsedStep
            body = part.slice(0, slash)
        }
        let lo = min
        let hi = max
        if (body !== '*') {
            const bounds = body.split('-')
            if (bounds.length > 2) return null
            lo = toInt(bounds[0])
            if (lo === null) return null
            hi = lo
            if (bounds.length === 2) {
                hi = toInt(bounds[1])
                if (hi === null) return null
            }
        }
        if (lo < min || hi > max || lo > hi) return null
        for (let v = lo; v <= hi; v += step) field.values.add(v)
    }
    return field
}

function parseCron(expr) {
    const fields = String(expr || '').trim().split(/\s+/)
    if (fields.length !== 5) return null
    const spec = {}
    const names = ['minute', 'hour', 'day', 'month', 'weekday']
    for (let i = 0; i < 5; i++) {
        const parsed = parseField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1])
        if (!parsed) return null
        spec[names[i]] = parsed
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

function atMinute(day, hour, minute) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0)
}

// 返回不晚于 date 的上一次命中时刻（秒被截断到整分），找不到返回 null
function prev(spec, date) {
    const limit = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), 0, 0)
    let day = startOfDay(limit)
    for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
        if (matchDay(spec, day)) {
            const onLimitDay = i === 0
            const startHour = onLimitDay ? limit.getHours() : 23
            for (let hour = startHour; hour >= 0; hour--) {
                if (!fieldMatch(spec.hour, hour)) continue
                const maxMinute = onLimitDay && hour === limit.getHours() ? limit.getMinutes() : 59
                for (let minute = maxMinute; minute >= 0; minute--) {
                    if (!fieldMatch(spec.minute, minute)) continue
                    const candidate = atMinute(day, hour, minute)
                    if (candidate.getTime() <= limit.getTime()) return candidate
                }
            }
        }
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 0, 0, 0, 0)
    }
    return null
}

// 返回严格晚于 date 的下一次命中时刻，找不到返回 null
function next(spec, date) {
    const limit = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), 0, 0)
    let day = startOfDay(limit)
    for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
        if (matchDay(spec, day)) {
            for (let hour = 0; hour <= 23; hour++) {
                if (!fieldMatch(spec.hour, hour)) continue
                for (let minute = 0; minute <= 59; minute++) {
                    if (!fieldMatch(spec.minute, minute)) continue
                    const candidate = atMinute(day, hour, minute)
                    if (i > 0 || candidate.getTime() > limit.getTime()) return candidate
                }
            }
        }
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0)
    }
    return null
}

module.exports = { parseCron, matches, prev, next }
