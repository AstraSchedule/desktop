const countdownState = {
    window: null,
    initialized: false,
    minimized: false,
    pollTimer: null,
    startupRetryTimer: null,
    firstSuccessLocked: false,
    latestItems: [],
    loading: false,
    scheduleCountdownRecords: [],
};

module.exports = {
    countdownState,
};
