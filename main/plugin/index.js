const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./loader');

/**
 * 插件管理器
 */
class PluginManager {
    constructor() {
        /** @type {Map<string, object>} name -> pluginInfo */
        this.plugins = new Map();
        this.pluginsDir = null;
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

        this.plugins.clear();

        let entries;
        try {
            entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        } catch (err) {
            console.error(`[Plugin] 读取插件目录失败: ${err.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const pluginPath = path.join(this.pluginsDir, entry.name);
            const pluginInfo = loadPlugin(pluginPath);

            if (pluginInfo) {
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
     * 触发指定钩子
     * @param {string} hookName
     * @param {...any} args
     */
    triggerHook(hookName, ...args) {
        const plugins = this.getByHook(hookName).filter(p => p.enabled);
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
                hookFn.apply(plugin.mainModule, args);
            } catch (err) {
                console.error(`[Plugin] 插件 ${plugin.name} 的 ${hookName} 执行出错: ${err.message}`);
            }
        }
    }

    /**
     * 触发时间状态变化钩子
     * @param {object} info
     */
    triggerTimeStateChange(info) {
        this.triggerHook('onTimeStateChange', info);
    }

    /**
     * 触发定时提醒钩子
     * @param {object} reminder
     */
    triggerScheduleReminder(reminder) {
        this.triggerHook('onScheduleReminder', reminder);
    }

    /**
     * 获取所有提醒配置
     * @returns {Array<{ plugin: string, type: string, offset: number }>}
     */
    getAllReminders() {
        const reminders = [];
        for (const plugin of this.plugins.values()) {
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
}

module.exports = { PluginManager };
