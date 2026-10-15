# 本机工单 HTTP API

CLI 项目服务的端口自动分配，通过 human-use status 查看，或用 human-use api 自动连接；独立源码服务默认 http://127.0.0.1:4317。AI API 使用 `Authorization: Bearer <token>`，token 位于数据目录的 api-token 文件。JSON 请求必须指定 Content-Type: application/json。响应错误形如 `{"error":"具体原因"}`，状态码 400 表示契约错误，401/403 表示访问拒绝，404 表示不存在，409 表示版本或状态冲突，413 表示超过请求大小，422 表示未满足提交必填条件，500 表示服务内部错误（细节见服务终端）。

## 创建与读取

`POST /api/tickets`，请求例见 [examples/ticket.json](../examples/ticket.json)。

可选 binding_id 关联已登记会话，服务会检查绑定存在。必填字段为 title、description、acceptance、source、request_key、units。description 和 acceptance 可以是空字符串；其余文本必填。source 与 request_key 组合是幂等键，相同键和相同请求返回原工单（200），不同内容返回 409。新工单返回 201，响应包含 `{created, ticket, url}`。

每个任务单元需要唯一 id（字母、数字、下划线、连字符，最长 64 位，不可使用对象保留键）、type、label、required（布尔值），可选 description。

| type | 额外字段 | answers 中的值 |
| --- | --- | --- |
| checklist | items: [{id,label}] | 已完成 item ID 数组；必填单元要求全部勾选 |
| text | 无 | 字符串 |
| number | 可选 unit 字符串 | 数值或草稿中的 null；0 是有效数值 |
| timestamp | 无 | UTC ISO 8601 字符串，例如 `2026-10-15T10:30:00.000Z`；草稿或选填项可为空字符串 |
| choice | options: [{id,label}]、multiple 布尔值 | 选中的 option ID 数组；单选最多一个 |
| attachment | 无 | 属于该单元的附件 ID 数组 |

timestamp 在网页上显示为可手动编辑的本地日期时间，精确到秒；右侧 Get Time 读取浏览器所在电脑的当前时间，仅填入该字段，不自动保存或提交。保存时转换成 UTC ISO 字符串，读取和历史显示时转换回浏览器的本地时间。必填时间为空时不能提交。它是可由人调整的操作时间记录，独立于服务生成的 submitted_at，不作为可信时间认证。

`GET /api/tickets` 返回 `{tickets:[摘要...]}`，可带 status、source、q、binding_id 查询参数。status 是 pending、submitted、returned、blocked、archived、cancelled 之一。q 匹配标题、来源、工单 ID 和归档哈希。查询结果按工单创建顺序倒序。

`GET /api/tickets/{id}` 返回完整工单，包括 units、draft、attachments、submissions、reviews、events、revision、archive_hash，另有 unread_count、last_event_id 和 activity。业务 events 属于归档历史；activity 是独立全局通知。使用返回的 url 或 `/#ticket/{id}` 打开网页。请求来源和 request_key 可关联原 AI 任务。

`GET /api/tickets/{id}/attachments/{attachment_id}` 返回原始字节（读取时检查存储内容哈希）。PNG/JPEG/WebP/GIF 以图片类型返回，其他附件以 application/octet-stream 下载。添加 `?download=1` 强制下载。附件元数据中的 name 为原文件名，mime、size、sha256 描述上传的原始文件。

```powershell
node tools/bridge.mjs GET /api/tickets/TK-000001
node tools/bridge.mjs GET /api/tickets/TK-000001/attachments/附件ID --out photo.png
```

## 验收与取消

`POST /api/tickets/{id}/review` 必须由 AI Bearer API 调用；普通网页会话不能代替 AI 点击验收。

读取最新 submissions 中的 version 与 hash，并检查回答和所需附件，再保存 review.json：

```json
{
  "version": 1,
  "submission_hash": "替换为最新提交的完整哈希",
  "decision": "accept",
  "reason": "说明已检查哪些证据，以及为何满足验收标准。"
}
```

```powershell
node tools/bridge.mjs POST /api/tickets/TK-000001/review review.json
```

decision 为 accept 或 return。两者都必须有非空 reason。只有 submitted 状态可以验收，版本和哈希必须同时匹配最新提交。return 保留提交并允许补充；accept 冻结工单、生成归档包，响应完整工单包含 archive_hash。重复或过期验收返回 409，调用方应读取现状后决定下一步，不要盲目重试。

