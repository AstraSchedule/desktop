// 提醒示例插件 - 演示课程提醒功能

module.exports = {
    /**
     * 课程提醒触发时调用
     * @param {object} reminder - 提醒信息
     * @param {string} reminder.type - 类型 ('class' | 'break')
     * @param {number} reminder.offset - 偏移秒数
     * @param {number} [reminder.classIndex] - 课程索引
     * @param {string} [reminder.className] - 课程名称
     * @param {string} [reminder.scheduledTime] - 预定时间 HH:MM
     * @param {string} [reminder.currentTime] - 当前时间 HH:MM:SS
     */
    onScheduleReminder(reminder) {
        const typeLabel = reminder.type === 'class' ? '即将上课' : '即将下课';
        const offsetSeconds = Math.abs(reminder.offset);
        const minutes = Math.floor(offsetSeconds / 60);
        const seconds = offsetSeconds % 60;

        let timeStr = '';
        if (minutes > 0) timeStr += `${minutes}分钟`;
        if (seconds > 0) timeStr += `${seconds}秒`;

        const direction = reminder.offset > 0 ? '后' : '前';

        console.log(`[reminder] ${reminder.className || '课程'}: ${typeLabel}${timeStr}${direction}`);
    },
};
