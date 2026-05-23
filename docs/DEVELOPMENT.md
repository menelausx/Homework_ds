# 开发文档

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process                │
│  ┌───────────────────┐  ┌────────────────────┐  │
│  │    index.html      │  │    app.js          │  │
│  │  (DOM Structure)   │  │  (Map, Markers,    │  │
│  │                    │  │   Events, State)   │  │
│  └───────────────────┘  └─────────┬──────────┘  │
│                                    │              │
│                          window.electronAPI       │
│                                    │              │
├────────────────────────────────────┼──────────────┤
│                  Preload (Bridge)  │              │
│  ┌─────────────────────────────────┴──────────┐  │
│  │              preload.js                     │  │
│  │  contextBridge.exposeInMainWorld('api', {   │  │
│  │    getFaaStats, getFaaInfo, refreshFaa,    │  │
│  │    getFlightData, refreshFlights,          │  │
│  │    onFaaReady, onFaaError                  │  │
│  │  })                                         │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │ ipcRenderer.invoke           │
├─────────────────────┼──────────────────────────────┤
│                  Main Process                      │
│  ┌──────────────────┼──────────────────────────┐  │
│  │  main.js         │   ipcMain.handle()       │  │
│  │                  │                          │  │
│  │  ┌───────────────┴────┐  ┌───────────────┐  │  │
│  │  │  faaService.js     │  │ openskyService│  │  │
│  │  │  - parse MASTER.txt│  │ - fetch API   │  │  │
│  │  │  - build icao24    │  │ - convert arr │  │  │
│  │  │    lookup Map       │  │   to objects  │  │  │
│  │  │  - download zip     │  │               │  │  │
│  │  └──────┬──────────────┘  └──────┬────────┘  │  │
│  │         │                        │            │  │
│  │  ┌──────┴────────────────────────┴────────┐  │  │
│  │  │         cacheService.js                 │  │  │
│  │  │  readJsonFile / writeJsonFile           │  │  │
│  │  │  getDataFilePath / fileExistsInData     │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 进程模型与安全

采用 Electron 推荐的**安全隔离模型**：

```
主进程 (main.js)         渲染进程 (index.html + app.js)
     │                          │
     ├── ipcMain.handle() ──────┤  ← 请求/响应
     │                          │     ipcRenderer.invoke()
     │                          │
     └── webContents.send() ───→  ← 推送通知
                                  ipcRenderer.on()
```

**安全措施**：
- `contextIsolation: true` — 渲染进程无法直接访问 Node.js API
- `nodeIntegration: false` — 禁用 `require()` 
- `preload.js` 通过 `contextBridge.exposeInMainWorld()` 暴露有限 API
- 所有文件读写、网络请求均通过主进程 IPC 完成
- CSP 限制脚本来源为 `'self'` 和 `unpkg.com`

## IPC 通道

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `faa:get-stats` | 渲染→主 | - | `{ recordCount, loaded, error }` |
| `faa:get-info` | 渲染→主 | `icao24: string` | FAA 记录对象 或 `null` |
| `faa:refresh` | 渲染→主 | - | `{ success, recordCount?, error? }` |
| `opensky:get-flights` | 渲染→主 | - | `{ time, cacheTime, states[] }` |
| `opensky:refresh` | 渲染→主 | - | `{ success, flightCount?, cacheTime?, error? }` |
| `faa:ready` | 主→渲染 | `stats` | FAA 加载完成通知 |
| `faa:error` | 主→渲染 | `error: string` | FAA 加载失败通知 |

## 数据流

### 航班数据

```
OpenSky API
  │ https://opensky-network.org/api/states/all
  │ (point-in-time snapshot, no auth required)
  ▼
openskyService.refresh()
  │ fetchOpenSkyData() → raw JSON
  │ convertStatesToObjects() → 具名对象数组
  │ 过滤: 无经纬度的航班被丢弃
  │ cacheTime = new Date().toISOString()
  ▼
cacheService.writeJsonFile('opensky-cache.json')
  │
  ▼
IPC: opensky:get-flights
  │
  ▼
app.js renderFlights()
  │ 为每个航班创建 L.circleMarker
  │ 异步查询 FAA 匹配 (faa:get-info)
  │ 已匹配 → 红色, 未匹配 → 蓝色
  ▼
Leaflet 地图渲染
```

### FAA 数据库