退回时可选 `additional_units`，使用与创建工单相同的单元结构，ID 必须与原有单元及本批次中的其他单元不同。例如：

```json
{
  "version": 1,
  "submission_hash": "替换为最新提交的完整哈希",
  "decision": "return",
  "reason": "请补充设备型号和能看清接口的近照。",
  "additional_units": [
    { "id": "model", "type": "text", "label": "设备型号", "required": true },
    { "id": "closeup", "type": "attachment", "label": "接口近照", "required": true }
  ]
}
```

补充项追加在原单元之后，并记录在对应 review 中；不修改原控件或历史提交。下一次人工提交需要完成所有必填项，快照中的 `units` 保存该次实际要求并参与哈希。`additional_units` 若提供则不能为空，accept 不允许携带该字段。API 与 MCP 的 `review_ticket` 使用相同字段。

`POST /api/tickets/{id}/cancel` 请求 `{revision,reason}`，允许取消未归档且未取消的工单，保留取消事件。已归档工单不允许取消或重开。

## 归档

`GET /api/archives/{完整64位哈希}` 和 `GET /api/archives/{哈希}/verify` 均重新校验，返回 `{hash,valid,errors,file_count,ticket}`。校验不通过时 ticket 为 null，不把被修改内容作为可信业务数据返回。仅缺少 manifest 时可能没有 file_count。

`GET /api/archives/{哈希}/download` 先校验，再返回 ZIP 字节；不通过返回 409。

```powershell
node tools/bridge.mjs GET /api/archives/完整哈希
node tools/bridge.mjs GET /api/archives/完整哈希/download --out workorder.zip
```

ZIP 包含 ticket.json、submissions/{版本}.json、attachments/{附件ID}、reviews.json、events.json、manifest.json。ticket.json 内保留附件 ID 与原文件名映射。归档包含本工单尚未删除的全部附件，包括后来未纳入最新提交的文件；每次提交中的 answers 决定该版本实际引用的附件。已被历史提交引用的附件不能物理删除。未提交的误传文件可由人删除，删除后不进入归档。

清单列出除自身之外的全部文件，按路径字典序排列。JSON 的对象键递归按字典序排序，数组维持业务顺序，使用两个空格缩进及一个末尾 LF，再以 UTF-8 写入。根哈希不写回清单，避免循环计算。验证时检查清单哈希、所有文件哈希和字节数，并拒绝额外文件。

## 网页使用的人工接口

以下接口需要从首页取得的 HttpOnly、SameSite=Strict 本机网页会话 Cookie。AI Bridge 不应代替人提交；单用户系统并不构成人员身份认证。草稿、上传和状态修改返回完整工单，revision 递增；已读接口独立，不改业务版本。草稿只允许 pending、returned、blocked 状态编辑。

| 接口 | 请求 |
| --- | --- |
| POST /api/tickets/{id}/draft | `{revision,answers,note}`，保存整份草稿 |
| POST /api/tickets/{id}/attachments?unit_id=...&name=...&revision=... | 原始文件字节，Content-Type 为文件类型，上限 20 MiB；自动加入该单元的草稿答案 |
| POST /api/tickets/{id}/attachments/{attachment_id}/remove | `{revision}`；从未被提交引用的附件会删除文件和元数据；历史引用的附件只从当前草稿移除，原文件及历史提交保留 |
| POST /api/tickets/{id}/submit | `{revision}`，检查必填并冻结提交快照 |
| POST /api/tickets/{id}/block | `{revision,reason}`，无需填满必填项 |
| POST /api/tickets/{id}/resume | `{revision}`，恢复为待处理或需补充 |
| POST /api/demo | 无请求体，显式创建一张演示工单 |

人工提交快照包含 version、submitted_at、units、answers、note 和 hash；hash 是除 hash 字段外的固定序列化 JSON 的 SHA-256。旧版没有 units 的提交维持原内容和哈希，不回填、不重算。附件的原始 SHA-256 在附件元数据中保存，提交前检查被引用的附件未改变。

附件上传后默认随本次提交，不再显示勾选框。编辑状态下点击附件右上角“×”，会立即保存当前草稿并调用移除接口；从未被历史提交引用的附件会真正删除，已被引用的附件从当前列表移除，仍可在历史提交中查看。已提交、已归档或已取消状态不显示移除按钮。

