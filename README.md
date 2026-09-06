# 电子课程表

![view](image/README/view.png)

[![Quality gate](https://sonarcloud.io/api/project_badges/quality_gate?project=daizihan233_ElectronClassSchedule)](https://sonarcloud.io/summary/new_code?id=daizihan233_ElectronClassSchedule)

_**注意：此版本并非原版，请不要在 [原项目](https://github.com/EnderWolf006/ElectronClassSchedule) 的 Issue 提交本项目的问题，本项目较于原版代码的修改较多，故不会随时跟进原版的问题修复与新功能更新，如果原版功能存在问题而您正在使用此版本，烦请在此项目再开 issue**_

_**本篇 README 从 [原项目](https://github.com/EnderWolf006/ElectronClassSchedule) 的 README 修改而来，修改时可能存在疏漏，如遇部署问题请联系本项目作者 `party-turret-royal@duck.com`**_

## 软件介绍

- 本软件具有显示当天课表，当前星期、日期，天数倒计时，下课/上课倒计时等功能。
- 支持动态调整课表，窗口置顶且可点击穿透。
- 使用Html + CSS + JavaScript三件套制作，使用Node.js+Electron完善系统级功能并打包。
- 在电子白板在学校普及的今天，欢迎大家下载体验与分享，但也请不要用于商业用途。
- 如果您喜欢本项目，也可以去看看 [原版](https://github.com/EnderWolf006/ElectronClassSchedule) ！

## 食用说明
以下为在Windows系统下的使用方法，其他操作系统请各位大佬自行拉取仓库打包，

- 右侧 Releases 中下载最新版本，其中 `ElectronClassSchedule-Setup-xxxxxx.y.z.exe` 为程序安装包
- 打包版本配置文件路径：`resources/app.asar.unpacked/js/scheduleConfig.js`（请在安装目录下查找 `resources`
  文件夹）。如需集控，可自行部署 [daizihan233/FastClassSchedule](https://github.com/daizihan233/FastClassSchedule)
  与 [daizihan233/NaiveClassSchedule](https://github.com/daizihan233/NaiveClassSchedule)，您也可以自己实现 API！
    - 如果找不到 `app.asar.unpacked` 目录，请确认您安装的版本是否为官方打包版本，或自编译时是否启用了 asarUnpack。
    - 服务端暂未提供部署文档，您可以联系本项目作者 `party-turret-royal@duck.com` 协助部署
    - 本项目后期修改的大方向是向集控模式迁移，故推荐使用集控方式部署，如需帮助，亦可联系本项目作者，使用现有集控服务
- 设置菜单可以通过点击系统托盘打开。
- 菜单中 `当前地区` 选项可控制获取的天气信息
- 菜单中 `课上计时` 选项可控制倒计时部分在上课时间是否显示
- 菜单中 `上课隐藏` 选项可控制课表本体、星期以及倒计时部分在上课时间是否显示
- 若将 `课上计时` 与 `上课隐藏` 同时开启（推荐默认开启）可实现课上仅显示倒计时小窗口

## 命令行安装

Windows 安装器支持通过命令行预先设置安装目录、快捷方式、云端服务和应用运行选项，适合使用 BAT 批量部署。安装器会在安装目录生成一次性 `install-config.ini`，应用首次启动导入后自动删除；未传入应用参数的普通安装不会生成该文件。

示例（参数值包含空格时使用双引号）：

```bat
AstraSchedule-Setup.exe /S /SERVER=class.example.com /CLASS="39/2023/1" /LOCAL=南京 /CLOUD=1 /SECURE=1 /AUTOLAUNCH=0 /TOPMOST=1 /DESKTOPSHORTCUT=0 /STARTMENUSHORTCUT=1 /LAUNCH=0 /D=C:\AstraSchedule
```

支持的参数：

- `/S`：静默安装；`/D=路径`：指定安装目录（NSIS 标准参数）
- `/SERVER=地址`：云端服务地址
- `/CLASS="学校/年级/班级"`：班级标识，例如 `/CLASS="39/2023/1"`；包含 `/` 的值建议使用双引号
- `/LOCAL=地区`：天气查询地区
- `/CLOUD=0|1`：是否连接云端
- `/SECURE=0|1`：是否使用 HTTPS/WSS
- `/AUTOLAUNCH=0|1`：是否开机启动
- `/TOPMOST=0|1`：窗口是否置顶
- `/DESKTOPSHORTCUT=0|1`：是否创建桌面快捷方式
- `/STARTMENUSHORTCUT=0|1`：是否创建开始菜单快捷方式
- `/LAUNCH=0|1`：安装后是否立即启动

未传入的应用参数不会覆盖已有用户配置。`/DESKTOPSHORTCUT`、`/STARTMENUSHORTCUT` 和 `/LAUNCH` 默认值均为 `1`，与普通安装行为一致。

### 一次性配置文件

当命令行中包含 `/SERVER`、`/CLASS`、`/LOCAL`、`/CLOUD`、`/SECURE`、`/AUTOLAUNCH` 或 `/TOPMOST` 时，安装器会在目标安装目录写入 `install-config.ini`。该文件只用于首次启动导入配置；导入后的配置会持久化到 `electron-store`，后续运行不再依赖该文件：

1. 安装器完成文件复制后生成配置文件。
2. 应用启动时读取 `[app]` 节中的有效配置项并写入用户配置。
3. 导入成功后自动删除 `install-config.ini`。

如果应用尚未启动，配置文件会保留到下一次启动。配置文件删除失败不会阻止应用运行，后续启动会继续尝试清理。未传入上述应用参数时，安装器不会创建该文件。

### BAT 部署建议

- 推荐在 BAT 中使用完整路径调用安装器，并为包含 `/`、空格或特殊字符的参数加双引号，例如 `/CLASS="39/2023/1"`、`/LOCAL="北京/海淀"`。安装器也会正确处理不带引号的班级路径值。
- `/D=` 是 NSIS 的安装目录参数，通常应放在命令行末尾；安装器会按照 NSIS 规则处理该路径。
- 批量部署时建议显式指定 `/LAUNCH=0`，避免安装过程结束后在部署机上启动应用。
- 升级或重复安装时，仅本次命令行明确传入的应用参数会覆盖已有设置，未传入的参数保持原值。

## 版本号说明

本项目使用 electron-updater 进行自动更新，版本号使用 `语义化版本控制` 格式，但由于本项目以一种近乎于滚动升级的方式发版，所以并不遵循其命名规范。本项目的版本号命名规则如下：

- `YYYYMM.D.N`
- `YYYY`：发布时是哪年
- `MM`：发布时是几月（固定为两位数）
- `D`：发布时是几日
- `N`：GitHub Action 序号
- 例如：`202510.2.40` 表示该版本发布于 `2025 年 10 月 02 日`，GitHub Action 序号为 `40`。

## 修改说明

- **注意：** 阅读以下内容需要一定的编程知识储备。如果您想修改软件源码自行打包（Windows），请阅读此部分内容。若您仅想使用本软件，请跳过此部分内容。不论何时，都建议您
  fork 本仓库，并在代码内修改软件默认更新源，否则本分支后续更新可能会覆盖您的修改。
- **声明：** 强烈不推荐直接在打包后的软件中修改源码，这将导致更新新版本与提交 PR 等操作无法顺利进行。
- **注释：** 下文中的建议版本为开发本软件时本人电脑上所安装的版本，其他环境均未测试。最低版本仅为估计的最低版本，实际可能更低或更高。

1. 安装 Node.js v20 或以上版本 *（建议：v22）*
2. 安装 Visual Studio v2019 或以上版本 *（建议：v2022）*
3. 安装 Python v3.8 或以上版本 *（建议：v3.12）*
4. 使用 Git 克隆本仓库代码：在终端中执行 `git clone https://github.com/daizihan233/ElectronClassSchedule.git`。
5. 在本项目根目录中打开终端并执行 `pip install setuptools`。
6. 在本项目根目录中打开终端并执行 `npm install`。
7. 在本项目根目录中打开终端并执行 `npm run build`。

- 执行上述环境及命令后，将在根目录生成一个 `dist` 文件夹，其中包含您本地打包好的软件安装包。
- 然后您可以修改软件代码，使用 `npm debug` 调试，使用 `npm run build` 打包。
- 如果您认为您修改开发的软件内容可能对其他人有相似需求，您可以通过 Git 向主分支 `main` 提交 PR（Pull
  Request）。通过审查后，您的代码将并入主分支，为更多的人提供便利。

## 开源协议

本软件遵循 `GPLv3` 开源协议，以下为该协议内容解读摘要:

* 可自由复制 你可以将软件复制到你的电脑，你客户的电脑，或者任何地方。复制份数没有任何限制
* 可自由分发 在你的网站提供下载，拷贝到U盘送人，或者将源代码打印出来从窗户扔出去（环保起见，请别这样做）。
* 可以用来盈利 你可以在分发软件的时候收费，但你必须在收费前向你的客户提供该软件的 GNU GPL 许可协议，以便让他们知道，他们可以从别的渠道免费得到这份软件，以及你收费的理由。
* 可自由修改 如果你想添加或删除某个功能，没问题，如果你想在别的项目中使用部分代码，也没问题，唯一的要求是，使用了这段代码的项目也必须使用 GPL 协议。
* 如果有人和接收者签了合同性质的东西，并提供责任承诺，则授权人和作者不受此责任连带。
