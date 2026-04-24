# 基于信息检索增强的知识库问答系统 - 数据库设计文档

## 1. 概述

本文档基于系统的核心需求（涵盖知识库管理、角色权限隔离、Agentic RAG 问答、公有模型防盗刷以及系统审计等高级特性）编写。数据库采用关系型数据库 MySQL 设计，ORM 框架选用 Prisma，以保证端到端的类型安全与高效开发。

系统采用 `b_` 前缀表示业务（Business/Frontend）相关表，`sys_` 前缀表示系统管理（System/Backend）相关表。

---

## 2. 实体关系图 (ER 模型概述)

整个数据库架构围绕以下六个核心模块展开：

1. **用户与认证模块** (`b_users`, `sys_admins`, `sys_email_codes`, `b_user_sessions`, `sys_admin_sessions`)
2. **大模型配置模块** (`sys_model_configs`, `b_user_model_configs`)
3. **知识库与协作模块** (`b_knowledge_bases`, `b_kb_members`, `b_kb_invitations`)
4. **文档与分块解析模块** (`b_documents`, `b_document_chunks`)
5. **聊天与溯源模块** (`b_chat_sessions`, `b_chat_messages`)
6. **系统与审计日志模块** (`sys_audit_logs`, `sys_dict_type`, `sys_dict_item`)

---

## 3. 核心数据表结构详解

### 3.1 用户与认证模块

#### 表名：`b_users` (前台业务用户表)

本表记录前台用户基础信息，并集成了**防盗刷配额机制**。

| 字段名             | 类型     | 约束 / 默认值      | 描述                         |
| :----------------- | :------- | :----------------- | :--------------------------- |
| `id`               | BigInt   | 主键, 自增         | 用户唯一标识                 |
| `email`            | String   | 唯一, VarChar(255) | 登录邮箱                     |
| `password_hash`    | String   | VarChar(255)       | 密码哈希值                   |
| `full_name`        | String   | VarChar(100)       | 用户昵称/姓名                |
| `avatar_url`       | String   | VarChar(500)       | 头像地址                     |
| `is_active`        | Boolean  | 默认: `true`       | 账号状态（封禁控制）         |
| `daily_chat_limit` | Int      | 默认: `50`         | 每日免费公有模型对话次数上限 |
| `token_quota`      | BigInt   | 默认: `1000000`    | 终身免费公有模型 Token 限额  |
| `used_tokens`      | BigInt   | 默认: `0`          | 已消耗公有模型 Token 总量    |
| `created_at`       | DateTime | 默认: `now()`      | 创建时间                     |
| `updated_at`       | DateTime | 默认: `now()`      | 更新时间                     |

#### 表名：`sys_admins` (后台管理用户表)

用于后台管理系统的管理员账户。

| 字段名          | 类型    | 约束 / 默认值      | 描述                              |
| :-------------- | :------ | :----------------- | :-------------------------------- |
| `id`            | BigInt  | 主键, 自增         | 管理员唯一标识                    |
| `username`      | String  | 唯一, VarChar(100) | 登录用户名                        |
| `password_hash` | String  | VarChar(255)       | 密码哈希                          |
| `role`          | String  | 默认: `"admin"`    | 角色（`super_admin`, `operator`） |
| `is_active`     | Boolean | 默认: `true`       | 账号状态                          |

#### 表名：`sys_email_codes` (邮箱验证码表)

| 字段名       | 类型     | 约束 / 默认值   | 描述                         |
| :----------- | :------- | :-------------- | :--------------------------- |
| `email`      | String   | VarChar(255)    | 邮箱地址                     |
| `code`       | String   | Char(6)         | 验证码                       |
| `purpose`    | Int      | UnsignedTinyInt | 用途（1:注册, 2:找回密码等） |
| `used`       | Boolean  | 默认: `false`   | 是否已使用                   |
| `expired_at` | DateTime | 必填            | 过期时间                     |

#### 表名：`b_user_sessions` / `sys_admin_sessions` (会话管理表)

用于管理前后台用户的登录态（Refresh Token 机制）。

---

### 3.2 大模型配置模块

#### 表名：`sys_model_configs` (系统全局模型配置)

仅限管理员维护。当用户未配置私有 Key 时，系统兜底使用的公有模型。

