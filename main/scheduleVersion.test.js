const { test } = require('node:test');
const assert = require('node:assert');
const { pickReusableVersion } = require('./scheduleVersion');

test('空索引或非数组不复用', () => {
    assert.strictEqual(pickReusableVersion([]), null)
    assert.strictEqual(pickReusableVersion(null), null)
    assert.strictEqual(pickReusableVersion(undefined), null)
});

test('取索引第一条（按时间倒序的最新一条）', () => {
    assert.strictEqual(pickReusableVersion([{ version: '1:2' }, { version: 'latest' }]), '1:2')
});

test('两段与三段的版本串都复用', () => {
    assert.strictEqual(pickReusableVersion([{ version: '1772129866:30' }]), '1772129866:30')
    assert.strictEqual(pickReusableVersion([{ version: '1772129866:30:1800000000' }]), '1772129866:30:1800000000')
});

test('旧格式纯数字版本复用', () => {
    assert.strictEqual(pickReusableVersion([{ version: '1772129866' }]), '1772129866')
});

test('占位值与非法串不复用', () => {
    for (const bad of ['latest', '', 'v1', '1:2:3:4', '1:2:3:4a', ' ', '1.2']) {
        assert.strictEqual(pickReusableVersion([{ version: bad }]), null, `不应复用 ${JSON.stringify(bad)}`)
    }
    assert.strictEqual(pickReusableVersion([{}]), null)
    assert.strictEqual(pickReusableVersion([{ version: null }]), null)
});
