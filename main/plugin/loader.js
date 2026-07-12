const fs = require('node:fs');
const path = require('node:path');

/**
 * 合法的权限列表
 */
const VALID_PERMISSIONS = ['fileSystem', 'network'];

/**
 * 合法的钩子列表
 */
const VALID_HOOKS = [
    'onInit',
    'onConfigLoad',
    'onRender',
    'onTick',
    'onTimeStateChange',
    'onScheduleReminder',
];

/**
 * 合法的提醒类型
 */
const VALID_REMINDER_TYPES = ['class', 'break'];

/**
 * 验证 plugin.json 是否合法
 * @param {object} json - 解析后的 plugin.json 对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePluginJson(json) {
    const errors = [];

    if (!json || typeof json !== 'object') {
        return { valid: false, errors: ['plugin.json 必须是 JSON 对象'] };
    }

    // name：必填字符串
    if (typeof json.name !== 'string' || json.name.trim() === '') {
        errors.push('name 必须是非空字符串');
    }

    // version：必填字符串
    if (typeof json.version !== 'string' || json.version.trim() === '') {
        errors.push('version 必须是非空字符串');
    }

    // description：可选字符串
    if (json.description !== undefined && typeof json.description !== 'string') {
        errors.push('description 必须是字符串');
    }

    // author：可选字符串
    if (json.author !== undefined && typeof json.author !== 'string') {
        errors.push('author 必须是字符串');
    }

    // main：可选字符串
    if (json.main !== undefined && typeof json.main !== 'string') {
        errors.push('main 必须是字符串');
    }

    // renderer：可选字符串
    if (json.renderer !== undefined && typeof json.renderer !== 'string') {
        errors.push('renderer 必须是字符串');
    }

    // permissions：可选字符串数组
    if (json.permissions !== undefined) {
        if (!Array.isArray(json.permissions)) {
            errors.push('permissions 必须是字符串数组');
        } else {
            for (const p of json.permissions) {
                if (!VALID_PERMISSIONS.includes(p)) {
                    errors.push(`无效的权限: ${p}，合法值: ${VALID_PERMISSIONS.join(', ')}`);
                }
            }
        }
    }

    // hooks：可选字符串数组
    if (json.hooks !== undefined) {
        if (!Array.isArray(json.hooks)) {
            errors.push('hooks 必须是字符串数组');
        } else {
            for (const h of json.hooks) {
                if (!VALID_HOOKS.includes(h)) {
                    errors.push(`无效的钩子: ${h}，合法值: ${VALID_HOOKS.join(', ')}`);
                }
            }
        }
    }

    // reminders：可选对象数组
    if (json.reminders !== undefined) {
        if (!Array.isArray(json.reminders)) {
            errors.push('reminders 必须是对象数组');
        } else {
            for (let i = 0; i < json.reminders.length; i++) {
                const r = json.reminders[i];
                if (typeof r !== 'object' || r === null) {
                    errors.push(`reminders[${i}] 必须是对象`);
                    continue;
                }
                if (!VALID_REMINDER_TYPES.includes(r.type)) {
                    errors.push(`reminders[${i}].type 无效: ${r.type}，合法值: ${VALID_REMINDER_TYPES.join(', ')}`);
                }
                if (typeof r.offset !== 'number') {
                    errors.push(`reminders[${i}].offset 必须是数字`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 加载并验证插件
 * @param {string} pluginPath - 插件目录路径
 * @returns {object|null} - 插件信息对象，加载失败返回 null
 */
function loadPlugin(pluginPath) {
    const jsonPath = path.join(pluginPath, 'plugin.json');

    // 读取 plugin.json
    if (!fs.existsSync(jsonPath)) {
        console.error(`[Plugin] plugin.json 不存在: ${jsonPath}`);
        return null;
    }

    let raw;
    try {
        raw = fs.readFileSync(jsonPath, 'utf-8');
    } catch (err) {
        console.error(`[Plugin] 读取 plugin.json 失败: ${err.message}`);
        return null;
    }

    // 解析 JSON
    let json;
    try {
        json = JSON.parse(raw);
    } catch (err) {
        console.error(`[Plugin] 解析 plugin.json 失败: ${err.message}`);
        return null;
    }

    // 验证
    const { valid, errors } = validatePluginJson(json);
    if (!valid) {
        console.error(`[Plugin] plugin.json 验证失败 (${pluginPath}):`);
        errors.forEach(e => console.error(`  - ${e}`));
        return null;
    }

    // 构建插件信息
    const pluginInfo = {
        name: json.name,
        version: json.version,
        description: json.description || '',
        author: json.author || '',
        main: json.main || null,
        renderer: json.renderer || null,
        permissions: json.permissions || [],
        hooks: json.hooks || [],
        reminders: json.reminders || [],
        path: pluginPath,
        enabled: true,
        mainModule: null,
        rendererPath: null,
    };

    // 检查入口文件是否存在并加载主进程模块
    if (pluginInfo.main) {
        const mainPath = path.join(pluginPath, pluginInfo.main);
        if (fs.existsSync(mainPath)) {
            try {
                pluginInfo.mainModule = require(mainPath);
                console.log(`[Plugin] 已加载主进程模块: ${pluginInfo.name}`);
            } catch (err) {
                console.error(`[Plugin] 加载主进程模块失败 (${pluginInfo.name}): ${err.message}`);
                return null;
            }
        } else {
            console.error(`[Plugin] 主进程入口不存在: ${mainPath}`);
            return null;
        }
    }

    if (pluginInfo.renderer) {
        const rendererPath = path.join(pluginPath, pluginInfo.renderer);
        if (fs.existsSync(rendererPath)) {
            pluginInfo.rendererPath = rendererPath;
            console.log(`[Plugin] 渲染进程入口: ${pluginInfo.name} -> ${rendererPath}`);
        } else {
            console.error(`[Plugin] 渲染进程入口不存在: ${rendererPath}`);
            return null;
        }
    }

    return pluginInfo;
}

module.exports = {
    validatePluginJson,
    loadPlugin,
    VALID_PERMISSIONS,
    VALID_HOOKS,
    VALID_REMINDER_TYPES,
};
