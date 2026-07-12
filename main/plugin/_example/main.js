// 示例插件 - 主进程入口

module.exports = {
    onInit() {
        console.log('[example-plugin] 初始化');
    },
    onConfigLoad(config) {
        console.log('[example-plugin] 配置加载');
        return config;
    },
    onTick() {
        // 每秒执行
    },
};
