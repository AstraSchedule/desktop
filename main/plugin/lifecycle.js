/**
 * 生命周期事件系统
 * 提供时间状态变化和课程提醒的事件数据结构
 */

/** 时间状态常量 */
const TimeState = Object.freeze({
    IN_CLASS: 'inClass',
    BREAK: 'break',
});

/**
 * 创建时间状态变化信息
 * @param {object} params
 * @param {string} params.state - 当前状态 (TimeState.IN_CLASS | TimeState.BREAK)
 * @param {object} params.currentTimeSlot - 当前时间段
 * @param {string} params.currentTime - 当前时间 HH:MM:SS
 * @param {object} [params.nextTimeSlot] - 下一个时间段
 * @param {string} [params.previousState] - 上一个状态
 * @param {number} [params.timestamp] - 时间戳
 * @returns {object} 时间状态变化信息
 */
function createTimeStateChangeInfo({ state, currentTimeSlot, currentTime, nextTimeSlot, previousState, timestamp }) {
    return {
        state,
        currentTimeSlot,
        nextState: state === TimeState.IN_CLASS ? TimeState.BREAK : TimeState.IN_CLASS,
        nextTimeSlot: nextTimeSlot ? {
            type: nextTimeSlot.type,
            index: nextTimeSlot.index,
            className: nextTimeSlot.className || null,
            startTime: nextTimeSlot.startTime,
            endTime: nextTimeSlot.endTime,
            label: nextTimeSlot.label || null,
        } : null,
        currentTime,
        previousState,
        timestamp: timestamp || Date.now(),
    };
}

/**
 * 创建课程提醒信息
 * @param {object} params
 * @param {string} params.type - 类型 (TimeState.IN_CLASS | TimeState.BREAK)
 * @param {number} params.offset - 偏移秒数
 * @param {number} [params.classIndex] - 课程索引
 * @param {string} [params.className] - 课程名称
 * @param {string} [params.scheduledTime] - 预定时间 HH:MM
 * @param {string} [params.currentTime] - 当前时间 HH:MM:SS
 * @returns {object} 课程提醒信息
 */
function createScheduleReminder({ type, offset, classIndex, className, scheduledTime, currentTime }) {
    return {
        type,
        offset,
        classIndex,
        className,
        scheduledTime,
        currentTime,
    };
}

module.exports = {
    TimeState,
    createTimeStateChangeInfo,
    createScheduleReminder,
};
