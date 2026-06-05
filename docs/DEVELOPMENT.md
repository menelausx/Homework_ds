# 开发文档

本文档用于说明当前项目结构、关键流程和后续开发约定。

## 架构概览

应用采用 Electron 的主进程 + 预加载桥接 + 渲染进程结构。

```text
Renderer Process
  index.html
  login.js / import.js / admin.js / app.js / style.css
          |
          | window.electronAPI
          v
Preload
  preload.js
          |
          | ipcRenderer.invoke / ipcRenderer.on
          v
Main Process
  main.js
  src/main/userService.js          ← 用户/会话管理
  src/main/cacheService.js         ← 文件缓存读写
  src/main/databaseService.js      ← 数据表数据库连接
  src/main/dataSourceService.js    ← 数据源注册与调度
  src/main/openskyDataSource.js    ← OpenSky 数据源（下载/解析/入库）
  src/main/faaDataSource.js        ← FAA 数据源（下载/解析/入库）
  src/main/analysisService.js      ← SQLite 分析查询服务
  src/main/faaService.js           ← FAA 解析工具（被 faaDataSource 复用）
  src/main/openskyService.js       ← OpenSky API 工具（被 openskyDataSource 复用）
```

安全设置：

- `contextIsolation: true`
- `nodeIntegration: false`
- 渲染进程不能直接访问 Node.js API
- 所有文件、数据库、网络能力都通过主进程 IPC 提供
- 渲染端只使用 `window.electronAPI`

## 启动流程

`main.js` 中的启动顺序：

1. `app.whenReady()`
2. `userService.seedDefaultAdmin()`
3. 如果用户表为空，创建默认账号 `admin / admin123`
4. 如果创建了默认账号，清空 session，防止自动登录
5. `createWindow()`
6. 注册 Auth、Users、Analysis、DataSources、Shell IPC
7. 应用就绪（不再后台加载 FAA 文件；分析页面从 SQLite 读取数据）

渲染端脚本加载顺序很重要：

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="admin.js"></script>
<script src="import.js"></script>
<script src="app.js"></script>
<script src="login.js"></script>
```

`login.js` 必须在 `app.js` 之后加载。保持登录恢复成功时，它会调用 `AppModule.onLogin()`，进而初始化 `FaaOpenskyModule`。

## 标签页结构

当前共三个标签页，按顺序：

1. **FAA/OpenSky 分析** (`faa-opensky`) — 地图、航班图层、FAA 匹配、详情面板
2. **数据采集入库** (`import`) — 卡片式数据源列表，下载/解析/入库/一键更新
3. **系统管理** (`admin`) — 用户管理

标签切换由 `AppModule.switchTab()` 统一管理。每个标签页激活时调用对应模块的 `onActivate()` 方法。

## 用户与会话

用户和登录状态全部由 SQLite 管理，数据库文件为：

```text
data/app.db
```

相关代码集中在：

```text
src/main/userService.js
```

### users 表

保存账号信息。

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  last_login TEXT
);
```

说明：

- 密码使用 `bcryptjs` 哈希后保存。
- `role` 当前固定为 `admin`，后续可扩展权限。
- 登录成功时更新 `last_login`。
- 不再使用 `users.json`。

### sessions 表

保存当前保持登录状态。

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  login_time TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

说明：

- 当前是单会话模式，表中最多一条记录。
- 登录成功：`saveSession(user)` 写入或覆盖 `id = 1`。
- 应用启动：`loadSession()` 根据 `user_id` 查询 `users` 表恢复登录。
- 退出登录：`clearSession()` 清空表。
- 不再使用 `session.json`。

## 登录流程

普通登录：

1. 用户在登录页输入账号密码。
2. `login.js` 调用 `window.electronAPI.login(username, password)`。
3. `main.js` 的 `auth:login` 调用 `userService.verifyLogin()`。
4. 密码校验成功后调用 `userService.saveSession()`。
5. 渲染端调用 `AppModule.onLogin()`，初始化 FAA/OpenSky 模块。

保持登录：

1. `login.js` 启动时调用 `getBootstrapInfo()`。
2. 如果本次启动创建了默认账号，登录页显示初始账号提示。
3. 调用 `getCurrentUser()`。
4. 主进程从 `sessions` 表读取当前登录用户。
5. 用户存在则隐藏登录页，并调用 `AppModule.onLogin()`。

默认账号：

- 当 `users` 表为空时自动创建。
- 登录页提示 `admin / admin123`。
- 不自动填入输入框，也不自动登录。

## IPC 通道

Auth：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `auth:login` | `username, password` | `{ success, user?, error? }` |
| `auth:logout` | - | `{ success, error? }` |
| `auth:me` | - | 当前用户或 `null` |
| `auth:bootstrapInfo` | - | `{ defaultAdminCreated }` |