## 事件与已读（v0.2）

`GET /api/info` 包含 event_cursor（全局游标）。`GET /api/events` 接受 after（默认 0）、ticket_id、binding_id、audience（human 表示给人看的 AI/系统事件，agent 表示人类业务事件）、limit（1–500，默认 100）。返回 `{events,cursor,latest_cursor}`。cursor 是本页最后匹配的事件，分页携带 cursor；不要用 latest_cursor 跳过尚未读取的后续页。

每个事件包含 event_id、ticket_id、ticket_revision、binding_id、type、actor、title、status、message、created_at，以及可用的 submission_version / submission_hash。支持 ticket.created、submission.created、ticket.blocked、ticket.resumed、review.returned、ticket.archived、ticket.cancelled 和下列 AI 活动。不为草稿输入和逐个上传发送唤醒事件。

`GET /api/events/wait` 接受相同过滤条件及 timeout（0–25 秒，默认 25），有匹配事件立即返回，否则到期返回空 events；客户端取消会清理订阅。提交和对应业务事件在同一 SQLite 事务中保存，提交后才广播。

`GET /api/events/stream` 是同源 SSE，接受相同过滤条件；连接先发送 ready，随后以 `id: event_id` 和 JSON data 推送。重连的 Last-Event-ID 优先于 URL after，断线事件从 SQLite 补读，15 秒心跳。浏览器用 Cookie，程序客户端用 Authorization 请求头；禁止把 token 放入 URL。

人工接口 `POST /api/tickets/{id}/read` 请求 `{event_id}`，返回 unread_count 和 last_event_id，不改变工单 revision、提交或归档。只确认已经展示的游标，不自动确认未来更新。已读在同一台本机的浏览器窗口间共享。

AI 接口 `POST /api/tickets/{id}/activity` 请求 `{type,message,external_id}`。type 为 agent.check_completed、agent.waiting_for_approval、agent.turn_finished、agent.message 之一；消息 1–2000 字，external_id 1–200 字。按工单和 external_id 去重，重复但内容不同返回 409。活动独立于证据，不能在已归档或已取消工单追加；turn_finished 不等于验收通过。

## 会话绑定（v0.2）

以下接口需要 Bearer 凭证：

| 接口 | 请求 / 返回 |
| --- | --- |
| POST /api/bindings | `{client,session_id,cwd}`；client 为 codex、claude、generic；相同三元组返回同一个绑定 |
| GET /api/bindings/{id} | `{id,client,session_id,cwd,cursor,lease_until}` |
| POST /api/bindings/{id}/ack | `{previous_cursor,cursor}`；原游标必须相同，新游标不能超出已有全局游标 |
| POST /api/bindings/{id}/lease | `{seconds}`，1–3600；未被占用时取得租约，返回 acquired 和 lease_until |
| POST /api/bindings/{id}/lease | `{seconds:0,lease_until}`，只有匹配的租约才能释放 |

绑定初始 cursor 为登记时的全局游标。先绑定，再创建携带 binding_id 的工单。游标确认表示脚本输出了通知，不能表示模型读完证据；无法以此保证外部模型只执行一次。客户端配置和限时等待见 [接入指南](接入指南.md)。

## 客户端边界

本机 API 不开放跨域，不接受任意 Host，仅监听回环地址。Bearer 凭证不要写进 URL、截图、日志或工单。MCP、Skill 和 hook 都复用此 API。无内置模型调用、任意 shell 回调、远程访问或云端存储。主动续跑取决于客户端，见 [接入指南](接入指南.md)。

## CLI 管理接口（v0.3）

GET /api/info 另包含 project（id、name、root，独立服务为 null）、instance_id 和当前 package 版本。项目运行信息保存在 .human-use/runtime.json；它不包含凭证，客户端仍需读取本项目 api-token。

POST /api/service/stop 仅用于 CLI 管理的服务，需要 Bearer 凭证以及 `{instance_id}`。实例不匹配返回 409，独立源码服务不提供该操作。停止由服务自身清理 SSE、HTTP、SQLite 与运行记录，不影响工单或归档。

每个项目使用独立 Cookie 名称，避免同一主机不同端口的浏览器会话互相覆盖。Cookie 名称基于本项目凭证派生，复制项目配置不会混用会话。
