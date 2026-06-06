# 数据安全动态采集系统

基于 Electron 的便携式航空数据采集与分析应用。项目使用应用层密态存储保护 SQLite 数据和下载缓存，并提供 FAA/OpenSky 航班分析、NTSB 事故趋势分析、数据源入库和本地用户管理。

## 主要功能

- 用户登录、保持登录和多用户管理。
- OpenSky 航班状态下载、密态入库和地图展示。
- FAA 注册飞机数据下载、密态入库及与 OpenSky 的盲索引匹配。
- NTSB 事故数据下载、解析、密态事实模型入库和趋势分析。
- NTSB 年份、国家、州/地区、严重度筛选。
- NTSB 年度趋势、事故地图、严重度、飞机画像、光照天气和原因分类。
- 所有运行文件保存在程序同级或项目目录下的 `data/`，不依赖 Windows DPAPI 或 AppData。
- Windows portable 单文件打包。

## 安全设计

- 敏感 payload：AES-256-GCM。
- 精确查询、关联和分组：HMAC-SHA-256 盲索引。
- 子密钥派生：HKDF-SHA-256。
- 登录解锁密钥派生：scrypt。
- 文本检索：加密倒排索引。
- 范围统计：离散桶 token。
- 原始下载缓存：分块 AES-256-GCM 加密并认证。
- 密码：bcrypt，当前成本为 12 rounds。

加密、解密和 token 计算只在 Electron 主进程中进行。渲染进程通过受限 IPC 获取业务结果，不接触密钥或通用解密能力。

## 快速开始

环境要求：

- Windows 10/11
- Node.js 20 或兼容版本
- npm

安装并启动：

```powershell
npm install
npm start
```

首次启动会创建默认管理员：

```text
用户名：admin
密码：admin123
```

首次登录后应在“系统管理”中修改密码。

## 使用流程

1. 使用账号密码登录，可按需勾选“保持登录”。
2. 进入“数据采集入库”页面。
3. 对 OpenSky、FAA 或 NTSB 执行“下载”“解析”“入库”或“一键更新”。
4. 在 FAA/OpenSky 页面刷新并查看航班及 FAA 匹配。
5. 在 NTSB 页面查看事故趋势并使用年份、国家、州/地区、严重度筛选。
6. 飞机画像中的类别和制造商列表仅用于展示，不参与筛选。
7. 点击“注销”会清除当前数据库 session，并撤销保持登录令牌。

NTSB 地图只展示有效经纬度记录。缺少坐标、坐标越界或恰好为 `(0,0)` 的事故不会进入地图聚合。

## 运行时文件

开发环境使用项目根目录的 `data/`；portable 构建使用可执行文件同级的 `data/`。

| 文件 | 说明 |
| --- | --- |
| `data/app.db` | SQLite 密态数据库 |
| `data/app.db-wal` / `app.db-shm` | SQLite WAL 运行文件 |
| `data/keyring.json` | 便携 keyring，保存加密封装后的根密钥和主密钥 |
| `data/login-session.json` | 勾选“保持登录”后生成的随机会话凭据 |
| `data/opensky_states.securecache` | OpenSky 加密缓存 |
| `data/faa-aircraft.securecache` | FAA 加密缓存 |
| `data/ntsb-aviation.securecache` | NTSB 加密缓存 |
| `data/electron-profile/` | Electron 本地运行配置 |

`data/` 已被 `.gitignore` 排除，不应提交到版本库。

`keyring.json` 不包含明文主密钥。`login-session.json` 不包含账号密码，但它是保持登录凭据；复制完整 `data/` 会同时复制保持登录能力。点击注销可撤销该凭据。

## 数据库概览

数据库仅保留查询所需 token、非敏感运行元数据和加密 payload，主要表包括：

- `users`、`sessions`
- `opensky_states`
- `faa_aircraft`
- `secure_dimensions`
- `ntsb_events_secure`
- `ntsb_aircraft_secure`
- `ntsb_records_secure`
- `ntsb_event_facts`
- `ntsb_aircraft_facts`
- `ntsb_finding_facts`
- `secure_terms`
- `import_status`

数据库中不保留用户名、ICAO、FAA 个人信息、NTSB 原始事件字段等明文兼容列。

## 项目结构

```text
.
|-- main.js
|-- preload.js
|-- src/
|   |-- main/
|   |   |-- databaseService.js
|   |   |-- userService.js
|   |   |-- dataSourceService.js
|   |   |-- openskyDataSource.js
|   |   |-- faaDataSource.js
|   |   |-- ntsbDataSource.js
|   |   |-- analysisService.js
|   |   |-- ntsbAnalysisService.js
|   |   `-- security/
|   |       |-- keyService.js
|   |       |-- cryptoService.js
|   |       |-- secureCacheService.js
|   |       |-- searchIndexService.js
|   |       |-- dimensionService.js
|   |       |-- normalizers.js
|   |       |-- buckets.js
|   |       |-- geo.js
|   |       `-- rememberSessionService.js
|   `-- renderer/
|       |-- index.html
|       |-- login.js
|       |-- app.js
|       |-- ntsb.js
|       |-- import.js
|       |-- admin.js
|       `-- style.css
|-- test/
|   |-- security.test.js
|   `-- electron-smoke.js
|-- docs/
|   `-- DEVELOPMENT.md
`-- data/
```

## 开发与测试

```powershell
npm test
npm run test:electron
```

- `npm test`：密码学、keyring、保持登录、缓存认证、normalizer、桶和坐标规则测试。
- `npm run test:electron`：在 Electron ABI 下执行数据库和端到端安全冒烟测试。

`better-sqlite3` 会由 `postinstall` 针对 Electron ABI 重建，因此普通 Node 运行时可能无法直接加载该原生模块。

## 打包

```powershell
npm run build
```

构建结果位于 `dist/`，目标为 Windows portable：

```text
数据安全动态采集系统.exe
```

如 `electron-builder` 解压 `winCodeSign` 时遇到符号链接权限错误，请开启 Windows Developer Mode 或使用管理员终端。

## 数据源

- OpenSky Network API: <https://opensky-network.org/api/states/all>
- FAA Registry: <https://registry.faa.gov/database/ReleasableAircraft.zip>
- NTSB Aviation Accident Database: <https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.zip>
- 地图瓦片: OpenStreetMap

更详细的架构、schema、IPC 和开发约定见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
