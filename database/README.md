# PostgreSQL 导出说明

本目录保存从本地开发数据库导出的 SQL。

| 文件 | 内容 |
|---|---|
| `schema.sql` | 完整表结构、序列、主键、唯一约束和索引 |
| `users.seed.sql` | 匿名化用户种子数据，用于维持本地业务数据的用户 ID 关联 |
| `local-data.sql` | 除用户表以外的本地业务数据 |

导出时的本地数据规模：

- 用户：7条；
- 点云记录：5条；
- 编辑文档：5条；
- 上传会话：19条；
- 通知：57条；
- 测试记录：1条。

## 安全处理

GitHub 中不包含本地真实邮箱和真实密码哈希。

`users.seed.sql`：

- 保留原用户 UUID，确保点云、编辑记录和通知仍能关联到对应用户；
- 邮箱替换为 `demo-user-N@example.invalid`；
- 所有密码替换为公开演示密码 `ChangeMe-After-Deploy-2026` 的 Argon2id 哈希；
- 保留用户启用、管理员和验证状态。

导入后应立即使用平台的演示登录流程修改密码，或者清空用户和业务数据重新初始化。

## 导入到空数据库

```bash
createdb -U pointcloud pointcloud
psql -U pointcloud -d pointcloud -f database/schema.sql
psql -U pointcloud -d pointcloud -f database/users.seed.sql
psql -U pointcloud -d pointcloud -f database/local-data.sql
```

Docker PostgreSQL 示例：

```bash
docker exec -i PostgreSQL容器名 \
  psql -U 数据库用户 -d 数据库名 < database/schema.sql

docker exec -i PostgreSQL容器名 \
  psql -U 数据库用户 -d 数据库名 < database/users.seed.sql

docker exec -i PostgreSQL容器名 \
  psql -U 数据库用户 -d 数据库名 < database/local-data.sql
```

必须按照 `schema.sql`、`users.seed.sql`、`local-data.sql` 的顺序导入。

## 数据与 MinIO 的关系

`local-data.sql` 中的点云记录只包含 MinIO 对象键，不包含 LAS 二进制内容。数据库恢复后，如果目标 MinIO 中没有对应对象，相关历史点云会显示为对象缺失。

仓库只通过 Git LFS 提供内置的 `NEONDSSampleLiDARPointCloud.las`。全新部署通常不需要导入本地业务数据：只导入表结构或直接启动后端，让后端自动建表，然后由用户首次登录触发内置示例初始化即可。

若要完整迁移本地环境，必须同时迁移：

1. PostgreSQL SQL；
2. MinIO 数据卷或对象；
3. 与部署环境匹配的非敏感配置。

不要把 `api/.env`、MinIO 密钥、数据库密码或 Redis会话上传到 Git。
