// Hello World 示例插件 - 演示生命周期钩子

module.exports = {
    /**
     * 插件初始化时调用
     */
    onInit() {
        console.log('[hello-world] 插件已加载');
    },

    /**
     * 插件卸载前调用
     */
    onDestroy() {
        console.log('[hello-world] 插件即将卸载');
    },

    /**
     * 时间状态变化时调用（上课/课间切换）
     * @param {object} info - 时间状态变化信息
     * @param {string} info.state - 当前状态 ('inClass' | 'break')
     * @param {string} info.currentTime - 当前时间 HH:MM:SS
     * @param {object} info.currentTimeSlot - 当前时间段信息
     * @param {string|null} info.previousState - 上一个状态
     */
    onTimeStateChange(info) {
        const stateLabel = info.state === 'inClass' ? '上课中' : '课间休息';
        console.log(`[hello-world] 状态变化: ${stateLabel} (${info.currentTime})`);
    },
};
