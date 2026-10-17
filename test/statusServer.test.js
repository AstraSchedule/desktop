'use strict'

// 3011 端口状态服务的契约测试：只验证「未就绪要明确报不可用、快照原样透传、
// 未知路径/非 GET 不误应答」三条边界，状态本身的正确性由
// test/scheduleStatus.test.js 覆盖。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')

const {createStatusServer, DEFAULT_PORT, DEFAULT_HOST} = require('../main/status-server')

const quietLog = {error() {}}

function request(port, path, method = 'GET') {
    return new Promise((resolve, reject) => {
        // agent: false 让每个请求用独立连接，避免 keep-alive 挂在 server.close() 上
        const req = http.request({host: DEFAULT_HOST, port, path, method, agent: false}, (res) => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
                body += chunk
            })
            res.on('end', () => resolve({statusCode: res.statusCode, headers: res.headers, body}))
        })
        req.on('error', reject)
        req.end()
    })
}

async function startServer() {
    const server = createStatusServer({port: 0, log: quietLog})
    const port = await server.start()
    assert.ok(port, '随机端口应能正常监听')
    return {server, port}
}

const SNAPSHOT = {
    time: '08:10:00',
    timestamp: 1789000000000,
    inClass: true,
    state: 'in_class',
    currentLesson: {fullName: '语文', shortName: '语', startAt: '08:00', endAt: '08:40'},
    nextLesson: {fullName: '数学', shortName: '数', startAt: '08:50', endAt: '09:30'},
    nextChange: {type: 'class_end', at: '08:40', inSeconds: 1800},
    subjects: [{shortName: '语', fullName: '语文'}],
    catalog: [{shortName: '语', fullName: '语文'}, {shortName: '数', fullName: '数学'}]
}

test('渲染进程还没推过快照时 /status 返回 503 而不是空 200', async () => {
    const {server, port} = await startServer()
    try {
        const res = await request(port, '/status')
        assert.strictEqual(res.statusCode, 503)
        assert.strictEqual(JSON.parse(res.body).error, 'status_unavailable')
        assert.strictEqual((await request(port, '/subjects')).statusCode, 503, '/subjects 也要等快照就绪')
    } finally {
        await server.stop()
    }
})

test('调度器端口默认值就是需求里的 3011', () => {
    assert.strictEqual(DEFAULT_PORT, 3011)
})

test('update 之后的快照原样透传，并附带 reportedAt（忽略 query）', async () => {
    const {server, port} = await startServer()
    try {
        server.update(SNAPSHOT)
        const res = await request(port, '/status?pretty=1')
        assert.strictEqual(res.statusCode, 200)
        const body = JSON.parse(res.body)
        for (const key of Object.keys(SNAPSHOT)) {
            assert.deepStrictEqual(body[key], SNAPSHOT[key], `字段 ${key} 应透传`)
        }
        assert.match(body.reportedAt, /^\d{4}-\d{2}-\d{2}T/)
        assert.strictEqual(res.headers['cache-control'], 'no-store', '状态不可缓存')
        assert.match(res.headers['content-type'], /application\/json/)
    } finally {
        await server.stop()
    }
})

test('快照中的 reportedAt 不得覆盖服务端接收时间', async () => {
    const {server, port} = await startServer()
    try {
        const beforeUpdate = Date.now()
        server.update({...SNAPSHOT, reportedAt: '2000-01-01T00:00:00.000Z'})
        const afterUpdate = Date.now()
        const body = JSON.parse((await request(port, '/status')).body)
        const subjects = JSON.parse((await request(port, '/subjects')).body)

        assert.ok(Date.parse(body.reportedAt) >= beforeUpdate)
        assert.ok(Date.parse(body.reportedAt) <= afterUpdate)
        assert.strictEqual(body.reportedAt, subjects.reportedAt)
    } finally {
        await server.stop()
    }
})

test('/subjects 单独返回课程清单，且忽略 query', async () => {
    const {server, port} = await startServer()
    try {
        server.update(SNAPSHOT)
        const res = await request(port, '/subjects?pretty=1')
        assert.strictEqual(res.statusCode, 200)
        const body = JSON.parse(res.body)
        assert.deepStrictEqual(body.subjects, SNAPSHOT.subjects, '今天课表上的科目应透传')
        assert.deepStrictEqual(body.catalog, SNAPSHOT.catalog, '全部科目应透传')
        assert.match(body.reportedAt, /^\d{4}-\d{2}-\d{2}T/)
        assert.strictEqual(res.headers['cache-control'], 'no-store', '课程清单不可缓存')

        // 渲染进程未推送课程字段时给空清单，而不是把 undefined 抛给调用方
        server.update({state: 'break'})
        const legacy = JSON.parse((await request(port, '/subjects')).body)
        assert.deepStrictEqual(legacy.subjects, [])
        assert.deepStrictEqual(legacy.catalog, [])
    } finally {
        await server.stop()
    }
})

test('未知路径 404、非 GET 405', async () => {
    const {server, port} = await startServer()
    try {
        server.update(SNAPSHOT)
        assert.strictEqual((await request(port, '/unknown')).statusCode, 404)
        assert.strictEqual((await request(port, '/status', 'POST')).statusCode, 405)
    } finally {
        await server.stop()
    }
})

test('端口被占用时 start() 返回 null 且不抛出（不阻断客户端启动）', async () => {
    const first = createStatusServer({port: 0, log: quietLog})
    const port = await first.start()
    const second = createStatusServer({port, log: quietLog})
    try {
        assert.strictEqual(await second.start(), null)
        assert.strictEqual(second.server.listening, false)
    } finally {
        await first.stop()
        await second.stop()
    }
})
