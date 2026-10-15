# Human Use

**把 AI 需要人完成的一步，变成有结果、有证据的工单。**

[English](README.md) · [API 文档](docs/API.md) · [贡献指南](CONTRIBUTING.md) · [MIT 许可证](LICENSE)

AI 创建工单，人通过本机网页完成操作并提供证据，AI 验收后生成带 SHA-256 的完整工单包。数据保存在本机，支持退回补交、附件预览、归档检索、完整性校验与 ZIP 导出。

## 启动

需要 Node.js 24 或更新版本。本项目没有第三方依赖，无需 npm install。下载或克隆仓库后，在项目目录运行：

```powershell
npm start
```

打开 http://127.0.0.1:4317。保持服务进程运行；在终端按 Ctrl+C 停止。首次启动是空工作空间，可在页面明确点击“新建示例”体验任务单元。

如端口被占用，使用 `$env:PORT = '4318'` 后启动。可用 `$env:WORKORDER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'HumanUse'` 指定其他本地数据目录。CLI 调用与服务使用同样的环境变量。自定义数据目录应放在仓库目录之外。

## AI 接入

启动服务后，在项目根目录运行：

```powershell
node tools/bridge.mjs POST /api/tickets examples/ticket.json
node tools/bridge.mjs GET /api/tickets?status=submitted
node tools/bridge.mjs GET /api/tickets/TK-000001
```

Bridge 自动读取数据目录中的 api-token，不在日志中输出凭证。AI 也可直接调用 HTTP API，使用 Bearer token。完整契约与验收示例见 [API 文档](docs/API.md)。首版已提供 HTTP Bridge，MCP 封装留待后续接入具体客户端时实现。

## 使用流程

1. AI 建单，说明目的、验收标准及所需的任务单元，取得 ID 和本机链接。
2. 人填写 checklist、文本、数值、选项并上传文件，保存草稿或报告无法完成。
3. 人点击“提交完成”，软件冻结该次提交及其哈希，等待 AI 验收。
4. AI 读取回答和所需附件，对明确的提交版本验收。退回须说明原因，补交产生新版本。
5. AI 验收通过后形成归档包，可按完整哈希查找、校验、导出 ZIP。

页面每 12 秒查询一次状态；编辑时不会自动覆盖未保存输入。软件不会主动唤醒 AI 会话，需要接入客户端主动查询工单。

## 数据与边界

默认 data/ 保存 SQLite、附件、归档及 API 凭证。停止服务后复制整个数据目录即可备份；备份包含凭证，应按本机私有数据保管。API 凭证不应提交到版本库。

仅监听 127.0.0.1，不接受远程或跨域调用。网页代表本机操作者，Bearer API 代表接入代理，属于单用户协作约定，不提供人员身份、物理操作或签名证明。文字按文本展示，上传内容不会被执行。

图片上传区支持直接粘贴截图：截图复制到剪贴板后，点击对应单元的上传区，按 Ctrl+V，即会保存并预览；也可继续选择本机文件上传。普通文本框仍按通常方式粘贴文字。

图片支持 PNG、JPEG、WebP、GIF 预览，其他文件以下载方式读取，单文件不超过 20 MiB。无录音转写、云服务、遥测、外部 CDN、手机访问或多人权限。云端 AI 客户端读取工单后，内容可能发送给其模型；应用本地存储不等于模型在本地运行。

归档标识为 manifest.json 字节的 SHA-256。清单记录全部业务文件的路径、大小和哈希，导出 ZIP 的容器元数据不参与内容标识。页面校验失败时拒绝导出被修改的归档。

## 开发

遵守 [AGENTS.md 中的开发纪律](AGENTS.md)。冻结开发基线见 [首版方案](docs/方案-v1.md)。

```powershell
npm test
```

测试使用 Node.js 内置测试器，覆盖完整闭环、提交快照、过期验收、草稿冲突、证据修改、重启持久化、HTTP 访问边界与 ZIP 内容。Windows 受限沙箱可能阻止回环连接或目录重命名，需在普通本机终端运行这些检查。

GitHub CI 配置了 Node.js 24 的 Windows 与 Linux 测试。欢迎用中文或英文提交 Issue 和 PR，详见 [贡献指南](CONTRIBUTING.md)。安全边界与漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)，版权归 2026 Human Use contributors。
