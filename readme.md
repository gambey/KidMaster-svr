# FocusGames Server

Backend service for the FocusGames app (auth + MySQL). Node.js + Express API.

## 文档 / Docs

- **API 文档**: http://localhost:3000/docs.html

---

## 一、Docker 操作

### 前置条件

- 已安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)
- 项目根目录下存在 `.env` 文件（可复制 `env.sample` 并修改）

### 启动服务

```bash
# 构建并后台启动 API + 数据库
docker compose up --build -d

# 仅启动（不重新构建）
docker compose up -d
```

- **API**: http://localhost:3000  
- **MySQL**: localhost:3306（见下方数据库配置）

### 停止服务

```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（会清空数据库数据）
docker compose down -v
```

### 查看状态与日志

```bash
# 查看运行状态
docker compose ps

# 查看 API 日志（实时）
docker compose logs -f api

# 查看数据库日志
docker compose logs -f db

# 查看最近 100 行 API 日志
docker compose logs --tail=100 api
```

### 仅重建并重启 API

```bash
docker compose up --build -d api
```

### 进入容器

```bash
# 进入 API 容器
docker compose exec api sh

# 进入 MySQL 容器
docker compose exec db bash
```

---

## 二、数据库操作

### 连接信息（Docker Compose 默认）

| 项     | 值              |
|--------|-----------------|
| Host   | `localhost` 或 `db`（容器内） |
| Port   | `3306`          |
| 数据库 | `focusgames`    |
|  root  | 密码见 `docker-compose.yml` 中 `MYSQL_ROOT_PASSWORD`（默认 `rootpassword`） |
| 应用用户 | `focus`，密码见 `MYSQL_PASSWORD`（默认 `focuspassword`） |

### 命令行连接 MySQL

```bash
# 宿主机上连接（需已启动 db 服务）
mysql -h 127.0.0.1 -P 3306 -u root -p
# 输入 root 密码后：
USE focusgames;

# 或进入 db 容器后连接
docker compose exec db mysql -uroot -prootpassword focusgames
```

### 执行迁移（SQL 脚本）

迁移文件在 `migrations/` 目录，需**手动**按顺序执行：

```bash
# 方式一：宿主机有 mysql 客户端时
mysql -h 127.0.0.1 -P 3306 -u root -p focusgames < migrations/001_add_completion_condition_and_progress.sql

# 方式二：通过 db 容器
docker compose exec -T db mysql -uroot -prootpassword focusgames < migrations/001_add_completion_condition_and_progress.sql
```


**注意**：若表结构已存在或脚本已执行过，再次执行可能报错，请根据当前库结构决定是否执行或修改 SQL。

### 备份与恢复

```bash
# 备份整个 focusgames 库
docker compose exec db mysqldump -uroot -prootpassword focusgames > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复（会覆盖当前库）
docker compose exec -T db mysql -uroot -prootpassword focusgames < backup_20250131_120000.sql
```

### 健康检查

```bash
# 在 db 容器内
docker compose exec db mysqladmin ping -h localhost -uroot -prootpassword
```

---

## 三、本地开发（不用 Docker）

### 环境要求

- Node.js 20+
- 本地或远程 MySQL 8.0，并已创建数据库 `focusgames`

### 配置

```bash
cp env.sample .env
# 编辑 .env：DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME、JWT_SECRET、CORS_ORIGIN
```

### 安装与运行

```bash
npm install
npm run dev    # 开发模式，nodemon 热重载
# 或
npm start      # 生产模式
```

API 默认: http://localhost:3000

---

## 四、环境变量说明

| 变量         | 说明                    | 示例 |
|--------------|-------------------------|------|
| `PORT`       | API 监听端口            | `3000` |
| `DB_HOST`    | 数据库主机（Docker 内用 `db`） | `127.0.0.1` 或 `db` |
| `DB_PORT`    | 数据库端口              | `3306` |
| `DB_USER`    | 数据库用户              | `root` 或 `focus` |
| `DB_PASSWORD`| 数据库密码              | - |
| `DB_NAME`    | 数据库名                | `focusgames` |
| `JWT_SECRET` | JWT 签名密钥（务必随机且保密） | 长随机字符串 |
| `CORS_ORIGIN`| 允许的跨域来源，逗号分隔 | `http://localhost:5173,https://yourdomain.com` |

---

## 五、API 路由概览

- `GET /health` — 健康检查  
- `/auth` — 认证  
- `/children` — 儿童相关  
- `/todo-items` — 待办项  
- `/daily-todos` — 每日待办  
- `/checkin` — 打卡  

详细请求/响应见 http://localhost:3000/docs.html 。