| 字段名        | 类型    | 约束 / 默认值 | 描述                                   |
| :------------ | :------ | :------------ | :------------------------------------- |
| `provider`    | String  | VarChar(50)   | 模型服务商 (如: openai, zhipu)         |
| `name`        | String  | VarChar(100)  | 模型名称                               |
| `type`        | String  | VarChar(50)   | 模型类型 (chat, embedding)             |
| `base_url`    | String  | VarChar(255)  | API 基础路径                           |
| `api_key`     | String  | VarChar(500)  | API Key                                |
| `config_json` | Json    | 可选          | 扩展配置 (如: temperature, max_tokens) |
| `is_default`  | Boolean | 默认: `false` | 是否作为全站默认调用模型               |

#### 表名：`b_user_model_configs` (用户私有模型配置)

用户个人填写的 API Key。提问时系统优先读取本表配置，**使用私有配置不扣除系统 Token 配额**。

---

### 3.3 知识库与协作模块

#### 表名：`b_knowledge_bases` (知识库主表)

本表需要支撑两种知识库类型，以及共享知识库上的开源策略：

- `private`：私有，仅创建者可访问，不参与公开搜索
- `shared`：共享，支持邀请成员协作
- 当 `visibility = shared` 时，可进一步通过公开配置控制：
  - 是否可被登录用户搜索发现
  - 是否允许登录用户直接问答
  - 是否允许下载知识库内文件

| 字段名        | 类型   | 约束 / 默认值     | 描述                          |
| :------------ | :----- | :---------------- | :---------------------------- |
| `name`        | String | VarChar(100)      | 知识库名称                    |
| `description` | String | Text              | 知识库描述                    |
| `visibility`  | String | 默认: `"private"` | 类型（`private`, `shared`） |
| `status`      | String | 默认: `"normal"`  | 状态（`normal`, `disabled`）  |
| `owner_id`    | BigInt | 外键              | 创建者 ID                     |

建议补充说明：

- `visibility = shared` 时，成员关系由 `b_kb_members` 维护
- 共享知识库的“是否开源”不建议再建第三种 `visibility`，而应作为共享知识库的公开访问策略字段维护
- 向量检索时除 `kbId` 过滤外，还需结合 `visibility`、公开配置与用户身份决定是否可检索

#### 表名：`b_kb_members` (知识库成员权限表)

本表用于**共享知识库**协作成员管理。即使共享知识库已开启开源，也仍可通过本表维护协作者。

| 字段名      | 类型     | 约束 / 默认值    | 描述                                           |
| :---------- | :------- | :--------------- | :--------------------------------------------- |
| `kb_id`     | BigInt   | 外键             | 知识库 ID                                      |
| `user_id`   | BigInt   | 外键             | 用户 ID                                        |
| `role`      | String   | 默认: `"member"` | 成员角色 (`manager`, `collaborator`, `member`) |
| `joined_at` | DateTime | 默认: `now()`    | 加入时间                                       |

说明：

- `owner` 实际仍以 `b_knowledge_bases.owner_id` 为主，不建议在成员表中重复维护创建者数据
- `publicVisitor` 不进入本表，仅在知识库公开时由业务层动态识别
- `member` 为默认加入角色，`manager / collaborator` 由邀请链路显式指定

#### 表名：`b_kb_invitations` (知识库邀请链接表)

本表用于**共享知识库邀请加入**。共享知识库是否开源，不影响其邀请协作者能力。

| 字段名        | 类型     | 约束 / 默认值     | 描述       |
| :------------ | :------- | :---------------- | :--------- |
| `invite_code` | String   | 唯一, VarChar(64) | 邀请码     |
| `role`        | String   | 默认: `"member"`  | 受邀角色 (`manager`, `collaborator`, `member`) |
| `expired_at`  | DateTime | 必填              | 过期时间   |
| `is_used`     | Boolean  | 默认: `false`     | 是否已使用 |

建议后续按实现复杂度评估补充以下字段：

- `cancelled_at`：主动撤销邀请
- `accepted_by`：接受邀请的用户
- `accepted_at`：接受邀请时间
- `status`：统一表达 `active / used / expired / cancelled`

---

### 3.4 文档与分块解析模块

#### 表名：`b_documents` (文档元数据表)