Users：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `users:list` | `{ page, limit, search }` | `{ users, total, page, limit }` |
| `users:create` | `username, password` | `{ success, user?, error? }` |
| `users:update` | `id, username, password?` | `{ success, user?, error? }` |
| `users:delete` | `id` | `{ success, error? }` |
| `users:resetPassword` | `id, newPassword` | `{ success, error? }` |

Analysis（FAA/OpenSky 分析页面，SQLite 只读查询）：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `analysis:getFlights` | - | `{ time, cacheTime, states, snapshotTime }` |
| `analysis:getFlight` | `icao24` | 单条航班记录或 `null` |
| `analysis:getStatistics` | - | `{ flightCount, faaMatched, faaTotalRecords, faaLoaded, faaError, snapshotTime }` |
| `analysis:getFaaInfo` | `icao24` | FAA 记录（CSV 字段名格式）或 `null` |
| `analysis:getFaaInfoBulk` | `icao24List` | `{ [icao24]: record }` |

> **所有分析数据来自 SQLite，无网络请求、无文件回退。**

Data Sources（数据采集入库）：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `dataSources:list` | - | 数据源列表，含状态信息 |
| `dataSources:status` | `sourceId` | 单个数据源的状态详情 |
| `dataSources:download` | `sourceId` | `{ success, error? }` |
| `dataSources:parse` | `sourceId` | `{ success, recordCount?, error? }` |
| `dataSources:import` | `sourceId` | `{ success, recordCount?, error? }` |
| `dataSources:updateAll` | `sourceId` | `{ success, phases[], error? }` |

其中 `sourceId` 取值：
- `opensky_states` — OpenSky 全量航班状态数据
- `faa_aircraft` — FAA 注册飞机数据库

## FAA/OpenSky 分析数据流（SQLite 驱动）

分析页面完全基于 SQLite 运行，不直接访问外部 API 或文件。

```text
┌─────────────────────────────────────────────────────┐
│ 数据采集入库页面                                      │
│   → 下载原始数据 → 解析 → 写入 SQLite                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌────────────────── SQLite ──────────────────────────┐
│  opensky_states          faa_aircraft               │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ analysis: IPC (只读查询)
                       ▼
┌─────────────────────────────────────────────────────┐
│ FAA/OpenSky 分析页面                                  │
│   → analysisService.getFlights()                    │
│   → analysisService.getFaaInfo() / getFaaInfoBulk() │
│   → 地图展示 + FAA 匹配 + 详情面板                      │
└─────────────────────────────────────────────────────┘
```

### 数据流（新版）

1. 用户在”数据采集入库”页面导入数据 → 写入 `opensky_states` / `faa_aircraft` 表。
2. 切换到”FAA/OpenSky 分析”页面。
3. 页面激活时从数据库加载航班数据和 FAA 统计数据。
4. 地图渲染所有航班，FAA 匹配通过 SQLite 查询完成。

### 匹配逻辑

匹配字段（与之前一致）：

```text
FAA:     faa_aircraft.mode_s_code_hex
OpenSky: opensky_states.icao24
```

- 统一小写匹配。
- `analysisService.getFaaInfo(icao24)` — 单条查询。
- `analysisService.getFaaInfoBulk(icao24List)` — 批量查询，SQL `IN` 子句分块（500/批）。
- 统计数据中的 FAA 匹配数通过 `INNER JOIN` 在数据库层完成。

## 数据采集入库

### 架构

新增"数据采集入库"标签页，采用可扩展的数据源注册模式。每个数据源实现统一接口，由 `dataSourceService.js` 集中调度。

```text
Renderer (import.js)
  -> 卡片式列表，每个数据源一张卡片
  -> 按钮：下载 / 解析 / 入库 / 一键更新
          |
          | window.electronAPI (IPC)
          v
dataSourceService.js           ← 中央注册表，调度数据源
  ├── openskyDataSource.js     ← OpenSky 全量航班状态数据
  └── faaDataSource.js         ← FAA 注册飞机数据库
          |
          v
databaseService.js             ← SQLite 数据表读写
```

### 数据源接口

每个数据源模块必须导出：

| 属性/方法 | 类型 | 说明 |
| --- | --- | --- |
| `sourceId` | `string` | 唯一标识，如 `opensky_states` |
| `name` | `string` | 显示名称 |
| `description` | `string` | 功能说明 |
| `url` | `string` | 数据来源 URL |
| `download()` | `async function` | 从远程获取原始数据，保存到本地缓存 |
| `parse()` | `async function` | 将缓存数据解析为结构化对象 |
| `importToDatabase(parsedData?)` | `async function` | 将结构化数据写入 SQLite |
| `updateAll()` | `async function` | 下载 + 解析 + 入库一键完成 |
| `getStatus()` | `function` | 返回当前状态（记录数、各步骤时间） |

