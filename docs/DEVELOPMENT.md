# 开发文档

本文档描述当前代码的实际架构、安全边界、数据模型和开发流程。修改安全模块、数据库 schema、IPC 或数据源前应先阅读本文。

## 架构

```text
Renderer
  index.html
  login.js / app.js / ntsb.js / import.js / admin.js
       |
       | window.electronAPI
       v
Preload
  preload.js
       |
       | ipcRenderer.invoke
       v
Main
  main.js
  userService / dataSourceService / analysis services
  databaseService
  security/*
       |
       v
data/
  keyring.json
  login-session.json
  app.db
  *.securecache
```

Electron 安全设置：

- `contextIsolation: true`
- `nodeIntegration: false`
- 文件、网络、数据库和密码学能力只存在于主进程
- preload 只暴露明确的业务 API
- 渲染端不存在通用 SQL、文件读取或解密接口

## 启动流程

`main.js` 的当前启动顺序：

1. 将 Electron `userData` 指向 `data/electron-profile`。
2. `keyService.initialize()` 读取或创建 `data/keyring.json`。
3. 首次启动时创建密态 schema 和默认管理员 `admin / admin123`。
4. 非首次启动且存在 `login-session.json` 时，尝试恢复保持登录。
5. 创建 BrowserWindow。
6. 注册 Auth、Users、DataSources、Analysis、NTSB 和 Shell IPC。
7. 渲染端 `login.js` 调用 `auth:me`，决定显示登录页或主界面。

首次初始化失败、keyring 格式无效或发现旧版明文数据库时采用 fail-closed，不会回退到明文存储。

渲染脚本顺序：

```html
admin.js
import.js
ntsb.js
app.js
login.js
```

`login.js` 最后加载，登录或恢复成功后调用 `AppModule.onLogin()`。

## 便携目录

开发模式：

```text
<project>/data/
```

portable 模式：

```text
<exe-directory>/data/
```

项目不使用 Windows DPAPI，也不将业务数据写入 AppData。移动应用时应整体移动可执行文件和 `data/`。

## 密钥体系

### keyring

`src/main/security/keyService.js` 管理两级密钥：

```text
登录密码或会话令牌
  -> scrypt(N=32768, r=8, p=1)
  -> 解封 root key
  -> 解封一个或多个 versioned master key
  -> HKDF-SHA-256 派生业务子密钥
```

`data/keyring.json` 当前格式版本为 2，包含：

- 当前主密钥版本
- scrypt 参数
- 用户密码解锁槽
- 可撤销的保持登录会话槽
- 由 root key 封装的版本化主密钥

写入 keyring 使用临时文件和原子替换。主密钥、root key 和登录密码均不以明文写入文件。

### 子密钥域

`cryptoService.js` 和其他安全模块使用显式 domain 分离密钥，主要包括：

- 通用 payload 加密
- 用户名、角色盲索引
- OpenSky ICAO 与 FAA Mode-S 连接
- NTSB event、aircraft 连接
- NTSB 分析维度
- narratives/findings 文本 term
- 原始缓存加密

禁止在不同字段间随意复用 domain。

### payload 加密

敏感 payload 使用 AES-256-GCM：

- 12 字节随机 nonce
- 16 字节认证 tag
- envelope 内含格式版本和密钥版本
- AAD 绑定 `recordType`、`field` 和 `recordId`

认证失败必须返回受控错误，不能忽略或降级读取。

### 盲索引

精确查询和连接使用：

```text
HMAC-SHA-256(derived domain key, canonicalized value)
```

token 以固定 32 字节 BLOB 存储。所有写入和查询必须复用 `normalizers.js` 中的相同规范化规则。

### 保持登录

`rememberSessionService.js` 在用户勾选“保持登录”后：

1. 生成 32 字节随机令牌。
2. 在 keyring 中创建 `kind: session` 的可撤销解锁槽。
3. 将 `userId`、`slotId` 和令牌写入 `data/login-session.json`。
4. 下次启动先解锁 keyring，再读取数据库 `sessions` 验证用户一致性。

明确注销会删除 `login-session.json` 并撤销对应会话槽。未勾选保持登录时，重启后必须重新输入密码。

该文件不包含用户名或密码，但它是可直接恢复登录的凭据。安全评估时应把它视为 bearer credential。

## 密态数据库

`databaseService.js` 使用 `better-sqlite3`，启用：

```text
journal_mode = WAL
foreign_keys = ON
busy_timeout = 5000
trusted_schema = OFF
```

schema 版本记录于 `schema_meta`。当前不迁移旧明文数据库。

### 用户

`users` 保存：

- 随机 `record_id`
- `username_token`
- `role_token`
- bcrypt `password_hash`
- 加密用户 payload
- `key_version`
- 创建时间和最后登录时间

登录流程：

1. 登录密码解锁 keyring。
2. 规范化用户名并计算 `username_token`。
3. 使用 token 定位用户。
4. bcrypt 验证密码。
5. 解密最小用户 payload。
6. 写入单会话 `sessions`。

用户搜索在主进程中解密少量用户后过滤，不建立用户名模糊搜索索引。

### OpenSky

