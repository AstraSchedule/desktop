// 刘德华解冻动画（元旦彩蛋）
// 通过 preload 暴露的 window.astraIPC 接收课程状态，不直接 require('electron')
const ipcRenderer = window.astraIPC;

// 时间配置（js/unfreeze.js 不进 asar，可直接修改这两个时间）
let UNFREEZE_START_TIME = '2026-12-29 00:00:00';
let UNFREEZE_END_TIME = '2026-12-31 13:00:00';

// 音量配置
const VOLUME_MIN = 0;    // 最小音量（0%）
const VOLUME_MAX = 0.5;  // 最大音量（50%）

let startLayer = null;
let animationFrame = null;
let hasUnfreezeCompleted = false;

// 音频播放相关
let audio = null;
let isPlaying = false;

// 课程状态相关
let classStatus = {
    type: null,
    fullName: null
};
let lastClassStatusType = null;

function parseTime(timeString) {
    return new Date(timeString).getTime();
}

// 正在上课（且不是元旦相关课程）时禁止点击播放
function shouldDisableClick() {
    if (classStatus.type === 'current' && classStatus.fullName && !classStatus.fullName.includes('元旦')) {
        return true;
    }
    return false;
}

function pauseAudio() {
    if (audio && isPlaying) {
        audio.pause();
        audio.currentTime = 0;
        isPlaying = false;
        console.log('[Unfreeze] Audio paused');
    }
}

// 监听课程状态变化：从课间进入上课时暂停播放
ipcRenderer.on('class-status-changed', (e, arg) => {
    if (!arg) return;
    const oldType = lastClassStatusType;
    classStatus.type = arg.type;
    classStatus.fullName = arg.fullName;
    lastClassStatusType = arg.type;

    if (oldType !== 'current' && arg.type === 'current') {
        pauseAudio();
    }
});

function getUnfreezeProgress() {
    const now = Date.now();
    const startTime = parseTime(UNFREEZE_START_TIME);
    const endTime = parseTime(UNFREEZE_END_TIME);

    if (now < startTime) {
        return 0; // 还没开始，完全显示 start
    } else if (now >= endTime) {
        return 1; // 已结束，完全隐藏 start
    } else {
        return (now - startTime) / (endTime - startTime);
    }
}

function updateCountdown() {
    const now = Date.now();
    const endTime = parseTime(UNFREEZE_END_TIME);
    const countdownEl = document.getElementById('countdown');

    if (!countdownEl) return;

    const remaining = endTime - now;
    if (remaining <= 0) {
        countdownEl.style.display = 'none';
        return;
    }

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    const progressPercent = Math.floor(getUnfreezeProgress() * 100);

    let timeText = '';
    if (days > 0) {
        timeText = days + '天' + hours + '时' + minutes + '分';
    } else if (hours > 0) {
        timeText = hours + '时' + minutes + '分' + seconds + '秒';
    } else {
        timeText = minutes + '分' + seconds + '秒';
    }

    countdownEl.textContent = timeText + ' ' + progressPercent + '%';
}

function onUnfreezeComplete() {
    // 解冻完成：停在 end 图，隐藏倒计时，停止音频（video 版本已移除）
    console.log('[Unfreeze] Unfreeze complete');
    pauseAudio();
    const countdownEl = document.getElementById('countdown');
    if (countdownEl) countdownEl.style.display = 'none';
}

function updateAnimation() {
    const progress = getUnfreezeProgress();

    // 从上到下逐渐隐藏 start 层：clip-path inset(0) -> inset(100%)
    startLayer.style.clipPath = 'inset(' + (progress * 100) + '% 0 0 0)';
    updateCountdown();

    // 音量随解冻进度渐增
    if (audio && isPlaying && progress < 1) {
        audio.volume = VOLUME_MIN + (VOLUME_MAX - VOLUME_MIN) * progress;
    }

    if (progress >= 1 && !hasUnfreezeCompleted) {
        hasUnfreezeCompleted = true;
        onUnfreezeComplete();
    }

    animationFrame = requestAnimationFrame(updateAnimation);
}

function initAudio() {
    audio = new Audio('audio/恭喜发财.mp3');
    audio.loop = true;
    audio.volume = VOLUME_MIN;
}

function toggleAudio() {
    if (shouldDisableClick()) {
        console.log('[Unfreeze] Click disabled due to class status');
        return;
    }
    if (!audio) return;
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        console.log('[Unfreeze] Audio paused');
    } else {
        audio.play().catch((err) => console.warn('[Unfreeze] Audio play failed:', err?.message || err));
        isPlaying = true;
        console.log('[Unfreeze] Audio played');
    }
}

function init() {
    startLayer = document.getElementById('startLayer');
    if (!startLayer) {
        console.error('[Unfreeze] startLayer not found');
        return;
    }

    initAudio();

    const container = document.querySelector('.container');
    if (container) {
        container.addEventListener('click', toggleAudio);
        container.style.cursor = 'pointer';
    }

    // 启动时已过解冻时间：直接显示 end 图
    const progress = getUnfreezeProgress();
    if (progress >= 1) {
        hasUnfreezeCompleted = true;
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) countdownEl.style.display = 'none';
        startLayer.style.clipPath = 'inset(100% 0 0 0)';
    } else {
        updateAnimation();
    }

    lastClassStatusType = classStatus.type;
    console.log('[Unfreeze] Animation started');
    console.log('[Unfreeze] Start time:', UNFREEZE_START_TIME);
    console.log('[Unfreeze] End time:', UNFREEZE_END_TIME);
}

globalThis.addEventListener('DOMContentLoaded', init);
