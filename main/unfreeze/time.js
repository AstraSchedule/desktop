// 调试选项设置解冻时间的格式转换（纯函数，便于测试）
// 存储/下发格式：'YYYY-MM-DD HH:mm:ss'；datetime-local 输入格式：'YYYY-MM-DDTHH:mm'

function toLocalInput(stored) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(String(stored || '').trim());
    if (!m) return '';
    return m[1] + 'T' + m[2] + ':' + m[3];
}

function fromLocalInput(input) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(input || '').trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    // 构造本地时间并回读，拒绝被 Date 自动归一化的非法日期（如 2 月 30 日）与越界时分
    const date = new Date(year, month - 1, day, hour, minute, 0);
    if (Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year || date.getMonth() !== month - 1 ||
        date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
        return null;
    }
    return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':00';
}


// 只接受能解析成有效本地时间的字符串，避免坏值下发后渲染层倒计时出现 NaN
function parseStoredTime(value, fallback) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return fallback;
    const ms = new Date(text.replace(' ', 'T')).getTime();
    return Number.isNaN(ms) ? fallback : text;
}
module.exports = { toLocalInput, fromLocalInput, parseStoredTime };