`opensky_states` 主要保存：

- `snapshot_time`
- `icao_token`
- `has_position_token`
- `payload_cipher`
- `key_version`

`analysisService` 只读取最新快照，在主进程解密后返回兼容 UI 的对象。

### FAA

`faa_aircraft` 主要保存：

- 与 OpenSky 共用连接域的 `mode_s_token`
- `n_number_token`
- `mfr_model_token`
- `payload_cipher`
- `key_version`

FAA 与 OpenSky 的匹配由 token JOIN 完成，不需要解密后逐条比较。

### NTSB

NTSB 不再将 Access 表原样明文复制到 SQLite，而是拆分为：

| 表 | 用途 |
| --- | --- |
| `ntsb_events_secure` | 完整事件 payload 密文 |
| `ntsb_aircraft_secure` | 完整飞机 payload 密文 |
| `ntsb_records_secure` | narratives、findings、crew、engines、injury 密文 |
| `ntsb_event_facts` | 事件筛选和聚合 token |
| `ntsb_aircraft_facts` | 飞机类别、制造商、机型、损坏和机龄 token |
| `ntsb_finding_facts` | finding 分类和描述分组 token |
| `secure_dimensions` | token 到加密显示值的维度字典 |
| `secure_terms` | narratives/findings 加密倒排索引 |

事件与飞机连接分别使用共享的 NTSB event token 和 aircraft token。

### 维度字典

SQL 按 token 聚合后，`dimensionService.getMany()` 批量读取并解密显示值。数据库中不为了图表标签保留明文国家、州、天气、严重度、飞机类别或 finding 分类。

### 范围与全文

- 年份通过离散 `year_token` 集合查询，不使用顺序保持加密。
- 能见度、风速和机龄使用 `buckets.js` 生成离散桶。
- narratives 和 findings 使用 `searchIndexService.js` 生成分域 term token。

## 加密缓存

数据源缓存文件：

| 数据源 | 文件 |
| --- | --- |
| OpenSky | `opensky_states.securecache` |
| FAA | `faa-aircraft.securecache` |
| NTSB | `ntsb-aviation.securecache` |

`secureCacheService.js` 使用 1 MiB 默认分块：

- 每块独立 AES-256-GCM nonce 和 tag
- header 经过认证
- AAD 绑定缓存 ID、块序号、块数量和原文长度
- 可检测篡改、截断、追加和块重排

缓存读取后的明文 Buffer 应尽快清零。

## 数据源流程

统一接口由 `dataSourceService.js` 调度：

```js
{
  sourceId,
  name,
  description,
  url,
  download,
  parse,
  importToDatabase,
  updateAll,
  getStatus,
  getCacheFiles
}
```

数据流：

```text
remote source
  -> download
  -> encrypted .securecache
  -> parse in main process
  -> encrypted payload + blind indexes in SQLite
  -> aggregate/read services
  -> IPC
  -> renderer
```

`import_status` 保存记录数和最近下载、解析、入库时间。

### NTSB 坐标规则

`security/geo.js` 统一处理坐标：

- 空值和空字符串视为无坐标
- 纬度必须位于 `[-90, 90]`
- 经度必须位于 `[-180, 180]`
- 精确 `(0,0)` 视为无效
- 单独纬度 0 或经度 0 仍可有效

无效坐标不会生成 `geo_cell_token`，分析服务和前端地图还会再次过滤 `(0,0)`。

## NTSB 分析页面

当前顶部筛选项：

- 起始年份
- 结束年份
- 国家
- 州/地区
- 严重度

飞机类别和损坏程度筛选已从 UI 删除。飞机画像中的类别、制造商列表为只读展示，禁止点击筛选。

页面加载通过 7 个聚合 IPC 获取：

- KPI 总览
- 年度趋势
- 严重度分布
- 地图聚合
- 飞机画像
- 光照天气
- finding 分类

注意：这些 IPC 内部目前使用同步 `better-sqlite3`，运行在 Electron 主线程。新增高成本筛选或 JOIN 前必须检查查询计划，尤其避免在大表上反复执行相关 `EXISTS` 子查询。

## IPC

### Auth

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `auth:login` | `username, password, rememberLogin` | `{ success, user?, error? }` |
| `auth:logout` | 无 | `{ success, error? }` |
| `auth:me` | 无 | 当前用户或 `null` |
| `auth:bootstrapInfo` | 无 | `{ defaultAdminCreated }` |

### Users

| 通道 | 参数 |
| --- | --- |
| `users:list` | `{ page, limit, search }` |
| `users:create` | `username, password` |
| `users:update` | `id, username, password?` |
| `users:delete` | `id` |
| `users:resetPassword` | `id, newPassword` |

### FAA/OpenSky Analysis

- `analysis:getFlights`
- `analysis:getFlight`
- `analysis:getStatistics`
- `analysis:getFaaInfo`
- `analysis:getFaaInfoBulk`

### NTSB Analysis

- `ntsb:getFilterOptions`
- `ntsb:getOverview`
- `ntsb:getYearlyTrend`
- `ntsb:getSeverityDistribution`
- `ntsb:getGeoAggregation`
- `ntsb:getAircraftBreakdown`
- `ntsb:getWeatherBreakdown`
- `ntsb:getFindingBreakdown`
- `ntsb:searchNarratives`
- `ntsb:searchFindings`

