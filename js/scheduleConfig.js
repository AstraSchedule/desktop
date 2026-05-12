const _scheduleConfig = {

    // 倒计时目标：位于右侧框中的倒计时，输入日期即可，可以是中考高考期末等等，格式YYYY-MM-DD
    // 若想隐藏右侧的倒计时，请在下方冒号后填入'hidden', (包括引号)
    countdown_target: '2026-1-1',

    // 星期显示：左侧框是否显示，显示为true，隐藏为false
    // 直接将true或false填入冒号后边，没有引号
    week_display: true,

    // 天气预警：如果当地有天气预警，使用天气预警替代顶部横幅
    weather_alert_override: false,
    weather_alert_brief: false,

    // 顶部横幅：顶部横幅内容，为空则不显示横幅
    banner_text: '',

    // 科目名称：所有课程科目的简写及其对应全称，冒号前面(key)为简写，后面(value)为全称，不限字数，
    // 若存在多个课程简写相同，需要加以区分，可以为简写添加下角标，使用@分隔，如'自@语'，@前为简写，@后为下角标
    // 要求必须做到覆盖完全，否则可能会保错
    subject_name: {
        'Loading': "加载中"
    },

    // 时间表: 每天课程安排的时间表，内层冒号前面为时间，后面为课程序号(从0开始的数字[不带'']) 或 课间具体名称(用''包裹中间写文字)
    // 这里的例子workday和weekend（外层）只是举例，你也可以自定义其名字(第一个字符不要为数字)
    // 比如如果你的学校周三半天，你可以在这里单独添加一个wednesday: {...}
    // 注：时间段中-后的时间要减一分钟 比如某节课40分钟，时间段为08:00-08:40，但实际配置时要配置'08:00-08:39'
    timetable: {
        workday: {
            '00:00-23:59': 0
        }
    },

    // 分隔线: 课表中区分不同时段课程的分隔线配置，外层key（冒号前）部分与上面timeable相同
    // value（冒号后）为分隔线所在位置的前一个课程序号(从0开始的数字[不带''])
    divider: {
        workday: []
    },

    // 每日课程：配置星期几对应第几堂课是什么课，星期顺序不可以更改(星期日/一/二/三/四/五/六)，你可以对classList后面内容进行更改
    // 从classList后最外的中括号看起，里面的第几个元素的序号-1就是该元素的下标，这个下标对应你在上面timetable中配置的数字，课程用单引号包含，写入在subject_name中配置的简写
    // 如果该节课可能存在每周轮换，你可以用一个中括号把他们全部写进去如: ['(第一周课)物', '(第二周)化', '(第三周)地', '(第四周)数'](小括号及其内容无需填写, 最多支持四周轮换)
    // 下面的timetable中配置该日属于在上面的timetable中的哪一类，如周日属于weekend就这样写 timetable: 'weekend'，用单引号包含
    daily_class: [
        {
            Chinese: '日',
            English: 'SUN',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '一',
            English: 'MON',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '二',
            English: 'TUE',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '三',
            English: 'WED',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '四',
            English: 'THR',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '五',
            English: 'FRI',
            classList: ['Loading'],
            timetable: 'workday'
        },
        {
            Chinese: '六',
            English: 'SAT',
            classList: ['Loading'],
            timetable: 'workday'
        }
    ],


    // 课表样式: 配置课表样式CSS变量, 包括字体大小，透明度等属性
    // 请不要更改冒号前半部分文字, 请更改冒号后单引号中的数字(切勿删除引号与数字后的单位), 如果你对CSS有所了解你也可以尝试更改CSS单位
    css_style: {
        '--center-font-size': '30px', // 中间课表中的课程简写单字的字体大小
        '--corner-font-size': '14px', // 左侧的星期中文角标与右侧的"天"字的字体大小
        '--countdown-font-size': '28px', // 课程或课间全称与倒计时的字体大小
        '--global-border-radius': '16px', // 所有背景框的圆角大小
        '--global-bg-opacity': '0.3', // 所有背景框的不透明度, 范围: [0, 1]
        '--container-bg-padding': '8px 14px', // 上面三个框各自的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
        '--countdown-bg-padding': '5px 12px', // 倒计时框的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
        '--container-space': '16px', // 上面三个框中间的间隔长度
        '--top-space': '16px', // 课表主体最顶端与电脑屏幕上边框的间隔长度
        '--main-horizontal-space': '8px', // 中间课表中的课程简写单字之间的间隔长度
        '--divider-width': '2px', // 分隔线宽度
        '--divider-margin': '6px', // 分隔线外边距
        '--triangle-size': '16px', // 倒计时框上方小三角箭头的大小
        '--sub-font-size': '20px', // 中间课表中的课程下角标(X@X)的字体大小
        '--banner-height': '30px', // 顶部横幅高度
    },

    // 天气温度颜色配置：各温度段的颜色映射，stops 中每个端点包含温度阈值(temp)和对应颜色(color)
    // 温度匹配规则：找到第一个 temp > 当前温度的端点，使用其颜色
    // use_gradient: true 时在两个相邻端点间线性插值颜色，false 时使用离散颜色
    temperature_colors: {
        use_gradient: false,
        stops: [
            { temp: 20, color: "#66CCFF" },
            { temp: 30, color: "#5FBC21" },
            { temp: 36, color: "#FF8C00" },
            { temp: 100, color: "#EE0000" }
        ]
    },

    // 调试输入值：当前用于气温偏移量，但不与气温概念强绑定，后续可能用作其他调试参数
    debug_input_value: "0",
}

let scheduleConfig = structuredClone(_scheduleConfig);
