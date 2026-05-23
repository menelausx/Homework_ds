# 数据安全动态采集系统

基于 Electron 的桌面应用，当前实现 **FAA 注册飞机与 OpenSky 航班动态分析模块**，支持全球航班实时监控与 FAA 注册信息匹配。

## 功能

- **OpenStreetMap 地图**：Leaflet 渲染全球航班位置
- **FAA 注册匹配**：读取 FAA ReleasableAircraft.zip 数据库，通过 Mode S Code (icao24) 与航班匹配，已匹配航班以红色高亮标注
- **航班详情**：点击任意航班在地图下方横栏显示 17 个 OpenSky 字段
- **FAA 信息**：右侧竖栏展示选中飞机的注册信息（N-NUMBER、NAME、CITY、STATE 等 13 个字段）
- **离线缓存**：航班数据缓存到本地，启动时不自动请求 OpenSky
- **数据库刷新**：支持一键从 FAA 官网下载最新 ReleasableAircraft.zip

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 |
| 地图 | Leaflet + OpenStreetMap |
| 压缩处理 | adm-zip |
| 数据源 | OpenSky Network API、FAA Registry |
| 安全 | contextIsolation + preload.js |

## 快速开始

```bash
cd <项目目录>
npm install
npm start
```

### 前置条件

- Node.js 18+

## 项目结构

```
.
├── package.json
├── main.js                     # Electron 主进程入口
├── preload.js                  # contextBridge 安全 IPC
├── src/
│   ├── main/
│   │   ├── cacheService.js     # 本地文件缓存读写
│   │   ├── faaService.js       # FAA 数据库解析/下载
│   │   └── openskyService.js   # OpenSky API 数据获取
│   └── renderer/
│       ├── index.html           # 主界面
│       ├── app.js               # 前端逻辑 (地图、标记、事件)
│       └── style.css            # 深色主题样式
└── data/                        # 运行时数据 (自动创建)
    ├── ReleasableAircraft.zip   # FAA 数据库副本
    └── opensky-cache.json       # 航班数据缓存
```

## 使用说明

1. 启动后自动加载本地 FAA 数据库和航班缓存
2. 点击 **刷新航班数据** 从 OpenSky 获取最新全球航班状态
3. 点击 **刷新 FAA 数据库** 从 FAA 官网下载最新注册数据库（约 50-100 MB）
4. 地图上 **红色圆点** = 已匹配 FAA 注册信息，**蓝色圆点** = 未匹配
5. 点击航班标记查看详情，按 <kbd>Escape</kbd> 取消选中
6. 右侧竖栏和底部横栏分别显示 FAA 注册信息和航班原始数据

## 数据源

- OpenSky Network API: `https://opensky-network.org/api/states/all`
- FAA Registry: `https://registry.faa.gov/database/ReleasableAircraft.zip`
- 地图瓦片: OpenStreetMap (需联网)
