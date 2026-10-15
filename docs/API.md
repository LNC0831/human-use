# 本机工单 HTTP API

基地址默认为 http://127.0.0.1:4317。AI API 使用 `Authorization: Bearer <token>`，token 位于数据目录的 api-token 文件。JSON 请求必须指定 Content-Type: application/json。响应错误形如 `{"error":"具体原因"}`，状态码 400 表示契约错误，401/403 表示访问拒绝，404 表示不存在，409 表示版本或状态冲突，413 表示超过请求大小，422 表示未满足提交必填条件，500 表示服务内部错误（细节见服务终端）。

## 创建与读取

`POST /api/tickets`，请求例见 [examples/ticket.json](../examples/ticket.json)。

必填字段为 title、description、acceptance、source、request_key、units。description 和 acceptance 可以是空字符串；其余文本必填。source 与 request_key 组合是幂等键，相同键和相同请求返回原工单（200），不同内容返回 409。新工单返回 201，响应包含 `{created, ticket, url}`。

每个任务单元需要唯一 id（字母、数字、下划线、连字符，最长 64 位，不可使用对象保留键）、type、label、required（布尔值），可选 description。

| type | 额外字段 | answers 中的值 |
| --- | --- | --- |
| checklist | items: [{id,label}] | 已完成 item ID 数组；必填单元要求全部勾选 |
| text | 无 | 字符串 |
| number | 可选 unit 字符串 | 数值或草稿中的 null；0 是有效数值 |
| choice | options: [{id,label}]、multiple 布尔值 | 选中的 option ID 数组；单选最多一个 |
| attachment | 无 | 属于该单元的附件 ID 数组 |

`GET /api/tickets` 返回 `{tickets:[摘要...]}`，可带 status、source、q 查询参数。status 是 pending、submitted、returned、blocked、archived、cancelled 之一。q 匹配标题、来源、工单 ID 和归档哈希。查询结果按工单创建顺序倒序。

`GET /api/tickets/{id}` 返回完整工单，包括 units、draft、attachments、submissions、reviews、events、revision、archive_hash。使用返回的 url 或 `/#ticket/{id}` 打开网页。请求来源和 request_key 可关联原 AI 任务。

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

`POST /api/tickets/{id}/cancel` 请求 `{revision,reason}`，允许取消未归档且未取消的工单，保留取消事件。已归档工单不允许取消或重开。

## 归档

`GET /api/archives/{完整64位哈希}` 和 `GET /api/archives/{哈希}/verify` 均重新校验，返回 `{hash,valid,errors,file_count,ticket}`。校验不通过时 ticket 为 null，不把被修改内容作为可信业务数据返回。仅缺少 manifest 时可能没有 file_count。

`GET /api/archives/{哈希}/download` 先校验，再返回 ZIP 字节；不通过返回 409。

```powershell
node tools/bridge.mjs GET /api/archives/完整哈希
node tools/bridge.mjs GET /api/archives/完整哈希/download --out workorder.zip
```

ZIP 包含 ticket.json、submissions/{版本}.json、attachments/{附件ID}、reviews.json、events.json、manifest.json。ticket.json 内保留附件 ID 与原文件名映射。归档包含本工单全部已上传附件，包含后来未勾选纳入最新提交的文件，用于保留过程证据；每次提交中的 answers 决定该版本实际引用的附件。

清单列出除自身之外的全部文件，按路径字典序排列。JSON 的对象键递归按字典序排序，数组维持业务顺序，使用两个空格缩进及一个末尾 LF，再以 UTF-8 写入。根哈希不写回清单，避免循环计算。验证时检查清单哈希、所有文件哈希和字节数，并拒绝额外文件。

## 网页使用的人工接口

以下接口需要从首页取得的 HttpOnly、SameSite=Strict 本机网页会话 Cookie。AI Bridge 不应代替人提交；单用户系统并不构成人员身份认证。所有修改返回完整工单，revision 递增。草稿只允许 pending、returned、blocked 状态编辑。

| 接口 | 请求 |
| --- | --- |
| POST /api/tickets/{id}/draft | `{revision,answers,note}`，保存整份草稿 |
| POST /api/tickets/{id}/attachments?unit_id=...&name=...&revision=... | 原始文件字节，Content-Type 为文件类型，上限 20 MiB；自动加入该单元的草稿答案 |
| POST /api/tickets/{id}/submit | `{revision}`，检查必填并冻结提交快照 |
| POST /api/tickets/{id}/block | `{revision,reason}`，无需填满必填项 |
| POST /api/tickets/{id}/resume | `{revision}`，恢复为待处理或需补充 |
| POST /api/demo | 无请求体，显式创建一张演示工单 |

人工提交快照包含 version、submitted_at、answers、note 和 hash；hash 是除 hash 字段外的固定序列化 JSON 的 SHA-256。附件的原始 SHA-256 在附件元数据中保存，提交前检查被引用的附件未改变。

## 客户端边界

本机 API 不开放跨域，不接受任意 Host，仅监听回环地址。Bearer 凭证不要写进 URL、截图、日志或工单。无内置 AI 调用、MCP 服务、主动唤醒、Webhook、远程访问或云端存储。
