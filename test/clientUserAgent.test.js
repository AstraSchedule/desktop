'use strict'

// 客户端出站请求 UA 单测：
// 1) 统一格式 AstraSchedule/<version>（WAF 靠它区分官方客户端与自动化扫描）
// 2) 倒数日 /web/countdown 走 electron net 时必须带上 ctx 注入的同一个 UA
// 3) main.js 的 https 请求与 WebSocket 握手都注入该 UA（该文件依赖 electron，无法直接加载，故做源码断言）
// 更新下载由 electron-updater 发起，不在约束范围内。
// 运行：npm test / node --test test/

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {clientUserAgent} = require('../main/client-ua')
const {fetchCountdownData} = require('../main/countdown/service')

test('客户端 UA 统一为 AstraSchedule/<version>', () => {
    assert.strictEqual(clientUserAgent('202609.26.145'), 'AstraSchedule/202609.26.145')
})

// 记录 net.request 的选项，并回一个最小 JSON 响应，避免真实网络
function createNetStub(seen) {
    return {
        request(options) {
            seen.push(options)
            const listeners = new Map()
            const req = {
                on(event, fn) {
                    listeners.set(event, fn)
                    return req
                },
                abort() {
                },
                end() {
                    const body = JSON.stringify({hasConfig: false})
                    const res = {
                        statusCode: 200,
                        on(event, fn) {
                            if (event === 'data') fn(Buffer.from(body))
                            if (event === 'end') fn()
                            return res
                        },
                    }
                    listeners.get('response')(res)
                },
            }
            return req
        },
    }
}

test('倒数日请求带上 ctx 注入的 UA，且不改变原有请求参数', async () => {
    const seen = []
    const ctx = {
        net: createNetStub(seen),
        getServer: () => 'class.getastra.cn',
        getProtocols: () => ({agreement: 'https'}),
        getClassId: () => '39/2023/1',
        userAgent: clientUserAgent('1.2.3'),
    }
    await fetchCountdownData(ctx)
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].method, 'GET')
    assert.strictEqual(seen[0].url, 'https://class.getastra.cn/web/countdown?scope=39%2F2023%2F1')
    assert.deepStrictEqual(seen[0].headers, {'User-Agent': 'AstraSchedule/1.2.3'})
})

test('main.js 的 https 请求与 WebSocket 握手都注入客户端 UA', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
    assert.strictEqual((src.match(/const CLIENT_USER_AGENT = clientUserAgent\(app\.getVersion\(\)\)/g) || []).length, 1)
    assert.match(src, /const headers = \{ 'User-Agent': ua,/)
    assert.ok(src.includes("new WebSocket(url, [], {rejectUnauthorized, headers: {'User-Agent': CLIENT_USER_AGENT}})"))
})
