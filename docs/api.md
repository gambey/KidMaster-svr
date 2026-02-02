# FocusGames 后端接口文档

## 接口列表

### 通用
- [GET /health](#get-health)
- [POST /auth/login](#post-authlogin)

### 儿童信息
- [POST /children](#post-children)
- [GET /children](#get-children)
- [GET /children/:id](#get-childrenid)
- [PUT /children/:id](#put-childrenid)
- [PUT /children/:id/letter](#put-childrenidletter)
- [DELETE /children/:id](#delete-childrenid)

### 事项字典（通用待办模板）
- [GET /todo-items](#get-todo-items)
- [GET /todo-items/:id](#get-todo-itemsid)
- [POST /todo-items](#post-todo-items)
- [PUT /todo-items/:id](#put-todo-itemsid)
- [DELETE /todo-items/:id](#delete-todo-itemsid)

### 每日待办（计划）
- [POST /daily-todos](#post-daily-todos)
- [GET /daily-todos](#get-daily-todos)
- [GET /daily-todos/:id](#get-daily-todosid)
- [PUT /daily-todos/:id](#put-daily-todosid)
- [DELETE /daily-todos/:id](#delete-daily-todosid)

### 打卡记录
- [PUT /checkin/:daily_todo_id](#put-checkindaily_todo_id)
- [GET /checkin/:daily_todo_id](#get-checkindaily_todo_id)
- [GET /checkin/date/:date](#get-checkindatedate)
- [GET /checkin/month/:year/:month](#get-checkinmonthyearmonth)

---

## GET /health

**标签**：公开

健康检查接口，用于检测服务是否正常启动。

**响应示例**：
```json
{ "status": "ok" }
```

---

## POST /auth/login

**标签**：公开

登录 / 注册一体化接口：若手机号不存在则自动注册并登录；若已存在则校验密码后登录。

**请求体**：
```json
{
  "phoneNumber": "13xxxxxxx",
  "password": "PlainText123",
  "name": "可选昵称"
}
```

**响应**：
- **201**：`{ "token": "<jwt>", "created": true }`（新用户，注册 + 登录）
- **200**：`{ "token": "<jwt>", "created": false }`（老用户，登录）
- **400**：缺少手机号或密码
- **401**：密码错误
- **500**：服务器内部错误

---

## POST /children

**标签**：需登录

为当前家长账号添加一个孩子，并自动建立亲子关系。

**请求头**：
```
Authorization: Bearer <jwt_token>
```

**请求体**：
```json
{
  "child_name": "福福",
  "gender": "男",
  "age": 8,
  "grade": "小学·二年级",
  "avatar": "https://example.com/avatar.jpg",
  "remark": "老大",
  "relation_type": 1,
  "parent_letter": "写给孩子的信件内容"
}
```

**字段说明**：
- `child_name`（必填）：孩子的小名 / 昵称
- `gender`（可选）：`男` 或 `女`（会转换为 1/2）
- `age`（可选）：年龄（整数）
- `grade`（可选）：年级字符串，如 “小学·二年级”、“幼儿园大班”
- `avatar`（可选）：头像 URL
- `remark`（可选）：家长备注，如“老大”、“走读”
- `relation_type`（可选，默认 1）：1=父亲，2=母亲，3=祖父母，4=其他
- `parent_letter`（可选）：家长写给孩子的信件内容；不传时使用默认模板（见 `parent-child_love_letter.md`），模板中可含占位符 `[childName]`、`[gender]`

**响应**：
- **201**：`{ "message": "Child added successfully", "data": {...} }`
- **400**：缺少必填字段
- **401**：未登录 / token 无效
- **500**：服务器内部错误

---

## GET /children

**标签**：需登录

获取当前家长名下所有有效的孩子列表。每条数据包含 `parent_letter`（家长信件内容）。返回给客户端时，`parent_letter` 中的 `[childName]` 已替换为孩子名字，`[gender]` 已替换为孩子性别（男/女）。

**响应**：
- **200**：`{ "message": "Success", "data": [ ... ] }`
- **401**：未登录
- **500**：服务器内部错误

---

## GET /children/:id

**标签**：需登录

获取单个孩子详情，仅允许访问自己名下的孩子。返回数据包含 `parent_letter`（家长信件内容）。返回时 `[childName]` 已替换为孩子名字，`[gender]` 已替换为孩子性别（男/女）。

**响应**：
- **200**：`{ "message": "Success", "data": {...} }`
- **401**：未登录
- **404**：孩子不存在或不属于当前家长
- **500**：服务器内部错误

---

## PUT /children/:id

**标签**：需登录

更新孩子信息，只更新传入的字段。支持更新 `parent_letter`（家长信件内容）。返回数据中的 `parent_letter` 会做占位符替换（`[childName]`→孩子名字，`[gender]`→男/女）。

**请求体（所有字段可选）**：可包含 `child_name`、`gender`、`age`、`grade`、`avatar`、`remark`、`parent_letter`。

**响应**：
- **200**：`{ "message": "Child updated successfully", "data": {...} }`
- **400**：没有任何可更新字段
- **401**：未登录
- **404**：孩子不存在或不属于当前家长
- **500**：服务器内部错误

---

## PUT /children/:id/letter

**标签**：需登录

仅更新指定孩子的家长信件内容（`parent_letter`）。请求体只含信件内容，返回更新后的孩子信息（含已替换占位符的 `parent_letter`）。

**请求头**：
```
Authorization: Bearer <jwt_token>
```

**请求体**：
```json
{
  "parent_letter": "写给孩子的信件内容，可含占位符 [childName]、[gender]，返回时会替换为孩子名字和性别。"
}
```

**响应**：
- **200**：`{ "message": "Letter updated successfully", "data": {...} }`（`data` 为完整孩子信息，`parent_letter` 已做占位符替换）
- **401**：未登录
- **404**：孩子不存在或不属于当前家长
- **500**：服务器内部错误

---

## DELETE /children/:id

**标签**：需登录

解除与某个孩子的亲子关系（软删除，只改关系，不删孩子记录）。

**响应**：
- **200**：`{ "message": "Child relationship removed successfully" }`
- **401**：未登录
- **404**：孩子不存在或不属于当前家长
- **500**：服务器内部错误

---

## GET /todo-items

**标签**：需登录

查询通用事项字典，默认返回“系统默认事项 + 当前家长自定义事项”。

**查询参数（全部可选）**：
- `item_type`：1=孩子事项，2=家长事项
- `item_category`：分类，如“学习类”、“生活类”、“亲子类”
- `is_default`：1=系统默认，0=用户自定义
- `status`：1=有效，0=禁用（默认只返回有效）
- `creator_id`：指定创建人ID（不传则为系统 + 当前用户）
- `path_url`：前端跳转路径URL，如“/pages/game/detail/schulte-detail”

**响应**：
- **200**：`{ "message": "Success", "data": [ ... ] }`
- **401**：未登录
- **500**：服务器内部错误

---

## GET /todo-items/:id

**标签**：需登录

查询单个事项详情。若为用户自定义事项，只允许创建者访问。

**响应**：
- **200**：`{ "message": "Success", "data": {...} }`
- **401**：未登录
- **403**：无权限访问该自定义事项
- **404**：事项不存在
- **500**：服务器内部错误

---

## POST /todo-items

**标签**：需登录

新增用户自定义事项（系统默认事项由后台初始化，不通过此接口创建）。

**请求体**：
```json
{
  "item_name": "早起刷牙",
  "item_type": 1,
  "item_category": "生活类",
  "path_url": "/pages/game/detail/schulte-detail",
  "completion_type": 1,
  "completion_target": null,
  "completion_unit": null
}
```

**字段说明**：
- `item_name`（必填）：事项名称
- `item_type`（必填）：1=孩子事项，2=家长事项
- `item_category`（可选）：分类标签
- `path_url`（可选）：前端跳转路由路径
- `completion_type`（可选，默认 1）：1=一次即完成，2=按次数完成，3=按时长完成
- `completion_target`（可选）：目标值；类型 2/3 时必填且 ≥1
- `completion_unit`（可选）：仅类型 3 使用，时长单位：`minute` / `second`

**响应**：
- **201**：创建成功
- **400**：缺少必填或类型不合法
- **401**：未登录
- **409**：同名事项已存在
- **500**：服务器内部错误

---

## PUT /todo-items/:id

**标签**：需登录

更新用户自定义事项（系统默认事项不可修改）。

**请求体（所有字段可选）**：
```json
{
  "item_name": "早起刷牙",
  "item_type": 1,
  "item_category": "生活类",
  "path_url": "/pages/game/detail/schulte-detail",
  "status": 1,
  "completion_type": 1,
  "completion_target": null,
  "completion_unit": null
}
```

**响应**：
- **200**：更新成功
- **400**：无可更新字段 / 类型不合法
- **401**：未登录
- **403**：系统默认事项或他人事项，禁止修改
- **404**：事项不存在
- **409**：与其他事项重名
- **500**：服务器内部错误

---

## DELETE /todo-items/:id

**标签**：需登录

删除用户自定义事项（软删除：将 status 设为 0）。系统默认事项不可删除。

**响应**：
- **200**：删除成功
- **401**：未登录
- **403**：系统默认事项或他人事项，禁止删除
- **404**：事项不存在
- **500**：服务器内部错误

---

## POST /daily-todos

**标签**：需登录

按日期批量新增每日待办（孩子 / 家长），同时为每条待办初始化一条未完成的打卡记录。

**请求体**：
```json
{
  "todo_date": "2025-12-30",
  "todos": [
    {
      "item_id": 1,
      "child_id": 1,
      "is_mandatory": 1,
      "remark": "阅读《西游记》第5回"
    },
    {
      "item_id": 2,
      "child_id": null,
      "is_mandatory": 0,
      "remark": "作业包含数学口算"
    }
  ]
}
```

**字段说明**：
- `todo_date`（必填）：日期，格式 `YYYY-MM-DD`
- `todos`（必填）：待办数组
- `item_id`（必填）：关联 `todo_item_dict.id`
- `child_id`（条件必填）：事项类型为孩子事项时必填，为家长事项时必须为 null
- `is_mandatory`（可选）：是否必做，1=是，0=否（默认 0）
- `remark`（可选）：备注

**响应**：见实现返回格式。

---

## GET /daily-todos

**标签**：需登录

查询每日待办计划，可按日期 / 范围 / 孩子 / 类型等维度过滤。每条记录附带打卡状态与进度：`is_completed`、`checkin_time`、`progress_count`、`progress_duration_minutes`。

**常用用法**：
- 不带参数：默认返回“今天”的所有有效待办
- `?todo_date=2025-12-30`：指定日期
- `?start_date=2025-12-01&end_date=2025-12-31`：日期区间
- `?child_id=1`：指定孩子的待办
- `?child_id=null`：仅家长待办
- `?item_type=1`：仅孩子事项
- `?item_type=2`：仅家长事项

---

## GET /daily-todos/:id

**标签**：需登录

查询单条每日待办详情，包含打卡状态与进度：`is_completed`、`checkin_time`、`progress_count`、`progress_duration_minutes`。

---

## PUT /daily-todos/:id

**标签**：需登录

更新每日待办，仅支持更新：是否必做、备注、状态等字段。

---

## DELETE /daily-todos/:id

**标签**：需登录

删除每日待办（软删除：将 status 设为 0）。

---

## PUT /checkin/:daily_todo_id

**标签**：需登录

更新打卡记录（支持家长为孩子代打卡）。若记录不存在会自动创建。支持按次数/按时长事项的进度上报与自动完成判定。

**请求体**：
```json
{
  "is_completed": 1,
  "checkin_remark": "已完成，用时20分钟",
  "progress_count": 3,
  "progress_count_delta": 1,
  "progress_duration_minutes": 30
}
```

**字段说明**：
- `is_completed`（必填）：0=未完成，1=已完成
- `checkin_remark`（可选）：打卡备注
- `progress_count`（可选，**覆盖**）：当前累计完成次数的总值，用于 `completion_type=2`；与 `progress_count_delta` 二选一
- `progress_count_delta`（可选，**累加**）：在现有 `progress_count` 上增加次数（如跳绳每次达成传 1），用于多次达成目标；与 `progress_count` 二选一，传本字段时按累加
- `progress_duration_minutes`（可选）：当前累计时长（分钟），用于 `completion_type=3` 的事项

响应中会包含 `completion_type`、`completion_target`、`completion_unit` 以及更新后的 `progress_count`、`progress_duration_minutes`。

---

## GET /checkin/:daily_todo_id

**标签**：需登录

查询某条每日待办对应的打卡记录，响应包含 `completion_target`、`progress_count`、`is_completed` 等。如尚未打卡，会返回未完成的默认状态。

**响应 200 完整结构**：
```json
{
  "message": "Success",
  "data": {
    "id": 1,
    "daily_todo_id": 15,
    "checkin_user_id": 2,
    "is_completed": 0,
    "checkin_time": null,
    "checkin_remark": null,
    "progress_count": 0,
    "progress_duration_minutes": 0,
    "create_time": "2026-01-31T03:37:21.000Z",
    "update_time": "2026-01-31T03:37:21.000Z",
    "todo_date": "2026-01-31T00:00:00.000Z",
    "child_id": null,
    "item_name": "亲子爱心信",
    "item_type": 2,
    "item_category": null,
    "path_url": "/pages/mine/love-letter",
    "completion_type": 1,
    "completion_target": null,
    "completion_unit": null,
    "child_name": null
  }
}
```

- 有打卡记录时：`data` 包含上表所有字段；`completion_type`/`completion_target`/`completion_unit` 来自事项字典。
- 无打卡记录时：`data` 无 `id`、`checkin_user_id`、`create_time`、`update_time`；`is_completed`=0、`progress_count`=0、`progress_duration_minutes`=0、`checkin_time`=null、`checkin_remark`=null；其余为待办与事项信息。

---

## GET /checkin/date/:date

**标签**：需登录

按某一天维度，查询当前家长名下所有待办的打卡情况，并附带统计数据。

---

## GET /checkin/month/:year/:month

**标签**：需登录

按月份汇总打卡情况，既返回整月统计，又返回每天的统计信息。

---

## 全局说明

- **服务基础地址**：`http://localhost:3000`
- 所有需要登录的接口都需要在请求头中携带：`Authorization: Bearer <jwt>`
- 请求体统一使用 `Content-Type: application/json`
- 密码存储使用 bcrypt 哈希（10 轮）
- **双角色事项 / 待办设计**：
  - 事项层面：通过 `todo_item_dict.item_type` 区分孩子事项(1) / 家长事项(2)
  - 待办层面：孩子待办 `child_id` 不为空；家长待办 `child_id` 为空
- **打卡与待办的关联**：一条每日待办对应一条打卡记录；创建待办时即初始化打卡记录
- **完成条件与进度**：`completion_type` 1=一次即完成，2=按次数，3=按时长；类型 2/3 时通过 `progress_count` / `progress_duration_minutes` 达到 `completion_target` 自动视为已完成