```
ReleasableAircraft.zip (本地 或 FAA 官网下载)
  │
  ▼
faaService.loadFromZip()
  │ AdmZip 读取 MASTER.txt
  │ parseCSVLine() 逐行解析
  │ 构建 Map: key = MODE S CODE HEX (小写)
  │ 无 Mode S Code 的记录被跳过
  ▼
内存 faaMap (Map<icao24, Record>)
  │
  ▼
IPC: faa:get-info(icao24)
  │ O(1) 查询 faaMap.get(icao24)
  ▼
返回 FAA 记录 或 null
```

## MASTER.txt 解析

FAA 注册数据库为 CSV 格式，逗号分隔，双引号包裹含逗号的字段。解析器实现：

1. 读取首行作为字段名（headers）
2. 查找 `MODE S CODE HEX` 列索引
3. 逐行解析，跳过 mode s code 为空的记录
4. 以 **小写 mode s code** 为 key 存入 Map

关键字段匹配：
```
FAA: MODE S CODE HEX (大写, e.g. "A1B2C3")
     ↓ toLowerCase().trim()
OpenSky: icao24 (小写, e.g. "a1b2c3")
```

## 前端状态管理 (app.js)

```javascript
state = {
  flightData: { time, cacheTime, states[] },  // 航班数据
  faaStats:   { recordCount, loaded, error }, // FAA 统计
  faaCache:   Map<icao24, record|null>,       // FAA 查询缓存
  selectedIcao24: null,                       // 当前选中
  selectedMarker: null,                       // 当前标记引用
  markers:    { icao24 → marker },            // 所有标记索引
  flightLayer: L.layerGroup,                  // Leaflet 图层
}
```

标记颜色逻辑：
```
getMarkerStyle(icao24, isSelected)
  ├── isSelected       → 白色填充 + 青色边框 (r=9)
  ├── faaCache 中有记录 → 红色 (r=6)
  └── faaCache 中为 null → 蓝色 (r=5)
```

## UI 布局

```
┌──────────────────────────────────────────────────┐
│  Tab Bar: [FAA/OpenSky 分析]                     │ 38px
├──────────────────────────────────────────────────┤
│  Toolbar: [刷新航班] [刷新FAA] | 统计数据 | 状态 │ 44px
├────────────────────────────────┬─────────────────┤
│                                │  FAA Panel      │
│       Leaflet Map              │  ────────────   │
│       (OpenStreetMap)          │  N-NUMBER       │
│                                │  NAME           │
│                                │  CITY           │
│                                │  STATE          │
│                                │  ...            │
│                                │                 │ 300px
├────────────────────────────────┴─────────────────┤
│  Detail Bar: icao24 | callsign | origin | ...    │ 200px
└──────────────────────────────────────────────────┘
    flex: 1
```

## 添加新模块

整体架构支持模块化扩展，添加新分析模块的步骤：

1. **后端服务**: 在 `src/main/` 创建新的 `xxxService.js`
2. **IPC 通道**: 在 `main.js` 添加 `ipcMain.handle('xxx:...')`
3. **Preload API**: 在 `preload.js` 添加对应的 `xxxMethod: () => ipcRenderer.invoke('xxx:...')`
4. **前端页面**: 在 `src/renderer/` 创建模块的 HTML/CSS/JS
5. **标签注册**: 在 `index.html` 的 `.tab-bar` 添加新标签，切换显示逻辑

当前单模块模式下标签栏仅有一个固定标签，多模块时需在 `app.js` 中添加标签切换逻辑。

## 依赖说明

| 包 | 版本 | 用途 |
|----|------|------|
| electron | ^33.0.0 | 桌面框架 |
| adm-zip | ^0.5.16 | 读取 FAA zip 中的 MASTER.txt |
| leaflet | 1.9.4 (CDN) | 前端地图渲染 |

Leaflet 通过 unpkg CDN 加载，如需离线使用可将 leaflet.css 和 leaflet.js 放入 `src/renderer/vendor/` 并修改 HTML 引用路径。

## 常见问题

**FAA 数据库加载失败**
- 确认 `data/ReleasableAircraft.zip` 或项目根目录下存在该文件
- 若文件损坏，点击"刷新 FAA 数据库"重新下载
- 下载约需数分钟（文件约 50-100 MB），超时时间为 10 分钟

**航班数据为空**
- 首次启动无缓存，需点击"刷新航班数据"
- OpenSky API 可能偶尔无响应，稍等后重试

**地图显示异常**
- 需联网加载 OpenStreetMap 瓦片
- 若代理环境需额外配置 Electron 网络代理
