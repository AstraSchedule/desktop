const { TimeState, createTimeStateChangeInfo, createScheduleReminder } = require('./lifecycle');

/**
 * 将 HH:MM 转换为秒数（当天内）
 * @param {string} time - 格式 HH:MM
 * @returns {number}
 */
function timeToSeconds(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 3600 + m * 60;
}

/**
 * 将 HH:MM:SS 转换为秒数（当天内）
 * @param {string} time - 格式 HH:MM:SS
 * @returns {number}
 */
function fullTimeToSeconds(time) {
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

/**
 * 获取当前 HH:MM:SS 字符串
 * @returns {string}
 */
function getCurrentTimeStr() {
    const now = new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, '0'))
        .join(':');
}

/**
 * 解析时间段，返回 [{ start, end, value, timetableName }]
 * @param {object} timetable - scheduleConfig.timetable
 * @returns {Array}
 */
function parseTimetable(timetable) {
    const slots = [];
    for (const [timetableName, timeMap] of Object.entries(timetable)) {
        for (const [range, value] of Object.entries(timeMap)) {
            const [startStr, endStr] = range.split('-');
            // endTime 的 HH:MM 实际有效范围到 HH:MM:59
            // 所以 endSeconds + 60 覆盖完整分钟
            slots.push({
                start: timeToSeconds(startStr),
                end: timeToSeconds(endStr) + 59,
                value,
                timetableName,
                startStr,
                endStr,
            });
        }
    }
    return slots;
}

/**
 * 获取当天的日课表配置
 * @param {object} scheduleConfig
 * @returns {{ classList: Array, timetableName: string }|null}
 */
function getTodayConfig(scheduleConfig) {
    const dayIndex = new Date().getDay(); // 0=周日
    const dayConfig = scheduleConfig.daily_class && scheduleConfig.daily_class[dayIndex];
    if (!dayConfig) return null;
    return {
        classList: dayConfig.classList,
        timetableName: dayConfig.timetable,
    };
}

/**
 * 获取课程名称
 * @param {string} shortName
 * @param {object} scheduleConfig
 * @returns {string}
 */
function getClassName(shortName, scheduleConfig) {
    // 处理 @ 下角标格式：'自@语' -> '语'（去角标取简称用于显示）
    const baseName = shortName.split('@')[0];
    return (scheduleConfig.subject_name && scheduleConfig.subject_name[baseName]) || baseName;
}

/**
 * TimeDetector - 时间状态检测器
 * 定时检测当前课表状态，触发状态变化和提醒事件
 */