### Data Sources

- `dataSources:list`
- `dataSources:status`
- `dataSources:download`
- `dataSources:parse`
- `dataSources:import`
- `dataSources:updateAll`
- `dataSources:cleanCache`

## 开发约定

- 数据库、文件、网络和密码学代码放在主进程。
- 渲染进程只接收完成展示所需的数据。
- 不向日志写入密码、密钥、查询 token、完整密文或解密 payload。
- 新敏感字段进入加密 payload；只有完成查询必需的字段才增加分域 token。
- 新 token 必须定义明确 normalizer 和 domain。
- 不增加明文兼容列或明文查询回退。
- 手工编辑使用现有模块边界，避免把数据库逻辑放进 IPC handler。
- 修改共享安全模块时必须增加测试。
- 密态入库可能耗时较长；批量路径应使用事务、prepared statement 和缓存维度 token。

## 测试

运行单元测试：

```powershell
npm test
```

当前覆盖：

- Unicode normalizer
- AES-GCM nonce、AAD 和篡改检测
- 盲索引稳定性与 domain 隔离
- 主密钥轮换后的旧密文解密
- 用户密码槽解锁
- 保持登录会话槽创建、恢复和撤销
- 加密缓存截断、篡改和块重排检测
- 文本 token 与离散桶
- 无坐标和 `(0,0)` 坐标规则

Electron 冒烟测试：

```powershell
npm run test:electron
```

该测试使用 Electron ABI 验证 schema、登录、密文读写、FAA/OpenSky token JOIN 和 NTSB 聚合。

语法检查示例：

```powershell
node --check main.js
node --check preload.js
node --check src/main/security/keyService.js
node --check src/main/ntsbDataSource.js
node --check src/main/ntsbAnalysisService.js
node --check src/renderer/login.js
node --check src/renderer/ntsb.js
```

由于 `better-sqlite3` 针对 Electron ABI 构建，普通 Node 进程可能无法加载数据库模块。需要数据库的脚本应通过 Electron 运行。

## 打包

```powershell
npm run build
```

`electron-builder` 输出 Windows portable 可执行文件到 `dist/`。`package.json` 的 `files` 已包含主入口、preload、`src/**/*` 和运行依赖。

## 添加功能

### 新数据源

1. 在 `src/main/` 新建数据源模块并实现统一接口。
2. 在 `dataSourceService.js` 注册。
3. 如需新表，在 `databaseService.initializeSchema()` 添加 schema 和索引。
4. 为敏感 payload、token normalizer、缓存 ID 和测试做安全评审。

数据源卡片通过 `dataSources:list` 自动生成，通常无需修改前端 HTML。

### 新查询维度

1. 定义规范化规则。
2. 定义独立 dimension domain。
3. 入库时调用 `dimensionService.put()`。
4. 在事实表增加 token 列和匹配索引。
5. 查询按 token 筛选或分组。
6. 使用 `dimensionService.getMany()` 批量恢复显示值。
7. 用 `EXPLAIN QUERY PLAN` 验证索引。

### 新标签页

1. 新建主进程 service。
2. 在 `main.js` 注册最小 IPC。
3. 在 `preload.js` 暴露业务 API。
4. 新建 renderer 模块和 DOM。
5. 接入 `AppModule` 的登录生命周期和标签切换。

## 常见问题

### 无法登录

- 确认使用正确账号和密码。
- 默认账号只在首次数据库初始化时创建。
- 密码必须同时解锁 keyring 并通过 bcrypt。
- `keyring.json` 与 `app.db` 必须来自同一套 `data/`。
- 删除或替换其中任意一个都可能使现有数据无法解密。

### 保持登录未恢复

- 确认登录时勾选了“保持登录”。
- 确认 `keyring.json`、`login-session.json` 和 `app.db` 均存在且匹配。
- 显式注销会撤销保持登录。
- 会话文件无效时应用会删除它并回到登录页。

### NTSB 入库耗时长

NTSB 导入需要解析 MDB，并对事件、飞机及其他记录执行 payload 加密、盲索引、维度字典和全文 term 计算，明显慢于明文复制是合理的。优化时应优先减少重复规范化、重复维度写入和事务外操作，不能通过保留明文字段换取速度。

### NTSB 筛选卡顿

当前 UI 仅保留事件事实表上已有索引支持的筛选。新增飞机类别、制造商或损坏程度筛选前，应增加合适的联合索引并将相关 `EXISTS` 改为先筛选 `event_token` 再连接，避免主线程分钟级阻塞。

### 地图没有部分事故

缺失、越界或 `(0,0)` 坐标会被主动丢弃，这是当前数据质量规则，不是地图故障。

### 旧明文数据库无法启动

当前版本不迁移旧 schema。开发环境可在确认无需保留数据后删除：

```text
data/app.db
data/app.db-wal
data/app.db-shm
data/keyring.json
data/login-session.json
```

然后重新启动并重新导入数据。不要只删除 keyring 而保留数据库。
