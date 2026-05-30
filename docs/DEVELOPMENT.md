# 开发文档

本文档用于说明当前项目结构、关键流程和后续开发约定。

## 架构概览

应用采用 Electron 的主进程 + 预加载桥接 + 渲染进程结构。

```text
Renderer Process
  index.html
  login.js / admin.js / app.js / style.css
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
  src/main/userService.js
  src/main/faaService.js
  src/main/openskyService.js
  src/main/cacheService.js
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
6. 注册 Auth、Users、FAA、OpenSky IPC
7. 后台初始化 FAA 数据库

渲染端脚本加载顺序很重要：

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="admin.js"></script>
<script src="app.js"></script>
<script src="login.js"></script>
```

`login.js` 必须在 `app.js` 之后加载。保持登录恢复成功时，它会调用 `AppModule.onLogin()`，进而初始化 `FaaOpenskyModule`。

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

FAA：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `faa:get-stats` | - | `{ recordCount, loaded, error }` |
| `faa:get-info` | `icao24` | FAA 记录或 `null` |
| `faa:get-info-bulk` | `icao24List` | `{ [icao24]: record }` |
| `faa:refresh` | - | `{ success, recordCount?, error? }` |
| `faa:ready` | 主进程推送 | FAA 加载完成 |
| `faa:error` | 主进程推送 | FAA 加载失败 |

OpenSky：

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `opensky:get-flights` | - | `{ time, cacheTime, states }` |
| `opensky:refresh` | - | `{ success, flightCount?, cacheTime?, error? }` |

## FAA/OpenSky 数据流

### OpenSky

```text
OpenSky API
  -> openskyService.refresh()
  -> fetchOpenSkyData()
  -> convertStatesToObjects()
  -> cacheService.writeJsonFile('opensky-cache.json')
  -> renderer getFlightData()
  -> FaaOpenskyModule 绘制航班
```

说明：

- 启动时不会自动请求 OpenSky。
- 首次无缓存时，需要用户点击“刷新航班数据”。
- 缓存文件为 `data/opensky-cache.json`。

### FAA

```text
ReleasableAircraft.zip
  -> faaService.initialize()
  -> AdmZip 读取 MASTER.txt
  -> parseCSVLine()
  -> Map<mode_s_code_hex, record>
  -> faa:get-info / faa:get-info-bulk
```

匹配字段：

```text
FAA:     MODE S CODE HEX
OpenSky: icao24
```

匹配时统一转为小写并去除空白。

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

### app.js

包含两个模块：

- `AppModule`：标签页切换和登录生命周期入口。
- `FaaOpenskyModule`：地图、航班图层、FAA 匹配、详情面板。

`FaaOpenskyModule.initialize()` 只应在登录后调用一次。

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
node -c src/renderer/login.js
node -c src/renderer/admin.js
node -c src/renderer/app.js
```

注意：`better-sqlite3` 重建为 Electron ABI 后，普通 Node 可能无法直接加载该模块进行运行时测试。语法检查仍可用，运行行为以 Electron 环境为准。

## 添加新模块

推荐步骤：

1. 在 `src/main/` 新建服务，例如 `xxxService.js`。
2. 在 `main.js` 添加 `setupXxxIpcHandlers()`。
3. 在 `preload.js` 暴露必要 API。
4. 在 `src/renderer/` 新建或扩展前端模块。
5. 在 `index.html` 添加 DOM 和脚本引用。
6. 在 `AppModule` 中加入标签页切换和登录后初始化逻辑。

约定：

- 主进程负责数据、文件、网络和数据库。
- 渲染进程只负责 UI 和用户交互。
- 不在渲染进程直接读取文件或访问数据库。

## 常见问题

### 保持登录后 FAA 模块没有启动

确认 `index.html` 脚本顺序为：

```html
admin.js
app.js
login.js
```

`login.js` 必须最后加载，否则恢复 session 时可能找不到 `AppModule`。

### 初始账号提示不出现

提示只在 `users` 表为空并自动创建默认账号的那次启动出现。如果数据库已有用户，不会显示默认账号提示。

### FAA 数据库未加载

确认以下任一路径存在：

- `data/ReleasableAircraft.zip`
- 开发环境项目根目录下的 `ReleasableAircraft.zip`

也可以在界面点击“下载 FAA 数据库”重新下载。

### 航班数据为空

- 首次启动通常没有 OpenSky 缓存。
- 点击“刷新航班数据”。
- OpenSky API 可能偶发不可用，稍后重试。

### Windows 打包失败，提示符号链接权限

`electron-builder` 下载并解压 `winCodeSign` 时可能需要创建符号链接。解决方式：

- 开启 Windows Developer Mode。
- 或使用管理员权限运行构建命令。

### 不应再使用的文件

以下文件已废弃：

- `data/users.json`
- `data/session.json`

如果本地仍存在，它们不会被当前代码读取。