### 数据流

#### OpenSky

```text
OpenSky API (https://opensky-network.org/api/states/all)
  -> openskyDataSource.download()
  -> data/opensky_states_raw.json          (原始 JSON 缓存)
  -> openskyDataSource.parse()
  -> convertStatesToObjectsAll()           (数组转具名字段)
  -> openskyDataSource.importToDatabase()
  -> opensky_states 表 (SQLite)
```

说明：
- 只有用户点击按钮时才请求，**不自动轮询**。
- 保留所有航班（包括无经纬度），标记 `has_position` 字段。
- `icao24` 统一小写，`callsign` 去除首尾空白。
- 每次入库先清空表，再全量写入。
- 复用 `openskyService.fetchOpenSkyData()` 进行 API 请求。

#### FAA

```text
FAA 官网 (https://registry.faa.gov/database/ReleasableAircraft.zip)
  -> faaDataSource.download()
  -> data/ReleasableAircraft.zip           (本地缓存)
  -> faaDataSource.parse()
  -> AdmZip -> MASTER.txt -> parseCSVLine()
  -> faaDataSource.importToDatabase()
  -> faa_aircraft 表 (SQLite)
```

说明：
- `MODE S CODE HEX` 统一转小写，方便与 OpenSky `icao24` 匹配。
- 每次入库先清空表，再全量写入。
- 复用 `faaService.downloadFile()` / `faaService.loadFromZip()` / `faaService.parseMasterText()`。

### 数据库表

`opensky_states` 和 `faa_aircraft` 由 `databaseService.js` 在首次使用时自动创建。表结构与索引见 [databaseService.js](../src/main/databaseService.js) `initializeSchema()` 函数。

`databaseService.js` 使用独立的 `better-sqlite3` 连接（与 `userService.js` 连接相互独立，操作同一数据库文件）。SQLite WAL 模式保证并发安全。

### 添加新数据源

1. 在 `src/main/` 创建新文件（如 `airportDataSource.js`），实现上述标准接口。
2. 在 `dataSourceService.js` 中 `require` 并 `registry.set()`。
3. 前端自动通过 `dataSources:list` 发现新数据源并渲染卡片。

**无需修改 UI 代码、HTML 或 CSS。**

## 前端模块

### login.js

负责：

- 登录页显示/隐藏
- 手动登录
- 保持登录恢复
- 默认账号提示
- 退出登录

注意：

- 不要在 `login.js` 中直接初始化 FAA 模块。
- 登录成功统一调用 `AppModule.onLogin()`。

### admin.js

负责用户管理：

- 列表、搜索、分页
- 新建用户
- 编辑用户名
- 编辑密码
- 重置密码
- 删除用户

编辑用户时，密码输入框留空表示不修改密码。

### import.js

负责数据采集入库页面：

- 卡片式展示所有数据源。
- 每个卡片显示：名称、说明、URL、状态、最近下载/解析/入库时间、记录数、错误信息。
- 操作按钮：下载、解析、入库、一键更新。
- 操作中显示 loading 阶段（downloading / parsing / importing / completed / failed）。
- 错误信息显示在对应数据源卡片中。

### app.js

包含两个模块：

- `AppModule`：标签页切换（含三个标签）和登录生命周期入口。
- `FaaOpenskyModule`：地图、航班图层、FAA 匹配、详情面板。

`FaaOpenskyModule.initialize()` 只应在登录后调用一次。

分析模块的数据来源已改为 SQLite：
- `loadFromDatabase()` — 通过 `analysis:getFlights` + `analysis:getStatistics` 加载数据。
- `preloadFaaCache()` — 通过 `analysis:getFaaInfoBulk` 批量获取 FAA 匹配数据。
- `showFaaInfo()` — 通过 `analysis:getFaaInfo` 获取单条 FAA 记录。
- 不再调用 `refreshFlights()`、`refreshFaaDatabase()` 等外部 API 方法。
- 工具栏仅保留一个"刷新分析数据"按钮（重新查询数据库）。

## 依赖说明

| 依赖 | 用途 |
| --- | --- |
| `electron` | 桌面应用运行时 |
| `electron-builder` | 打包 |
| `better-sqlite3` | SQLite 数据库 |
| `bcryptjs` | 密码哈希 |
| `adm-zip` | FAA ZIP 解析 |
| `leaflet` | 地图渲染，当前从 CDN 加载 |

