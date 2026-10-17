// 本地状态 HTTP 服务：把渲染进程算出的课表状态对外暴露为只读的 /status 与 /subjects。
//
// 只做「接收快照 + 应答请求」两件事，状态计算全部留在渲染进程——weekIndex / timeOffset /
// dayOffset / 临时调课只存在渲染进程 localStorage，主进程无法独立算出同一份结果（见 main.js
// 的 contextIsolation 边界）。
//
// 固定监听 127.0.0.1：课表属于个人数据，不做出网暴露。端口被占用时只记录日志，不阻断启动。

const http = require('node:http');

const DEFAULT_PORT = 3011;
const DEFAULT_HOST = '127.0.0.1';

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

/**
 * @param {{port?: number, host?: string, log?: {error: Function}}} [options]
 */
function createStatusServer(options = {}) {
    const port = options.port === undefined ? DEFAULT_PORT : options.port;
    const host = options.host || DEFAULT_HOST;
    const log = options.log || console;

    let latest = null;
    let receivedAt = 0;

    const server = http.createServer((req, res) => {
        // HEAD 与 GET 同路：Node 对 HEAD 会自动丢弃响应体
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, {error: 'method_not_allowed'});
            return;
        }
        const path = (req.url || '/').split('?')[0];
        if (path !== '/status' && path !== '/subjects') {
            sendJson(res, 404, {error: 'not_found'});
            return;
        }
        if (!latest) {
            // 渲染进程还没跑起第一次 tick（或页面尚未加载）
            sendJson(res, 503, {error: 'status_unavailable', message: '课表状态尚未就绪'});
            return;
        }
        const reportedAt = new Date(receivedAt).toISOString();
        if (path === '/subjects') {
            // 课程清单：subjects 是今天课表上的科目，catalog 是配置里的全部科目
            sendJson(res, 200, {reportedAt, subjects: latest.subjects || [], catalog: latest.catalog || []});
            return;
        }
        sendJson(res, 200, {...latest, reportedAt});
    });

    // http.Server 的 error 事件没有监听者会直接抛出并打挂主进程，必须兜住
    server.on('error', (error) => {
        log.error('[StatusServer] 服务异常:', error?.code || error);
    });

    return {
        server,
        /** 渲染进程每次 tick 推来的最新状态快照 */
        update(status) {
            latest = status;
            receivedAt = Date.now();
        },
        /** 返回实际监听端口；启动失败（如端口被占用）返回 null，不抛出 */
        start() {
            return new Promise((resolve) => {
                // 两个事件只会来一个，各自把对方摘掉，避免残留监听器
                const onListening = () => {
                    server.off('error', onError);
                    resolve(server.address().port);
                };
                const onError = () => {
                    server.off('listening', onListening);
                    resolve(null);
                };
                server.once('listening', onListening);
                server.once('error', onError);
                server.listen(port, host);
            });
        },
        stop() {
            if (!server.listening) return Promise.resolve();
            return new Promise((resolve) => server.close(() => resolve()));
        }
    };
}

module.exports = {createStatusServer, DEFAULT_PORT, DEFAULT_HOST};
