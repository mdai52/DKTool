# DKTool

一个基于 `Vue 3 + Vite + Go + SQLite` 的战术地图工具复刻版，参考了《三角洲行动》地图工具的交互模型：

- 左侧深色控制面板
- 中央可缩放战术地图
- 地图模式切换
- 地图/难度/楼层/事件切换
- 点位分类筛选
- 点位详情浮层
- Go API + SQLite 持久化种子数据

## 目录

```text
frontend/              Vue 3 前端
backend/               Go API 与 SQLite
backend/web/dist/      前端构建产物
```

## 技术选型

- 前端：`Vue 3`、`Vite`、`Leaflet`
- 后端：Go 标准库 HTTP、`modernc.org/sqlite`
- 数据库：SQLite

## 已实现内容

- `烽火地带 / 全面战场` 两套模式
- 多张地图切换
- 难度切换
- 零号大坝楼层切换
- 随机事件切换
- 图层全选与单项筛选
- 点位检索
- 点位详情展示
- 分享当前视图
- 导出当前可见点位 JSON

## 启动

先安装依赖：

```bash
make install
```

启动后端：

```bash
make backend
```

启动前端开发环境：

```bash
make frontend
```

生产构建：

```bash
make build
```

Docker 启动：

```bash
make docker-up
```

或：

```bash
docker compose up --build
```

说明：

- 镜像会在构建阶段编译前端和 Go 服务
- 仓库内提交的是 `backend/data/dktool.seed.db`
- 容器首次启动会把 `seed` 库复制到可写的运行库，再继续把新访问到的图片写入该运行库

前端开发默认代理到 `http://localhost:8080`。

洛克王国首屏瓦片/图标预热到 SQLite：

```bash
node scripts/warm_rocom_initial_assets.mjs
```

按真实浏览器初始视图预热常用地图资产到 SQLite：

```bash
make warm-assets
```

按真实浏览器执行“平移 + 缩放”的覆盖式扫图，把更多瓦片批量沉淀到 SQLite：

```bash
make warm-coverage
```

可选 scope：

```bash
node scripts/warm_backend_assets.mjs rocom
node scripts/warm_backend_assets.mjs warfare
node scripts/warm_backend_assets.mjs extraction,warfare
```

说明：

- 默认优先使用 `Go 后端`
- 如果本机 Go 二进制暂时跑不起来，也可以使用接入 `SQLite` 资产缓存的 `preview-shim`
- 只有遇到“不持久化的 preview-shim”时，脚本才会拒绝执行；此时可显式设置 `DKTOOL_ALLOW_PREVIEW_WARM=1`
- `DKTOOL_WARM_DETAIL_IMAGES=1` 可额外预热洛克王国点位详情图
- `DKTOOL_WARM_TILE_COVERAGE=1` 会在页面内自动巡航扫图，而不是只抓首屏
- `DKTOOL_WARM_SKIP_DIRECT_ASSETS=1` 可在覆盖式扫图时跳过已存在的直链资源预热
- `DKTOOL_WARM_TILE_SETTLE_MS` 控制每一步平移/缩放后的停留时间

可选环境变量：

- `DKTOOL_BASE_URL`：默认 `http://127.0.0.1:8080`
- `DKTOOL_WARM_CONCURRENCY`：默认 `8`
- `DKTOOL_WARM_VIRTUAL_TIME_BUDGET`：默认 `5000`
- `DKTOOL_CHROME_BIN`：指定 Chrome / Chromium 可执行文件路径
- `DKTOOL_DB_PATH`：指定运行时 SQLite 路径；未设置时优先使用 `backend/data/dktool.db`，不存在则回退到 `backend/data/dktool.seed.db`

## API

### `GET /api/healthz`

健康检查。

### `GET /api/asset-stats`

返回当前 SQLite 资产缓存统计。接入 `SQLite` 资产缓存的 `preview-shim` 也会提供这组统计。

字段：

- `count`
- `totalBytes`
- `bootstrapEnabled`

### `GET /api/map-view`

返回当前视图所需的完整数据。

支持参数：

- `mode`
- `map`
- `variant`
- `floor`
- `event`
- `search`
- `layers`

示例：

```bash
curl 'http://localhost:8080/api/map-view?mode=extraction&map=zero-dam&variant=regular'
```

## 数据模型

SQLite 中包含这些核心表：

- `modes`
- `maps`
- `map_variants`
- `map_floors`
- `map_regions`
- `map_events`
- `layer_groups`
- `layers`
- `points`

数据库文件默认位于：

```text
backend/data/dktool.db
```

## 说明

当前版本重点复刻了原站的信息架构、视觉语气和核心交互，点位数据为本地 SQLite 种子数据。地图瓦片与图标可在访问或预热后沉淀到本地 `assets` 表，后续访问不再依赖第三方线上瓦片地址。

## 开源与数据来源 / Open Source & Data Sources

- 项目源码以 `MIT` 协议开源。
- 地图与点位整理数据来源于三角洲官方公开地图信息，以及 `17173` 的洛克王国地图数据。
- 本仓库仅用于学习、研究与交互复刻演示，原始地图素材、图标素材与相关数据权利归各自权利方所有。

## License

本项目采用 `MIT` 协议开源，详见 [LICENSE](./LICENSE)。