`better-sqlite3` 是原生模块。安装依赖后需要面向 Electron 重建，项目通过：

```json
"postinstall": "electron-builder install-app-deps"
```

自动处理。

## 开发命令

```bash
npm install
npm start
npm run build
```

常用检查：

```bash
node -c main.js
node -c preload.js
node -c src/main/userService.js
node -c src/main/databaseService.js
node -c src/main/dataSourceService.js
node -c src/main/openskyDataSource.js
node -c src/main/faaDataSource.js
node -c src/main/openskyService.js
node -c src/main/faaService.js
node -c src/main/cacheService.js
node -c src/main/analysisService.js
node -c src/renderer/login.js
node -c src/renderer/import.js
node -c src/renderer/admin.js
node -c src/renderer/app.js
```

注意：`better-sqlite3` 重建为 Electron ABI 后，普通 Node 可能无法直接加载该模块进行运行时测试。语法检查仍可用，运行行为以 Electron 环境为准。

## 添加新模块

### 添加新的功能标签页

推荐步骤：

1. 在 `src/main/` 新建服务，例如 `xxxService.js`。
2. 在 `main.js` 添加 `setupXxxIpcHandlers()`。
3. 在 `preload.js` 暴露必要 API。
4. 在 `src/renderer/` 新建前端模块（如 `xxx.js`）。
5. 在 `index.html` 添加标签页 DOM、模块容器和脚本引用。
6. 在 `AppModule` 中加入标签页切换和 `onActivate()` 逻辑。

约定：

- 主进程负责数据、文件、网络和数据库。
- 渲染进程只负责 UI 和用户交互。
- 不在渲染进程直接读取文件或访问数据库。

### 添加新的数据源

添加新数据源只需三步，无需改动 UI：

1. 在 `src/main/` 创建数据源模块（如 `airportDataSource.js`），实现标准接口：
   - `sourceId`、`name`、`description`、`url`
   - `download()`、`parse()`、`importToDatabase()`、`updateAll()`、`getStatus()`
2. 在 `dataSourceService.js` 中注册：
   ```js
   const airportDataSource = require('./airportDataSource');
   registry.set(airportDataSource.sourceId, airportDataSource);
   ```
3. 如需新建数据库表，在 `databaseService.js` 的 `initializeSchema()` 中添加建表语句。

前端通过 `dataSources:list` 自动发现新数据源并渲染卡片，**无需额外修改 HTML、CSS 或 UI 代码**。

## 常见问题

### 保持登录后 FAA 模块没有启动

确认 `index.html` 脚本顺序为：

```html
admin.js
import.js
app.js
login.js
```

`login.js` 必须最后加载，否则恢复 session 时可能找不到 `AppModule`。

### 初始账号提示不出现

提示只在 `users` 表为空并自动创建默认账号的那次启动出现。如果数据库已有用户，不会显示默认账号提示。

### 分析页面无数据

分析页面完全基于 SQLite 运行。如果没有数据：

1. 切换到”数据采集入库”页面。
2. 对 OpenSky 和 FAA 数据源点击”一键更新”（或分步：下载 → 解析 → 入库）。
3. 切换回”FAA/OpenSky 分析”页面，点击”刷新分析数据”。

分析页面不会自动触发任何下载或外部 API 请求。

### Windows 打包失败，提示符号链接权限

`electron-builder` 下载并解压 `winCodeSign` 时可能需要创建符号链接。解决方式：

- 开启 Windows Developer Mode。
- 或使用管理员权限运行构建命令。

### 不应再使用的文件

以下文件已废弃：

- `data/users.json`
- `data/session.json`

如果本地仍存在，它们不会被当前代码读取。

### 数据采集入库操作说明

- 所有数据源**不会自动下载**，需要用户在"数据采集入库"页面手动点击按钮。
- **一键更新** = 下载 + 解析 + 入库，适合首次使用或需要完全刷新数据时。
- 单独点击**下载**仅保存原始数据到 `data/` 目录，不会写入数据库。
- 单独点击**解析**读取本地缓存，不发起网络请求。
- 单独点击**入库**执行解析 + 写入数据库两步操作。
- 下次软件启动后，数据采集入库页面显示的是上次操作的状态（记录数、各步骤时间等）。

### OpenSky 与 FAA 在分析页面和采集页面的关系

两个页面共享同一数据源（SQLite），分工明确：

- **数据采集入库页面**：负责下载原始数据、解析、写入 SQLite（`opensky_states` / `faa_aircraft` 表）。
- **FAA/OpenSky 分析页面**：只读 SQLite，地图展示、FAA 匹配、详情查询。

分析页面不再直接访问文件或 API。所有数据必须先在采集页面入库，才能在分析页面查看。
