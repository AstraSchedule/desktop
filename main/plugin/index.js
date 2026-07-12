const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./loader');
const { TimeState, createTimeStateChangeInfo, createScheduleReminder } = require('./lifecycle');
const { TimeDetector } = require('./time-detector');

/**
 * 插件管理器
 */
class PluginManager {
    constructor() {
        /** @type {Map<string, object>} name -> pluginInfo */
        this.plugins = new Map();
        this.pluginsDir = null;
        /** @type {string} 当前时间状态 */
        this.currentState = null;
        /** @type {Set<Function>} 状态变化监听器 */
        this.stateChangeListeners = new Set();
        /** @type {TimeDetector} 时间状态检测器 */
        this.timeDetector = new TimeDetector(this);
    }

    /**
     * 初始化插件管理器，扫描插件目录
     * @param {string} pluginsDir - 插件根目录
     */
    init(pluginsDir) {
        this.pluginsDir = pluginsDir;

        if (!fs.existsSync(pluginsDir)) {
            fs.mkdirSync(pluginsDir, { recursive: true });
            console.log(`[Plugin] 插件目录已创建: ${pluginsDir}`);
            return;
        }

        this.scanPlugins();
    }

    /**
     * 扫描插件目录，加载所有合法插件
     */
    scanPlugins() {
        if (!this.pluginsDir) return;

        // ponytail: 重新扫描会丢失所有运行时状态（enable/disable），目前可以接受
        this.plugins.clear();

        // 同步 I/O：启动时扫描一次，性能影响可忽略
        let entries;
        try {
            entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        } catch (err) {
            console.error(`[Plugin] 读取插件目录失败: ${err.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // 跳过以 _ 或 . 开头的目录（示例、临时文件等）
            if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
                continue;
            }

            const pluginPath = path.join(this.pluginsDir, entry.name);
            const pluginInfo = loadPlugin(pluginPath);

            if (pluginInfo) {
                if (this.plugins.has(pluginInfo.name)) {
                    console.warn(`[Plugin] 插件名称冲突: "${pluginInfo.name}"，跳过 ${entry.name}（已在 ${this.plugins.get(pluginInfo.name).path} 中加载）`);
                    continue;
                }
                this.plugins.set(pluginInfo.name, pluginInfo);
                console.log(`[Plugin] 已加载: ${pluginInfo.name}@${pluginInfo.version}`);
            }
        }

        console.log(`[Plugin] 共加载 ${this.plugins.size} 个插件`);
    }

    /**
     * 获取所有已加载的插件信息
     * @returns {object[]}
     */
    getAll() {
        return Array.from(this.plugins.values());
    }

    /**
     * 按名称获取插件
     * @param {string} name
     * @returns {object|null}
     */
    get(name) {
        return this.plugins.get(name) || null;
    }

    /**
     * 获取注册了指定钩子的插件列表
     * @param {string} hookName
     * @returns {object[]}
     */
    getByHook(hookName) {
        return this.getAll().filter(p => p.hooks.includes(hookName));
    }

    /**
     * 启用插件
     * @param {string} name
     * @returns {boolean}
     */
    enablePlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            console.warn(`[Plugin] 插件不存在: ${name}`);
            return false;
        }
        plugin.enabled = true;
        console.log(`[Plugin] 已启用: ${name}`);
        return true;
    }

    /**
     * 禁用插件
     * @param {string} name
     * @returns {boolean}
     */
    disablePlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            console.warn(`[Plugin] 插件不存在: ${name}`);
            return false;
        }
        plugin.enabled = false;
        console.log(`[Plugin] 已禁用: ${name}`);
        return true;
    }

    /**
     * 销毁插件：调用 onDestroy 并禁用
     * @param {string} name
     * @returns {boolean}
     */
    destroyPlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) return false;

        this.disablePlugin(name);

        if (plugin.mainModule && typeof plugin.mainModule.onDestroy === 'function') {
            try {
                plugin.mainModule.onDestroy();
            } catch (error) {
                console.error(`[Plugin] ${name}.onDestroy 执行失败:`, error.message);
            }
        }

        return true;
    }

    /**
     * 销毁所有插件
     */
    destroyAll() {
        for (const name of this.plugins.keys()) {
            this.destroyPlugin(name);
        }
    }

    /**
     * 触发指定钩子
     * @param {string} hookName
     * @param {...any} args
     * @returns {any} 钩子返回值（仅 onConfigLoad 支持管道）
     */
    triggerHook(hookName, ...args) {
        const plugins = this.getByHook(hookName).filter(p => p.enabled);
        let result = args.length === 1 ? args[0] : args;

        for (const plugin of plugins) {
            if (!plugin.mainModule) {
                console.warn(`[Plugin] 插件 ${plugin.name} 没有主进程模块，跳过钩子 ${hookName}`);
                continue;
            }
            const hookFn = plugin.mainModule[hookName];
            if (typeof hookFn !== 'function') {
                console.warn(`[Plugin] 插件 ${plugin.name} 的 ${hookName} 不是函数`);
                continue;
            }
            try {
                // onConfigLoad 支持返回值管道：每个插件的返回值作为下一个插件的输入
                if (hookName === 'onConfigLoad') {
                    const ret = hookFn.call(plugin.mainModule, result);
                    if (ret !== undefined) {
                        result = ret;
                    }
                } else {
                    hookFn.call(plugin.mainModule, ...args);
                }
            } catch (err) {
                console.error(`[Plugin] 插件 ${plugin.name} 的 ${hookName} 执行出错: ${err.message}`);
            }
        }

        return hookName === 'onConfigLoad' ? result : undefined;
    }

    /**
     * 触发时间状态变化钩子，更新内部状态并通知监听器
     * @param {object} info
     */
    triggerTimeStateChange(info) {
        if (info && info.state) {
            this.currentState = info.state;
        }
        this.triggerHook('onTimeStateChange', info);
        for (const listener of this.stateChangeListeners) {
            try {
                listener(info);
            } catch (err) {
                console.error(`[Plugin] 状态变化监听器执行出错: ${err.message}`);
            }
        }
    }

    /**
     * 触发定时提醒钩子
     * @param {object} reminder
     */
    triggerScheduleReminder(reminder) {
        this.triggerHook('onScheduleReminder', reminder);
    }

    /**
     * 注册状态变化监听器
     * @param {Function} listener - 监听器函数，接收 info 参数
     */
    onStateChange(listener) {
        if (typeof listener !== 'function') {
            console.warn('[Plugin] onStateChange: listener 必须是函数');
            return;
        }
        this.stateChangeListeners.add(listener);
    }

    /**
     * 移除状态变化监听器
     * @param {Function} listener - 要移除的监听器
     */
    offStateChange(listener) {
        this.stateChangeListeners.delete(listener);
    }

    /**
     * 启动时间状态检测
     * @param {object} scheduleConfig
     */
    startDetection(scheduleConfig) {
        this.timeDetector.start(scheduleConfig);
    }

    /**
     * 停止时间状态检测
     */
    stopDetection() {
        this.timeDetector.stop();
    }

    /**
     * 更新检测配置（配置热更新时调用）
     * @param {object} scheduleConfig
     */
    updateDetectionConfig(scheduleConfig) {
        this.timeDetector.updateConfig(scheduleConfig);
    }

    /**
     * 获取所有提醒配置（仅已启用的插件）
     * @returns {Array<{ plugin: string, type: string, offset: number }>}
     */
    getAllReminders() {
        const reminders = [];
        for (const plugin of this.plugins.values()) {
            if (!plugin.enabled) continue;
            for (const r of plugin.reminders) {
                reminders.push({
                    plugin: plugin.name,
                    type: r.type,
                    offset: r.offset,
                });
            }
        }
        return reminders;
    }

    /**
     * 获取所有渲染进程插件信息
     * @returns {Array<{ name: string, version: string, rendererPath: string }>}
     */
    getRendererPlugins() {
        return this.getAll()
            .filter(p => p.enabled && p.rendererPath)
            .map(p => ({
                name: p.name,
                version: p.version,
                rendererPath: p.rendererPath,
            }));
    }
}

module.exports = { PluginManager, TimeState, createTimeStateChangeInfo, createScheduleReminder };