class TimeDetector {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        /** @type {NodeJS.Timeout|null} */
        this.timer = null;
        /** @type {string|null} 上一次检测的状态 */
        this.lastState = null;
        /** @type {number|null} 上一次检测的时间槽索引 */
        this.lastSlotIndex = null;
        /** @type {object|null} 当前缓存的 scheduleConfig */
        this.configCache = null;
    }

    /**
     * 检测当前时间状态
     * @param {object} scheduleConfig
     * @returns {{ state: string, currentSlot: object|null, nextSlot: object|null, nextSlotIndex: number|null }}
     */
    detectCurrentState(scheduleConfig) {
        const now = Date.now();
        const nowSec = Math.floor(now / 1000) % 86400;
        const today = getTodayConfig(scheduleConfig);
        const timetable = scheduleConfig.timetable;

        if (!today || !timetable) {
            return { state: TimeState.BREAK, currentSlot: null, nextSlot: null, nextSlotIndex: null };
        }

        const timeMap = timetable[today.timetableName];
        if (!timeMap) {
            return { state: TimeState.BREAK, currentSlot: null, nextSlot: null, nextSlotIndex: null };
        }

        // 解析所有时间段
        const entries = Object.entries(timeMap);
        let currentSlot = null;
        let currentIndex = -1;
        let nextSlot = null;
        let nextIndex = -1;

        for (let i = 0; i < entries.length; i++) {
            const [range, value] = entries[i];
            const [startStr, endStr] = range.split('-');
            const startSec = timeToSeconds(startStr);
            const endSec = timeToSeconds(endStr) + 59;

            if (nowSec >= startSec && nowSec <= endSec) {
                currentSlot = { range, value, index: i };
                currentIndex = i;
            }
        }

        // 找到当前时间段后面的第一个时间段作为 nextSlot
        if (currentIndex >= 0 && currentIndex < entries.length - 1) {
            const [nextRange, nextValue] = entries[currentIndex + 1];
            const [nextStartStr, nextEndStr] = nextRange.split('-');
            nextSlot = {
                range: nextRange,
                value: nextValue,
                index: currentIndex + 1,
                startStr: nextStartStr,
                endStr: nextEndStr,
            };
            nextIndex = currentIndex + 1;
        }

        // 判断当前状态：value 为数字 -> inClass，字符串 -> break
        let state = TimeState.BREAK;
        let classIndex = null;
        let className = null;

        if (currentSlot && typeof currentSlot.value === 'number') {
            state = TimeState.IN_CLASS;
            classIndex = currentSlot.value;
            // 从 daily_class 中取课程简称，再映射全名
            const shortName = today.classList[classIndex];
            if (shortName) {
                className = getClassName(shortName, scheduleConfig);
            }
        }

        // 构建当前时间段详情
        const currentTimeSlot = currentSlot ? {
            type: state === TimeState.IN_CLASS ? 'class' : 'break',
            index: currentIndex,
            className,
            startTime: currentSlot.range.split('-')[0],
            endTime: currentSlot.range.split('-')[1],
            label: state === TimeState.BREAK && typeof currentSlot.value === 'string'
                ? currentSlot.value
                : (scheduleConfig.break_label || '课间'),
        } : null;

        // 构建下一个时间段详情
        const nextTimeSlotInfo = nextSlot ? {
            type: typeof nextSlot.value === 'number' ? 'class' : 'break',
            index: nextSlot.index,
            className: typeof nextSlot.value === 'number'
                ? getClassName(today.classList[nextSlot.value] || '', scheduleConfig)
                : null,
            startTime: nextSlot.startStr,
            endTime: nextSlot.endStr,
            label: typeof nextSlot.value === 'string'
                ? nextSlot.value
                : (scheduleConfig.break_label || '课间'),
        } : null;

        return {
            state,
            currentSlot: currentTimeSlot,
            nextSlot: nextTimeSlotInfo,
            nextSlotIndex: nextIndex,
            classIndex,
            rawCurrentIndex: currentIndex,
        };
    }

    /**
     * 检测状态变化并触发事件
     * @param {object} scheduleConfig
     */
    checkAndTrigger(scheduleConfig) {
        const result = this.detectCurrentState(scheduleConfig);
        const { state, currentSlot, nextSlot, rawCurrentIndex } = result;

        // 状态变化或时间段变化时触发
        const slotChanged = rawCurrentIndex !== this.lastSlotIndex;
        const stateChanged = state !== this.lastState;

        if (slotChanged || stateChanged) {
            const info = createTimeStateChangeInfo({
                state,
                currentTimeSlot: currentSlot,
                currentTime: getCurrentTimeStr(),
                nextTimeSlot: nextSlot,
                previousState: this.lastState,
            });

            this.lastState = state;
            this.lastSlotIndex = rawCurrentIndex;
            this.pluginManager.triggerTimeStateChange(info);
        }
    }

    /**
     * 检查课程提醒
     * @param {object} scheduleConfig
     * @param {string} currentState - 当前状态
     */
    checkReminders(scheduleConfig, currentState) {
        const reminders = this.pluginManager.getAllReminders();
        if (reminders.length === 0) return;

        const now = Date.now();
        const nowSec = Math.floor(now / 1000) % 86400;
        const today = getTodayConfig(scheduleConfig);
        const timetable = scheduleConfig.timetable;

        if (!today || !timetable) return;

        const timeMap = timetable[today.timetableName];
        if (!timeMap) return;

        const entries = Object.entries(timeMap);

        for (const reminder of reminders) {
            for (let i = 0; i < entries.length; i++) {
                const [range, value] = entries[i];
                const [startStr] = range.split('-');
                const startSec = timeToSeconds(startStr);

                // 偏移量匹配：当前时间 = 开始时间 + offset
                const triggerSec = startSec + reminder.offset;
                // 允许 1 秒容差（1 秒轮询）
                if (Math.abs(nowSec - triggerSec) <= 1) {
                    const type = typeof value === 'number' ? 'class' : 'break';
                    if (reminder.type === type) {
                        let className = null;
                        if (typeof value === 'number') {
                            const shortName = today.classList[value];
                            if (shortName) {
                                className = getClassName(shortName, scheduleConfig);
                            }
                        }

                        const reminderInfo = createScheduleReminder({
                            type,
                            offset: reminder.offset,
                            classIndex: typeof value === 'number' ? value : undefined,
                            className,
                            scheduledTime: startStr,
                            currentTime: getCurrentTimeStr(),
                        });

                        this.pluginManager.triggerScheduleReminder(reminderInfo);
                    }
                }
            }
        }
    }

    /**
     * 开始检测
     * @param {object} scheduleConfig
     */
    start(scheduleConfig) {
        this.stop();
        this.configCache = scheduleConfig;
        this.lastState = null;
        this.lastSlotIndex = null;

        // 立即检测一次
        this._tick();

        // 每秒轮询
        this.timer = setInterval(() => this._tick(), 1000);
    }

    /**
     * 停止检测
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.lastState = null;
        this.lastSlotIndex = null;
    }

    /**
     * 更新配置（配置热更新时调用）
     * @param {object} scheduleConfig
     */
    updateConfig(scheduleConfig) {
        this.configCache = scheduleConfig;
    }

    /**
     * 单次检测
     */
    _tick() {
        if (!this.configCache) return;
        this.checkAndTrigger(this.configCache);
        this.checkReminders(this.configCache, this.lastState);
    }
}

module.exports = { TimeDetector, parseTimetable, timeToSeconds, getCurrentTimeStr };