| 字段名        | 类型   | 约束 / 默认值     | 描述                                                  |
| :------------ | :----- | :---------------- | :---------------------------------------------------- |
| `uploader_id` | BigInt | 可空, 外键        | 上传者 ID，用于判断协作者是否只能管理自己上传的文件   |
| `title`       | String | VarChar(255)      | 文档标题                                              |
| `file_path`   | String | VarChar(500)      | 文件存储路径                                          |
| `file_hash`   | String | VarChar(64)       | 文件 Hash (用于秒传/去重)                             |
| `status`      | String | 默认: `"pending"` | 解析状态 (`uploaded`, `queued`, `parsing`, `chunking`, `embedding`, `ready`, `failed`) |
| `token_count` | Int    | 默认: `0`         | 文档总 Token 量                                       |

说明：

- `owner / manager` 可管理任意文档
- `collaborator` 只能管理 `uploader_id = currentUserId` 的文档
- 成员体系默认可下载文档，公开访客是否可下载由知识库 `allow_public_download` 决定

建议后续按需要补充：

- `uploader_id`：上传者
- `original_filename`：原始文件名
- `mime_type`：文件 MIME 类型
- `parse_started_at` / `parse_finished_at`：解析耗时分析

#### 表名：`b_document_chunks` (文档文本切片表)

| 字段名             | 类型   | 约束 / 默认值     | 描述           |
| :----------------- | :----- | :---------------- | :------------- |
| `doc_id`           | BigInt | 外键              | 文档 ID        |
| `chunk_index`      | Int    | 必填              | 切片序号       |
| `content`          | String | LongText          | 切片纯文本内容 |
| `token_count`      | Int    | 默认: `0`         | 切片 Token 量  |
| `embedding_status` | String | 默认: `"pending"` | 向量化状态     |

建议补充字段以支持问答溯源与向量同步：

- `page_no`
- `char_start`
- `char_end`
- `vector_id`
- `metadata_json`

---

### 3.5 聊天与溯源模块

#### 表名：`b_chat_sessions` (聊天会话表)

| 字段名    | 类型   | 约束 / 默认值    | 描述          |
| :-------- | :----- | :--------------- | :------------ |
| `id`      | String | 主键, Char(36)   | 会话 UUID     |
| `user_id` | BigInt | 外键             | 用户 ID       |
| `kb_id`   | BigInt | 可选, 外键       | 关联知识库 ID |
| `title`   | String | 默认: `"新会话"` | 会话标题      |

#### 表名：`b_chat_messages` (聊天消息与溯源表)

| 字段名          | 类型   | 约束 / 默认值 | 描述                                             |
| :-------------- | :----- | :------------ | :----------------------------------------------- |
| `role`          | String | VarChar(50)   | 消息角色 (`user`, `assistant`, `system`, `tool`) |
| `content`       | String | Text          | 消息内容                                         |
| `references`    | Json   | 可选          | 溯源信息（引用文档段落）                         |
| `tool_calls`    | Json   | 可选          | 工具调用记录                                     |
| `tokens_used`   | Int    | 默认: `0`     | 本次消息消耗 Token                               |
| `feedback_type` | String | VarChar(20)   | 反馈（`like`, `dislike`）                        |

---

### 3.6 系统与审计日志模块

#### 表名：`sys_audit_logs` (系统操作审计日志)

| 字段名       | 类型   | 约束 / 默认值  | 描述          |
| :----------- | :----- | :------------- | :------------ |
| `admin_id`   | BigInt | 外键 (SetNull) | 操作管理员 ID |
| `action`     | String | VarChar(100)   | 行为名称      |
| `module`     | String | VarChar(50)    | 业务模块      |
| `ip_address` | String | VarChar(50)    | 操作 IP       |
| `details`    | Json   | 可选           | 操作详情      |

#### 表名：`sys_dict_type` & `sys_dict_item` (数据字典表)

用于管理系统常量（如状态码、配置项分类等）。

## 4. 总结

本数据库设计紧扣项目需求，通过 Prisma 实现了严格的 Schema 约束，重点解决了 **“私有数据盲区保护”、“公有模型防盗刷”、“细粒度文件权限”与“复杂 Agentic RAG 溯源”** 四个技术难点。前后台表结构的物理隔离（`b_` 与 `sys_`）进一步提升了系统的安全性与可维护性。
