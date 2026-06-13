# ElectronClassSchedule 客户端知识库

## 概述

Electron 22 + 原生 JavaScript + jQuery 客户端，用于显示课表、倒计时、天气和 WebSocket 实时通信。

## 项目结构

```
ElectronClassSchedule/
├── main.js                    # 主进程入口（1316行，包含大部分逻辑）
├── index.html                 # 主窗口 HTML（课表界面）
├── countdown.html             # 倒数日独立窗口 HTML
├── package.json               # 项目配置
├── main/                      # 主进程模块
│   └── countdown/             # 倒数日子系统（state/ipc/service/window）
├── js/                        # 渲染进程脚本
│   ├── scheduleConfig.js      # 默认课表配置（JSONC模板）
│   ├── index.js               # 课表核心逻辑
│   ├── renderer.js            # 主窗口 UI 渲染（1141行）
│   └── countdown*.js          # 倒数日相关脚本
├── css/                       # 样式文件
├── font/                      # 字体文件
└── image/                     # 图标资源
```

## 查找位置

| 任务 | 位置 | 说明 |
|------|------|------|
| 主进程逻辑 | `main.js` | WebSocket、托盘、IPC、天气、更新 |
| 课表显示 | `js/index.js` | 时间计算、课程高亮 |
| UI 渲染 | `js/renderer.js` | 界面更新、动画 |
| 配置管理 | `js/scheduleConfig.js` | 用户可编辑配置 |
| 倒数日子系统 | `main/countdown/` | 独立窗口管理 |
| 窗口创建 | `main/countdown/window.js` | BrowserWindow 配置 |

## 约定

### 编码规范
- **缩进**：4 空格（JS/CSS），2 空格（package.json/HTML）
- **行尾**：CRLF（Windows）
- **编码**：UTF-8
- **尾部空格**：自动修剪

### 配置合并
- 默认配置：`js/scheduleConfig.js`
- 用户配置：`scheduleConfig.user.jsonc`（JSONC 格式，支持注释）
- 云端配置：通过 API 下载，优先级最高

### IPC 通信
- 主进程 → 渲染进程：`win.webContents.send`
- 渲染进程 → 主进程：`ipcRenderer.send`
- 响应式调用：`ipcRenderer.invoke` + `ipcMain.handle`

## 反模式

### 安全相关
- **禁止** 在生产环境使用 `nodeIntegration: true` + `contextIsolation: false`（当前实现）
- **禁止** 在代码中硬编码 API 密钥或令牌

### 代码质量
- **禁止** 在 `main.js` 中添加新功能模块（应提取到 `main/` 目录）
- **禁止** 修改 `scheduleConfig.js` 的默认值（应通过用户配置覆盖）
- **禁止** 使用 `any` 类型（虽然不是 TypeScript，但应避免松散类型）

### 构建相关
- **禁止** 提交 `dist/` 目录（构建产物）
- **禁止** 提交 `node_modules/` 目录
- **禁止** 在未安装 `setuptools` 的情况下运行 `npm install`

## 独特风格

### 窗口穿透交互
- 使用 `win.setIgnoreMouseEvents(true, { forward: true })` 实现鼠标穿透
- 通过轮询（100ms）检测鼠标位置，判断是否在可交互区域
- 悬停时降低 `opacity` 至 0.1 作为视觉反馈

### 版本号系统
- 格式：`YYYYMM.D.N`（年月.日.运行序号）
- 示例：`202510.2.40` 表示 2025年10月02日，第40次构建
- electron-updater 通过 `isSemver()` 检查适配

### 三层存储
- 主进程：`electron-store`（JSON 持久化）
- 渲染进程：`localStorage`（临时状态）
- 用户配置：JSONC 文件（支持注释）

## 命令

```bash
# 开发调试
bun run debug

# 构建（Windows ia32）
bun run build

# CI 构建并发布
bun run ci
```

## 注意事项

### 构建环境
- 需要 Node.js v20+、VS2019+、Python 3.8+
- **必须**先执行 `pip install setuptools` 再执行 `npm install`
- 构建产物仅支持 Windows ia32 架构

### 自动更新
- 发布到 `daizihan233/AstraSchedule` 仓库
- 镜像源：`hubproxy.khbit.cn`
- 仅打包模式 + semver 版本时生效

### 窗口配置
- 主窗口：无边框、透明、置顶、不可调整大小
- 倒数日窗口：无边框、透明、不可移动、鼠标穿透
- 托盘菜单：左键/右键点击打开
