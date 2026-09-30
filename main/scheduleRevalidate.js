// 课表复核调度器：收到 304 之后按固定节奏再问一次。
//
// 边缘（ESA）只缓存版本号：命中就替客户端答 304，不回源。而边缘手里的版本可能比源站旧
// （到期时刻最长 600 秒软过期），客户端拿到 304 又不会主动再问——不补这一拍，客户端会
// 一直停在旧课表，直到下一次推送或重连。
//
// 同一时刻只允许一个待执行的复核：WS 推送、托盘连点、离线恢复都会各自触发拉取，
// 多个定时器同时到点会打出多个请求，响应新旧也难判断。这里只做「排期」这一件事，便于单测；
// 真正发请求的动作由 main.js 传进来。

/**
 * @param {number} delayMs 复核延迟（毫秒）
 * @param {() => void} run 到点后执行的动作
 */
function createRevalidateScheduler(delayMs, run) {
    let timer = null
    return {
        /** 已有待执行复核时不重复排期；返回是否真的排上了 */
        arm() {
            if (timer) return false
            timer = setTimeout(() => {
                timer = null
                run()
            }, delayMs)
            // 不要因为一个待执行的复核把进程留在事件循环里
            if (typeof timer.unref === 'function') timer.unref()
            return true
        },
        /** 取消待执行的复核（新一轮拉取取代它）；返回是否真的取消了 */
        cancel() {
            if (!timer) return false
            clearTimeout(timer)
            timer = null
            return true
        },
        /** 是否有待执行的复核 */
        get pending() {
            return timer !== null
        },
    }
}

module.exports = { createRevalidateScheduler };
