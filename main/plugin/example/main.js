// class-alert 示例插件 - 主进程入口
// 演示全部 7 个生命周期钩子

module.exports = {
    /**
     * 插件加载后立即调用，用于初始化状态
     */
    onInit() {
        this._startTime = Date.now();
        this._tickCount = 0;
        console.log('[class-alert] 插件已加载');
    },

    /**
     * 配置加载时调用，支持返回值管道
     * 返回值会作为下一个插件的输入，不返回则透传原值
     * @param {object} config - 课表配置
     * @returns {object} 处理后的配置
     */
    onConfigLoad(config) {
        const periods = config?.daily_class?.length ?? 0;
        console.log(`[class-alert] 配置已加载，共 ${periods} 天课表`);
        return config;
    },

    /**
     * 渲染进程入口加载时调用
     */
    onRender() {
        console.log('[class-alert] 渲染进程就绪');
    },

    /**
     * 每秒轮询调用，可做定时逻辑
     */
    onTick() {
        this._tickCount++;
        // 每 60 秒输出一次运行时长
        if (this._tickCount % 60 === 0) {
            const up = Math.floor((Date.now() - this._startTime) / 1000);
            console.log(`[class-alert] 运行中，已 tick ${this._tickCount} 次， uptime ${up}s`);
        }
    },

    /**
     * 课表时间状态变化时调用（上课/课间切换）
     * @param {object} info
     * @param {string} info.state       - 'inClass' | 'break'
     * @param {string} info.currentTime - HH:MM:SS
     * @param {object} info.currentTimeSlot - 当前时间段
     * @param {object|null} info.nextTimeSlot - 下一个时间段
     * @param {string|null} info.previousState - 上一个状态
     */
    onTimeStateChange(info) {
        const label = info.state === 'inClass' ? '上课' : '课间';
        const prev = info.previousState
            ? (info.previousState === 'inClass' ? '上课' : '课间')
            : '无';
        console.log(`[class-alert] ${prev} → ${label} @ ${info.currentTime}`);
    },

    /**
     * 定时提醒触发时调用，需在 plugin.json 的 reminders 中声明
     * @param {object} reminder
     * @param {string} reminder.type          - 'class' | 'break'
     * @param {number} reminder.offset        - 偏移秒数（负=提前，正=延后）
     * @param {number} [reminder.classIndex]  - 课程索引
     * @param {string} [reminder.className]   - 课程名称
     * @param {string} [reminder.scheduledTime] - HH:MM
     * @param {string} [reminder.currentTime]   - HH:MM:SS
     */
    onScheduleReminder(reminder) {
        const dir = reminder.offset > 0 ? '后' : '前';
        const abs = Math.abs(reminder.offset);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        let t = '';
        if (m) t += `${m}分`;
        if (s) t += `${s}秒`;
        const name = reminder.className || '课程';
        console.log(`[class-alert] 提醒: ${name} 将在 ${t}${dir} ${reminder.type === 'class' ? '开始' : '结束'}`);
    },

    /**
     * 插件卸载前调用，用于清理资源
     */
    onDestroy() {
        console.log(`[class-alert] 插件即将卸载，共 tick ${this._tickCount} 次`);
    },
};
