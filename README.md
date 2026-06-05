# 数据安全动态采集系统

基于 Electron 的桌面应用，当前实现了 FAA/OpenSky 航班动态分析、NTSB 事故趋势分析、数据采集入库和本地用户管理模块。应用支持登录保持、SQLite 用户数据库、外部航空数据源入库，以及基于本地数据库的聚合分析看板。

## 功能概览

- 登录与保持登录：用户账号、密码哈希和当前登录状态均保存在 SQLite 数据库中。
- 用户管理：支持新增、编辑用户名、编辑密码、重置密码、删除用户、搜索和分页。
- 默认管理员：当数据库用户表为空时，自动创建 `admin / admin123`，并在登录界面提示用户手动输入。
- OpenStreetMap 地图：使用 Leaflet 渲染全球航班位置。
- OpenSky 航班数据：在“数据采集入库”页面手动下载、解析并写入 SQLite，分析页面只读本地数据库。
- FAA 注册匹配：读取 FAA `ReleasableAircraft.zip`，通过 `MODE S CODE HEX` 与 OpenSky `icao24` 匹配。
- 航班详情：点击地图上的航班图标查看 OpenSky 原始字段和 FAA 注册信息。
- NTSB 事故趋势分析：基于 `ntsb_events`、`ntsb_aircraft`、`ntsb_narratives`、`ntsb_findings` 等表展示 KPI、年度趋势、严重度分布、事故空间聚合、飞机画像、天气和原因分类。
- 数据采集入库：支持 OpenSky、FAA、NTSB 数据源的下载、解析、入库和一键更新。
- 本地数据：运行时数据集中放在 `data/` 目录。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 桌面框架 | Electron 33 |
| 主进程数据库 | better-sqlite3 |
| 密码哈希 | bcryptjs |
| 地图 | Leaflet + OpenStreetMap |
| ZIP 解析 | adm-zip |
| MDB 解析 | mdb-reader |
| 打包 | electron-builder |
| 数据源 | OpenSky Network API, FAA Registry, NTSB Aviation Accident Database |

## 快速开始

```bash
npm install
npm start
```

首次启动时，如果 `data/app.db` 中没有用户，系统会创建默认管理员：

- 用户名：`admin`
- 密码：`admin123`

登录后建议立刻在“用户管理”中修改密码。

## 打包

```bash
npm run build
```

说明：

- `better-sqlite3` 是原生模块，`npm install` 后会通过 `postinstall` 执行 `electron-builder install-app-deps`。
- Windows 打包时如果遇到 `winCodeSign` 解压符号链接权限错误，可开启 Windows Developer Mode，或用管理员权限运行构建命令。
- 当前配置输出 Windows portable 程序到 `dist/`。

## 运行时数据

`data/` 目录用于保存运行时数据，通常不提交到版本库。

| 文件 | 用途 |
| --- | --- |
| `data/app.db` | SQLite 数据库，保存用户和登录状态 |
| `data/opensky_states_raw.json` | OpenSky 原始航班状态缓存 |
| `data/ReleasableAircraft.zip` | FAA 注册数据库 |
| `data/avall.zip` | NTSB 事故调查 Access 数据库缓存 |

旧的 `users.json` 和 `session.json` 已不再使用。用户数据和保持登录状态都由 `data/app.db` 管理。

## 数据库表

当前数据库由 `src/main/userService.js` 自动初始化。

`users` 表保存用户：

- `id`
- `username`
- `password_hash`
- `role`
- `created_at`
- `last_login`

`sessions` 表保存当前登录状态：

- `id` 固定为 `1`
- `user_id`
- `username`
- `role`
- `login_time`

当前实现为单会话模式，即本机只保留一个当前登录用户。

## 项目结构

```text
.
|-- main.js                    # Electron 主进程、IPC 注册、应用生命周期
|-- preload.js                 # contextBridge 暴露安全 API
|-- package.json
|-- src/
|   |-- main/
|   |   |-- cacheService.js    # data/ 文件路径和 JSON 缓存工具
|   |   |-- dataSourceService.js
|   |   |-- openskyDataSource.js
|   |   |-- faaDataSource.js
|   |   |-- ntsbDataSource.js
|   |   |-- faaService.js      # FAA ZIP 加载、解析、刷新
|   |   |-- openskyService.js  # OpenSky 拉取和缓存
|   |   |-- analysisService.js
|   |   |-- ntsbAnalysisService.js
|   |   `-- userService.js     # SQLite 用户、密码、会话管理
|   `-- renderer/
|       |-- index.html         # 登录页和主界面 DOM
|       |-- login.js           # 登录、保持登录、默认账号提示
|       |-- admin.js           # 用户管理界面
|       |-- import.js          # 数据采集入库界面
|       |-- app.js             # FAA/OpenSky 地图和分析模块
|       |-- ntsb.js            # NTSB 事故趋势分析模块
|       `-- style.css          # 样式
|-- docs/
|   |-- DEVELOPMENT.md
|   `-- NTSB事故趋势分析页面开发需求.md
`-- data/                      # 运行时数据，自动创建
```

## 使用说明

1. 启动应用并登录。
2. 首次无用户时，登录页会提示初始账号 `admin`、密码 `admin123`。
3. 切换到“数据采集入库”页面，对需要的数据源执行“一键更新”（或分步：下载 → 解析 → 入库）。
4. 切换到“FAA/OpenSky 分析”页面，点击“刷新分析数据”读取本地 SQLite 中的 OpenSky/FAA 数据。
5. 地图中已匹配 FAA 的航班会用不同颜色标识，点击航班图标可查看航班详情和 FAA 注册信息。
6. 切换到“NTSB 事故趋势分析”页面查看事故 KPI、趋势图、空间聚合、飞机画像、天气分布和原因分类。
7. 在“用户管理”中维护账号、修改用户名或密码。

## 数据源

- OpenSky Network API: `https://opensky-network.org/api/states/all`
- FAA Registry: `https://registry.faa.gov/database/ReleasableAircraft.zip`
- NTSB Aviation Accident Database: `https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.zip`
- 地图瓦片: OpenStreetMap
