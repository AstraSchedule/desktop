const { app, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const prompt = require('electron-prompt');
const Store = require('electron-store');

const store = new Store();

/**
 * 保存插件启用状态到 electron-store
 * @param {string} name
 * @param {boolean} enabled
 */
function savePluginState(name, enabled) {
    const plugins = store.get('plugins', {});
    plugins[name] = { enabled };
    store.set('plugins', plugins);
}

/**
 * 创建插件管理菜单
 * @param {import('./index').PluginManager} pluginManager
 * @returns {Electron.MenuItemConstructorOptions} 菜单模板
 */
function createPluginMenu(pluginManager) {
    const pluginsDir = pluginManager.pluginsDir;
    const allPlugins = pluginManager.getAll();

    // 插件列表子项
    const pluginItems = allPlugins.length === 0
        ? [{ label: '暂无已安装插件', enabled: false }]
        : allPlugins.map(plugin => ({
            label: plugin.name,
            sublabel: plugin.version ? `v${plugin.version}` : undefined,
            type: 'checkbox',
            checked: plugin.enabled,
            click: () => {
                if (plugin.enabled) {
                    pluginManager.disablePlugin(plugin.name);
                    savePluginState(plugin.name, false);
                } else {
                    pluginManager.enablePlugin(plugin.name);
                    savePluginState(plugin.name, true);
                }
            }
        }));

    return {
        label: '插件管理',
        submenu: [
            {
                label: '插件列表',
                submenu: pluginItems
            },
            {
                label: '安装插件',
                click: () => {
                    dialog.showOpenDialog({
                        title: '选择插件文件夹',
                        properties: ['openDirectory'],
                        defaultPath: pluginsDir || app.getPath('userData'),
                    }).then(result => {
                        if (result.canceled || !result.filePaths.length) return;

                        const srcDir = result.filePaths[0];
                        const destDir = path.join(pluginsDir, path.basename(srcDir));

                        if (fs.existsSync(destDir)) {
                            dialog.showMessageBox({
                                type: 'warning',
                                message: '同名插件已存在，请先删除旧版本。',
                            });
                            return;
                        }

                        try {
                            fs.cpSync(srcDir, destDir, { recursive: true });
                            pluginManager.scanPlugins();
                            // 恢复已保存的启用状态
                            const savedPlugins = store.get('plugins', {});
                            for (const [name, config] of Object.entries(savedPlugins)) {
                                if (config.enabled) pluginManager.enablePlugin(name);
                            }
                            dialog.showMessageBox({
                                type: 'info',
                                message: `插件 "${path.basename(srcDir)}" 安装成功。`,
                            });
                        } catch (err) {
                            dialog.showMessageBox({
                                type: 'error',
                                message: `安装失败: ${err.message}`,
                            });
                        }
                    });
                }
            },
            { type: 'separator' },
            {
                label: '打开插件目录',
                click: () => {
                    if (pluginsDir && fs.existsSync(pluginsDir)) {
                        shell.openPath(pluginsDir);
                    } else {
                        shell.openPath(app.getPath('userData'));
                    }
                }
            },
            {
                label: '刷新插件列表',
                click: () => {
                    pluginManager.scanPlugins();
                    const savedPlugins = store.get('plugins', {});
                    for (const [name, config] of Object.entries(savedPlugins)) {
                        if (config.enabled) pluginManager.enablePlugin(name);
                    }
                    console.log(`[Plugin] 插件列表已刷新，共 ${pluginManager.getAll().length} 个插件`);
                }
            },
        ],
    };
}

module.exports = { createPluginMenu };
