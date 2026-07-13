// class-alert 示例插件 - 渲染进程入口

module.exports = {
    /**
     * 渲染进程就绪时调用，可操作 DOM 或注入 UI
     */
    onRender() {
        console.log('[class-alert] 渲染进程已就绪，可在此注入 UI 元素');
    },
};
