请为我开发一个完整可运行的 Electron 桌面应用，应用主题是“数据安全动态采集系统”。

技术要求：
- 使用 Electron + 前端页面实现，不要创建多个窗口。
- 所有功能模块使用类似浏览器的顶部标签栏切换。
- 当前只实现一个模块，但整体架构必须模块化，方便未来添加更多数据分析模块。
- 前端界面建议使用 HTML/CSS/JavaScript，地图使用 OpenStreetMap，可用 Leaflet。
- 后端逻辑放在 Electron main/preload 或独立模块中，注意前后端职责分离。
- 给出完整项目结构和所有必要代码，包括 package.json、main.js、preload.js、前端页面和样式文件。
- 应用应能直接 npm install 后 npm start 运行。

当前模块名称：
“FAA 注册飞机与 OpenSky 航班动态分析模块”

功能要求：

1. FAA 注册数据库读取
- 项目目录中会有一个文件：ReleasableAircraft.zip。
- zip 中包含 MASTER.txt，这是 FAA 美国飞机注册数据库。
- 程序启动后读取 ReleasableAircraft.zip 中的 MASTER.txt。
- 解析 MASTER.txt 中的字段，例如：
  N-NUMBER、SERIAL NUMBER、MFR MDL CODE、ENG MFR MDL、YEAR MFR、TYPE REGISTRANT、NAME、CITY、STATE、COUNTRY、MODE S CODE HEX 等。
- 重点使用 MODE S CODE HEX 与 OpenSky 返回的 icao24 进行匹配。
- 注意 OpenSky 的 icao24 通常是小写十六进制，FAA 的 MODE S CODE HEX 可能是大写，需要统一大小写。
- 将解析后的 FAA 注册信息保存到内存缓存中，最好以 icao24 为 key 建立 Map，方便快速查询。

2. FAA 数据刷新
- 界面右侧竖栏专门显示 FAA 注册信息。
- 右侧栏顶部有“刷新 FAA 数据库”按钮。
- 点击后重新下载：
  https://registry.faa.gov/database/ReleasableAircraft.zip
- 下载后替换本地 ReleasableAircraft.zip，并重新解析 MASTER.txt。
- 显示当前 FAA 数据库记录数量、加载状态、错误信息。
- FAA 数据库放在合适的文件夹中，不必在根文件夹

3. OpenSky 航班数据获取
- 使用 OpenSky API：
  https://openskynetwork.github.io/opensky-api/
- 请求全部范围的航班状态数据。
- 使用接口：
  https://opensky-network.org/api/states/all
- 不要自动高频刷新，避免给网站增加负担。
- 程序启动后可以读取本地缓存，不要自动请求 OpenSky。
- 主界面提供“刷新航班数据”按钮，只有用户点击时才请求 OpenSky。
- 请求结果保存到本地缓存文件，例如 data/opensky-cache.json。
- 下次打开程序时优先加载缓存。

4. 地图显示
- 主区域使用 OpenStreetMap 地图作为背景。
- 将 OpenSky 返回的所有有经纬度的航班显示在地图上。
- 如果某个航班的 icao24 能在 FAA 数据库中匹配到，则使用不同颜色标注。
- 未匹配 FAA 数据库的航班使用普通颜色。
- 匹配到 FAA 数据库的航班使用醒目颜色，例如红色或橙色。
- 每个航班标记可以被点击。
- 点击航班后：
  - 地图中选中该航班；
  - 下方横向详情栏显示该航班详细信息

5. 下方航班详情栏
- 主栏目下方有一个横向详情栏。
- 点击地图上的航班后，在这里显示完整 OpenSky 返回数据，包括：
  icao24
  callsign
  origin_country
  time_position
  last_contact
  longitude
  latitude
  baro_altitude
  on_ground
  velocity
  true_track
  vertical_rate
  sensors
  geo_altitude
  squawk
  spi
  position_source
- 如果匹配到 FAA 数据库，也在详情栏中显示额外 FAA 信息摘要。
- 没有选中航班时显示提示信息。

6. 右侧 FAA 信息栏
- 专门用于显示当前选中航班对应的 FAA 注册信息。
- 显示字段至少包括：
  N-NUMBER
  NAME
  CITY
  STATE
  COUNTRY
  YEAR MFR
  MODE S CODE HEX
  SERIAL NUMBER
  TYPE AIRCRAFT
  TYPE ENGINE
  CERTIFICATION
  STATUS CODE
  EXPIRATION DATE
- 如果没有选中航班，显示“请选择地图上的航班”。
- 如果选中航班但未匹配 FAA，显示“该航班未匹配 FAA 注册信息”。

7. UI 布局
- 顶部：模块标签栏，当前只有一个标签“FAA/OpenSky 分析”。
- 标签栏下方是模块工具栏，包含：
  - 刷新航班数据按钮
  - 刷新 FAA 数据库按钮
  - 航班总数
  - FAA 匹配数量
  - 当前缓存时间
- 主体区域：
  - 左侧/中间：OpenStreetMap 地图
  - 右侧：FAA 信息竖栏
- 底部：航班详细信息横栏
- 整体风格偏“数据安全动态采集系统”，可以使用深色主题、蓝色/青色线条、卡片式布局。

8. 数据处理细节
- MASTER.txt 是 CSV 风格文本，但可能字段很多，需要稳健解析。
- 注意字段名可能包含空格，例如 MODE S CODE HEX。
- 读取 zip 文件可以使用 adm-zip 或 yauzl。
- 下载可以使用 Node.js https/fetch。
- OpenSky states/all 返回格式是：
  {
    "time": timestamp,
    "states": [
      [
        icao24,
        callsign,
        origin_country,
        time_position,
        last_contact,
        longitude,
        latitude,
        baro_altitude,
        on_ground,
        velocity,
        true_track,
        vertical_rate,
        sensors,
        geo_altitude,
        squawk,
        spi,
        position_source
      ]
    ]
  }
- 请将数组转换为具名对象，方便前端渲染。
- callsign 需要 trim。
- 过滤掉没有 longitude 或 latitude 的航班，不在地图上绘制。

9. 安全和工程要求
- Electron 开启 contextIsolation。
- 禁用 nodeIntegration。
- 使用 preload.js 暴露安全 API。
- 前端不能直接访问 Node.js 文件系统。
- 所有文件读取、下载、解压、缓存写入都通过 Electron main 进程完成。
- 加入基本错误处理和加载状态。
- 不要把 API 请求放在循环自动刷新中。
- 不要写死绝对路径，使用 app.getPath 或项目相对路径。
- 代码需要清晰分层，例如：
  src/main/faaService.js
  src/main/openskyService.js
  src/main/cacheService.js
  src/renderer/index.html
  src/renderer/app.js
  src/renderer/style.css

10. 输出要求
- 给出完整项目目录结构。
- 给出每个文件的完整代码。
- 代码不要省略。
- 最后给出运行命令：
  npm install
  npm start
- 如果某些依赖需要安装，请写入 package.json。