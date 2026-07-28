# 点云上传平台

> 服务器安装、生产部署、更新、备份和故障排查请查看：[安装部署使用说明.md](安装部署使用说明.md)

一个完整的 LAS 点云业务闭环：登录/注册 → 分片上传 → 暂停或断线续传 → 服务端校验与去重 → 数据管理 → 浏览器 3D 预览 → 原文件下载或删除。

## 已实现

- 登录/注册合一的演示认证，记住账号密码、密码显隐、协议与隐私政策弹窗。
- 5 MiB 分片、3 路并发上传，支持暂停、继续、失败重试和刷新后按服务端记录续传。
- 每个分片 SHA-256 校验；完成时原子合并并计算整文件 SHA-256。
- 严格校验 `.las` 扩展名、文件大小和 LAS 文件结构，提取版本、点格式、点数、包围盒、比例和偏移。
- 每次上传都生成独立 UUID 和 MinIO 对象键；同名、同大小、内容相同的文件也不会覆盖。PostgreSQL 只保存对象键和业务元数据。
- MinIO 使用独立的应用访问账号；endpoint、桶、Access Key、Secret Key、TLS 与区域全部由 `.env` 提供。
- 分页列表、详情、下载、删除；所有数据按登录用户隔离。
- Three.js 交互式预览，支持旋转、平移、缩放、自动适配视角，以及高度、强度、RGB、统一颜色模式。
- 保存 CRS/EPSG、分类统计、回波统计、GPS 时间范围、生成软件、系统标识和 VLR/EVLR 摘要。
- 上传开始、断点恢复、上传完成、编辑保存、取消和删除都会先写入 PostgreSQL 通知表，再通过用户专属 WebSocket 实时推送。
- 顶部通知铃铛显示未读数量和历史记录；上传完成、编辑或删除后，列表通过 WebSocket 自动刷新。
- 后端单元测试、前端类型检查/生产构建/静态检查，以及基于真实 LAS 的端到端回归脚本。

本项目暂不包含 Potree/EPT/3D Tiles 与 LOD、前后端 Docker 化和 CI；MinIO 对象存储独立使用本地容器运行。

## 目录

```text
api/
  app/
    auth/       认证
    models/     数据库模型
    routers/    HTTP 接口
    schemas/    请求与响应模型
    services/   上传与 LAS 领域逻辑
  tests/unit/   后端单元测试
  data/         未完成上传的临时分片（运行时生成）
infra/minio/
  compose.yaml  MinIO 与私有桶初始化
web/src/
  api/          API 客户端和类型
  components/   登录、上传、表格、3D 查看器
  hooks/        断点续传状态机
  pages/        列表页和详情页
  state/        全局认证与弹窗状态
  styles/       分区样式
scripts/
  regression.ps1     一键验证入口
  run_regression.py  真实 API 回归
```

## 本地运行

前置条件：Python 3.12、Node.js、PostgreSQL、Redis、Docker Desktop。

### MinIO 对象存储

先从示例生成本地配置并修改其中的密码和密钥：

```powershell
Copy-Item api\.env.example api\.env
docker compose -f infra\minio\compose.yaml up -d
docker compose -f infra\minio\compose.yaml ps
```

MinIO API 为 `http://127.0.0.1:9000`，对象管理控制台为 `http://127.0.0.1:9001`。控制台使用 `.env` 中的 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD`；后端使用权限受限的 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY`。

容器初始化会：

1. 创建私有 `MINIO_BUCKET` 桶；
2. 禁止匿名访问；
3. 创建后端专用应用账号；
4. 绑定读写策略；
5. 使用 Docker Volume 持久化对象。

关闭服务但保留对象：

```powershell
docker compose -f infra\minio\compose.yaml down
```

不要添加 `-v`，除非明确需要删除全部 MinIO 对象。

### 后端

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 修改 PostgreSQL、Redis、认证和 MinIO 配置
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

后端启动时会验证 MinIO 连接和私有桶是否存在，失败时拒绝启动，避免上传后才发现存储不可用。首次启动会创建所需数据表；旧版 `data/uploads` 中仍被数据库引用的文件会自动迁移到 MinIO，确认成功后删除本地副本。

本地 API、登录后健康检查和交互文档分别为：

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/api/health`
- `http://127.0.0.1:8000/docs`

### 前端

```powershell
cd web
npx --yes pnpm@11 install
npx --yes pnpm@11 dev
```

打开 `http://127.0.0.1:5173/`。演示模式下输入任意符合格式的邮箱和至少 8 位密码即可：无账号时自动注册，有账号且密码错误时更新密码，然后登录。

## 断点续传协议

1. `POST /api/point-clouds/uploads` 创建或恢复上传会话。
2. 客户端按服务端返回的 `chunk_size` 切片。
3. `PUT /uploads/{id}/chunks/{index}` 上传分片，同时发送 `X-Chunk-SHA256`。
4. `GET /uploads/{id}` 获取服务端已经持久化的分片索引，仅补传缺失部分。
5. `POST /uploads/{id}/complete` 校验完整性、原子合并并解析 LAS。
6. 后端把验证后的文件上传到 MinIO，校验对象大小，再向 PostgreSQL提交对象键及元数据。
7. PostgreSQL 写入失败时回滚删除 MinIO 对象；对象存储写入失败时不会生成数据库记录。

SHA-256只用于传输完整性验证，不用于合并业务记录。每次完成上传都会创建新的记录 ID 和对象键，因此重复上传同一个 LAS 也会在列表中产生独立的新记录。

读取严格遵循：先按当前用户从 PostgreSQL 查询记录，再使用记录中的 `storage_key` 从 MinIO 获取对象。预览会把对象下载到系统临时文件并在完成后删除；原文件下载使用流式响应，不会一次性载入内存。

## 实时通知

- WebSocket：`ws://127.0.0.1:8000/api/notifications/ws`
- 通知列表：`GET /api/notifications`
- 全部已读：`POST /api/notifications/read-all`
- 单条已读：`POST /api/notifications/{id}/read`

WebSocket 使用与 HTTP 登录相同的 HttpOnly Cookie，并在服务端通过 Redis 会话校验用户。通知在推送前先提交 PostgreSQL，因此断线重连后可通过通知列表补取，不依赖 WebSocket 消息本身保存历史。

上传会话默认保留 24 小时；单文件默认上限 512 MiB；3D 预览最多抽样 200,000 个点。这些参数均可在 `api/.env` 调整。

## 验证

运行单元测试、前端生产构建和静态检查：

```powershell
.\scripts\regression.ps1
```

确保后端正在运行后，使用仓库中的真实样本执行完整回归：

```powershell
.\scripts\regression.ps1 -Live
```

真实回归使用 3 路并发，验证：认证、创建会话、先传两个分片、模拟中断、恢复剩余分片、MinIO 写入、PostgreSQL 记录、从 MinIO 生成 3D 预览、流式下载哈希一致性，以及对象和记录删除。

也可单独执行：

```powershell
.\api\.venv\Scripts\python.exe .\scripts\run_regression.py `
  --sample .\NEONDSSampleLiDARPointCloud.las
```

加入 `--keep` 可在回归后保留数据记录，便于浏览器人工验收。

## 当前样本基准

`NEONDSSampleLiDARPointCloud.las`：

- 文件大小：185,075,623 bytes
- LAS 版本：1.3
- 点格式：1
- 点数：6,609,829
- RGB：无，预览自动使用高度着色
- SHA-256：`9bab74666a6f9a5767f23323b16076ce61ed9f03e8fa26c514474e1c38193d66`
