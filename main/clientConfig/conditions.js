'use strict'

// 生效条件求值：与服务端 service/autorun.go 的条件语义保持一致，
// 但时序（时刻事件）由客户端本地判定——服务端只按生效域过滤规则。

const cron = require('./cron')

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDateOnly(value) {
    const m = DATE_RE.exec(String(value || '').trim())
    if (!m) return null
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    if (Number.isNaN(date.getTime())) return null
    return date
}

function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function mondayOf(date) {
    const d = dateOnly(date)
    const daysSinceMonday = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - daysSinceMonday)
    return d
}

// 学期周次：开学日期所在周为第 1 周，按周一切分（与 service.CalcWeekNumber 一致）
function calcWeekNumber(termStart, date) {
    const start = parseDateOnly(termStart)
    if (!start) return 1
    const days = Math.round((mondayOf(date).getTime() - mondayOf(start).getTime()) / 86400000)
    if (days < 0) return 1
    return Math.floor(days / 7) + 1
}

function withinBounds(when, now) {
    const today = dateOnly(now)
    if (when.kind === 'date' || !when.kind) {
        const day = parseDateOnly(when.date)
        return !!day && day.getTime() === today.getTime()
    }
    const start = parseDateOnly(when.startDate)
    if (start && today.getTime() < start.getTime()) return false
    const end = parseDateOnly(when.endDate)
    if (end && today.getTime() > end.getTime()) return false
    return true
}

function weekdayAllowed(when, now) {
    const days = Array.isArray(when.weekdays) ? when.weekdays : []
    if (days.length === 0) return true
    return days.includes(now.getDay())
}

function matchWeekCycle(when, ctx) {
    const every = Number(when.everyWeeks) > 0 ? Number(when.everyWeeks) : 1
    const anchor = String(when.startDate || ctx.termStart || '').trim()
    let offset = Number(when.weekOffset) || 0
    offset = ((offset % every) + every) % every
    if (!anchor) return offset === 0
    const week = calcWeekNumber(anchor, ctx.now)
    return (week - 1) % every === offset
}

function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

// 从作息表配置解析当天各节次的起止分钟数（作息表的结束时间按约定要 +1 分钟）
function periodRanges(periods) {
    const map = new Map()
    if (!periods || typeof periods !== 'object') return map
    for (const [range, value] of Object.entries(periods)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(range).trim())
        if (!match) continue
        const start = Number(match[1]) * 60 + Number(match[2])
        const end = Number(match[3]) * 60 + Number(match[4]) + 1
        map.set(value + 1, { start, end })
    }
    return map
}

function sortedPeriodStarts(ranges) {
    return [...ranges.entries()].sort((a, b) => a[1].start - b[1].start).map(([no]) => no)
}

function eventActive(when, ctx) {
    const event = String(when.event || '')
    if (event === 'startup') {
        return ctx.now.getTime() >= ctx.appStart.getTime()
    }
    const period = Number(when.period) || 0
    if (period <= 0) return false
    const ranges = ctx.periods
    const current = ranges.get(period)
    if (!current) return false
    const nowMinutes = minutesOfDay(ctx.now)
    if (event === 'class_start') {
        return nowMinutes >= current.start && nowMinutes < current.end
    }
    if (event === 'class_end') {
        if (nowMinutes < current.end) return false
        const order = ctx.periodOrder
        const idx = order.indexOf(period)
        const nextNo = idx >= 0 ? order[idx + 1] : undefined
        const next = nextNo === undefined ? null : ranges.get(nextNo)
        return next ? nowMinutes < next.start : true
    }
    return false
}

function cronActive(when, now) {
    const spec = cron.parseCron(when.cron)
    if (!spec) return false
    const start = cron.prev(spec, now)
    if (!start) return false
    const duration = Number(when.duration) || 0
    if (duration > 0) {
        const end = start.getTime() + duration * 60000
        return now.getTime() >= start.getTime() && now.getTime() < end
    }
    const end = cron.next(spec, now)
    const endTime = end ? end.getTime() : start.getTime() + 86400000
    return now.getTime() >= start.getTime() && now.getTime() < endTime
}

// isActive 判断条件在 ctx.now 是否命中
function isActive(when, ctx) {
    if (!when) return true
    const now = ctx.now
    if (!withinBounds(when, now)) return false
    if (!weekdayAllowed(when, now)) return false
    if (Number(when.everyWeeks) > 0 && !matchWeekCycle(when, ctx)) return false
    switch (when.kind) {
        case 'date':
        case 'range':
        case 'weekly':
            return true
        case 'event':
            return eventActive(when, ctx)
        case 'cron':
            return cronActive(when, now)
        default:
            return false
    }
}

module.exports = { isActive, calcWeekNumber, parseDateOnly, periodRanges, sortedPeriodStarts }
