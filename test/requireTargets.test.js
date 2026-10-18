'use strict'

// 本地 require 目标必须真实存在：#92 把 `require('./main/scheduleRevalidate')` 带进了 main.js，
// 而该模块只在未合并的 fix/schedule-edge-stale-304 分支上，导致发布出去的客户端
// （v202610.18.155）启动即报 Cannot find module —— 主进程崩在 require 阶段，
// 连 autoUpdater 都来不及跑，坏版本无法自愈。这里做一次静态检查，防止再次复发。
// 运行：node --test

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
const EXTENSIONS = ['.js', '.json', '.node']

function collectJsFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) collectJsFiles(full, acc)
        else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) acc.push(full)
    }
    return acc
}

function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile()
    } catch {
        return false
    }
}

// 按 Node 的 CJS 解析顺序：精确路径 → 补扩展名 → 目录 index.* → package.json 的 main
function resolves(fromFile, spec) {
    const base = path.resolve(path.dirname(fromFile), spec)
    if (isFile(base) || EXTENSIONS.some((ext) => isFile(base + ext))) return true
    if (EXTENSIONS.some((ext) => isFile(path.join(base, `index${ext}`)))) return true
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'))
        return typeof pkg.main === 'string' && pkg.main.length > 0
    } catch {
        return false
    }
}

test('主进程本地 require 目标都真实存在', () => {
    const files = [path.join(ROOT, 'main.js'), ...collectJsFiles(path.join(ROOT, 'main'))]
    const missing = []
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8')
        for (const match of src.matchAll(REQUIRE_RE)) {
            if (!resolves(file, match[1])) missing.push(`${path.relative(ROOT, file)} -> ${match[1]}`)
        }
    }
    assert.deepStrictEqual(missing, [], `以下本地模块被 require 但不存在：\n${missing.join('\n')}`)
})
