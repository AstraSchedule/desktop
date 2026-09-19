/**
 * 离线缓存模块
 * 提供课表数据的本地持久化、版本管理和离线模式支持
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 只记录错误的类型信息，避免把缓存文件内容、用户目录路径等敏感数据写入日志
function describeError(error) {
    return error?.code || error?.name || 'unknown error';
}

class OfflineCache {
    constructor() {
        this.cacheDir = path.join(app.getPath('userData'), 'schedule-cache');
        this.maxVersions = 5; // 保留最近5个版本
        this.isOffline = false;
        this.lastOnlineTime = null;
        this.networkCheckInterval = null;
        this.onStatusChange = null; // 状态变化回调

        this.ensureCacheDir();
    }

    /**
     * 确保缓存目录存在
     */
    ensureCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * 规范化版本号，仅允许 'latest' 或由数字与分隔符组成的版本串。
     * 服务端下发的是 "<数据版本>:<周次>"（如 1758288000:5，见 usr-backend 的
     * scheduleVersion），旧客户端只发纯数据版本，两种都要接受；冒号在 Windows
     * 文件名中非法，统一替换为连字符。只放行数字与分隔符，避免目录穿越。
     */
    normalizeVersion(version) {
        if (version === 'latest') {
            return 'latest';
        }
        const text = String(version ?? '');
        if (!/^\d+(?:[:-]\d+)*$/.test(text)) {
            throw new Error('Invalid cache version');
        }
        return text.replaceAll(':', '-');
    }

    /**
     * 获取当前缓存文件路径
     */
    getCacheFilePath(version = 'latest') {
        const safe = this.normalizeVersion(version);
        const fileName = `schedule-${safe}.json`;
        const cacheDir = path.resolve(this.cacheDir);
        const filePath = path.resolve(cacheDir, fileName);

        // 路径必须严格位于缓存目录内，防止目录穿越
        if (path.dirname(filePath) !== cacheDir) {
            throw new Error('Invalid cache path');
        }
        return filePath;
    }

    /**
     * 获取版本索引文件路径
     */
    getVersionIndexPath() {
        return path.join(this.cacheDir, 'version-index.json');
    }

    /**
     * 保存课表数据到本地缓存
     * @param {Object} config - 课表配置数据
     * @param {number} version - 版本号
     */
    saveToCache(config, version) {
        try {
            const timestamp = Date.now();
            const cacheData = {
                version: version,
                timestamp: timestamp,
                data: config
            };

            // 保存当前版本
            const filePath = this.getCacheFilePath(version);
            fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2), 'utf-8');

            // 保存为latest
            const latestPath = this.getCacheFilePath('latest');
            fs.writeFileSync(latestPath, JSON.stringify(cacheData, null, 2), 'utf-8');

            // 更新版本索引
            this.updateVersionIndex(version, timestamp);

            console.log(`[OfflineCache] Saved schedule to cache: version ${version}`);
            return true;
        } catch (error) {
            console.error('[OfflineCache] Failed to save cache:', describeError(error));
            return false;
        }
    }

    /**
     * 更新版本索引
     */
    updateVersionIndex(newVersion, timestamp) {
        try {
            let index = this.getVersionIndex();

            // 检查是否已存在该版本
            const existingIndex = index.versions.findIndex(v => v.version === newVersion);
            if (existingIndex !== -1) {
                index.versions[existingIndex].timestamp = timestamp;
            } else {
                index.versions.push({
                    version: newVersion,
                    timestamp: timestamp
                });
            }

            // 按写入时间倒序保留最近的版本：版本号是含周次的字符串，相减会得到 NaN，
            // 排序失效后裁剪掉的会是最新版本
            index.versions.sort((a, b) => b.timestamp - a.timestamp);
            if (index.versions.length > this.maxVersions) {
                const removedVersions = index.versions.splice(this.maxVersions);
                // 删除旧版本文件
                removedVersions.forEach(v => {
                    try {
                        const filePath = this.getCacheFilePath(v.version);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (e) {
                        console.warn(`[OfflineCache] Failed to remove old version ${v.version}:`, describeError(e));
                    }
                });
            }

            index.lastUpdated = timestamp;
            fs.writeFileSync(this.getVersionIndexPath(), JSON.stringify(index, null, 2), 'utf-8');
        } catch (error) {
            console.error('[OfflineCache] Failed to update version index:', describeError(error));
        }
    }

    /**
     * 获取版本索引
     */
    getVersionIndex() {
        try {
            const indexPath = this.getVersionIndexPath();
            if (fs.existsSync(indexPath)) {
                const data = fs.readFileSync(indexPath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[OfflineCache] Failed to read version index:', describeError(error));
        }
        return { versions: [], lastUpdated: null };
    }

    /**
     * 从本地缓存加载课表数据
     * @param {number|null} version - 指定版本号，null则加载最新版本
     */
    loadFromCache(version = null) {
        try {
            let filePath;

            if (version !== null) {
                filePath = this.getCacheFilePath(version);
            } else {
                filePath = this.getCacheFilePath('latest');
            }

            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                const cacheData = JSON.parse(data);
                console.log('[OfflineCache] Loaded schedule from cache');
                return cacheData;
            }
        } catch (error) {
            console.error('[OfflineCache] Failed to load cache:', describeError(error));
        }
        return null;
    }

    /**
     * 检查是否有可用的缓存数据
     */
    hasCachedData() {
        const latestPath = this.getCacheFilePath('latest');
        return fs.existsSync(latestPath);
    }

    /**
     * 获取缓存的版本列表
     */
    getCachedVersions() {
        const index = this.getVersionIndex();
        return index.versions || [];
    }

    /**
     * 清除所有缓存数据
     */
    clearCache() {
        try {
            const files = fs.readdirSync(this.cacheDir);
            files.forEach(file => {
                const filePath = path.join(this.cacheDir, file);
                fs.unlinkSync(filePath);
            });
            console.log('[OfflineCache] Cache cleared');
            return true;
        } catch (error) {
            console.error('[OfflineCache] Failed to clear cache:', describeError(error));
            return false;
        }
    }

    /**
     * 设置离线状态
     */
    setOfflineStatus(isOffline) {
        const wasOffline = this.isOffline;
        this.isOffline = isOffline;

        if (!isOffline) {
            this.lastOnlineTime = Date.now();
        }

        if (wasOffline !== isOffline && this.onStatusChange) {
            this.onStatusChange(isOffline);
        }
    }

    /**
     * 获取离线状态
     */
    getOfflineStatus() {
        return {
            isOffline: this.isOffline,
            lastOnlineTime: this.lastOnlineTime,
            hasCachedData: this.hasCachedData()
        };
    }

    /**
     * 开始网络状态监控
     * @param {Function} checkNetworkFn - 网络检查函数
     * @param {number} intervalMs - 检查间隔（毫秒）
     * @param {Function} onStatusChange - 状态变化回调
     */
    startNetworkMonitoring(checkNetworkFn, intervalMs = 30000, onStatusChange = null) {
        this.onStatusChange = onStatusChange;

        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
        }

        this.networkCheckInterval = setInterval(async () => {
            try {
                const isConnected = await checkNetworkFn();
                this.setOfflineStatus(!isConnected);
            } catch {
                // 网络检查失败本身就说明当前不可用，直接标记为离线，无需记录具体异常
                this.setOfflineStatus(true);
            }
        }, intervalMs);

        console.log(`[OfflineCache] Started network monitoring (interval: ${intervalMs}ms)`);
    }

    /**
     * 停止网络状态监控
     */
    stopNetworkMonitoring() {
        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
            console.log('[OfflineCache] Stopped network monitoring');
        }
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats() {
        try {
            const index = this.getVersionIndex();
            const files = fs.readdirSync(this.cacheDir);
            let totalSize = 0;

            files.forEach(file => {
                const filePath = path.join(this.cacheDir, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            });

            return {
                versions: index.versions.length,
                totalSize: totalSize,
                lastUpdated: index.lastUpdated
            };
        } catch (error) {
            // 统计信息仅为展示用途，读取失败不应影响主流程；只记录错误类型，避免泄漏缓存路径等敏感信息
            console.warn('[OfflineCache] Failed to get cache stats:', describeError(error));
            return {
                versions: 0,
                totalSize: 0,
                lastUpdated: null
            };
        }
    }
}

module.exports = { OfflineCache };
