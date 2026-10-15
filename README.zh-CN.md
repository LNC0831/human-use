# Human Use

**把 AI 需要人完成的一步，变成有结果、有证据的工单。**

[English](README.md) · [接入指南](docs/接入指南.md) · [部署与发布](docs/部署与发布.md) · [API](docs/API.md) · [MIT](LICENSE)

软件安装一次，每个项目分别初始化、启动和保存数据。AI 发起工单，人通过本机网页勾选 checklist、填写回答、粘贴截图或上传文件；AI 按提交版本与哈希验收，完成后形成可校验、可导出的归档包。

界面支持简体中文、繁体中文和英文，通过右上角切换，浏览器记住选择。工单正文、回答与证据保持原文。提交成功后自动返回全部工单列表；提交失败时保留页面并提示原因。

附件上传后默认随本次提交，点击右上角“×”即可移除：未提交过的误传附件会删除，历史提交引用的附件只从本次移除并保留证据。AI 退回时可追加文本、图片等补充任务单元，每次新提交保存当时的完整要求。

时间戳控件可手动调整日期和时间，右侧“获取时间”（Get Time）按钮填入当前本地时间，保存时统一记录为 UTC 时间戳。

## 安装与引入项目

需要 **Node.js 24+**。正式 npm 包名与发布账号尚待确认，目前未发布到 registry。可先在源码仓库生成安装包试用：

```powershell
git clone https://github.com/LNC0831/human-use.git
cd human-use
npm ci --ignore-scripts
npm pack
npm install -g ./human-use-0.3.0.tgz
human-use setup codex
```

setup 安装用户级初始化与协作 Skill；同名非本工具管理的 Skill 会报错，不覆盖。必要时新开 Codex 会话，然后在任意项目说：**“给当前项目引入 Human Use。”** AI 调用 CLI 完成配置，立即启动后台服务并打开页面。也可手动执行：

```powershell
human-use init --project E:/your-project
```

默认生成 Codex 项目 hooks，但仍需要客户端信任和重新加载。`--no-hooks` 只使用 Skill + API；`--no-open` 不打开浏览器；`--client claude` 生成 Claude 项目 hooks。普通文件夹也可使用，worktree 共享留待后续。

## 数据与服务

项目配置位于 human-use.json，工单、原图、归档、凭证和运行信息位于项目私有的 `.human-use/`。初始化只在 AGENTS.md 和 .gitignore 合并管理片段，保留原内容。不会把整套程序复制到项目，也不要求在项目里 npm install。

各项目使用独立后台进程与凭证，端口由系统分配。CLI 自动查找服务和 token；重复初始化、重复启动复用已有实例，未读状态和证据不丢失。可在项目内运行，或传入 `--project`：

```powershell
human-use status
human-use stop
human-use start
human-use open
```

关闭页面或 Codex 不停止服务。更新软件前先停止相关项目，更新后重新 setup codex 并 start。卸载软件保留项目数据。没有系统自启动或运行中热更新。

迁移旧版数据时，先停旧服务，再执行 `human-use migrate --from E:/old/data --project E:/your-project`，然后 init。目标必须为空；源保留，归档哈希不变，目标生成独立凭证。完整说明见 [部署与发布](docs/部署与发布.md)。

## AI 接入与闭环

默认 **Skill + API**，MCP 可选：

```powershell
human-use api POST /api/tickets E:/requests/ticket.json
human-use api GET /api/tickets?status=submitted
human-use integrate codex --mcp
```

MCP stdio 入口是 `human-use mcp`，支持 10 个工具，复用同一 API。AI 必须读取实际回答及相关原始附件，以最新 version 和 submission_hash 验收；不能代替人勾选或提交。退回保留记录，补交形成新版本。[接入指南](docs/接入指南.md)包含调用和 hook 边界。

图片单元支持 Ctrl+V 直接粘贴截图，也可选文件。页面通过 SSE 实时提醒、保存未读，并在更新到来时保留未保存输入。hook 可以把提交事件交给明确绑定的会话；完全空闲时能否继续执行取决于客户端，Claude asyncRewake 示例仍标为实验。

数据不上传云端，无遥测、外部 CDN 或远程访问。接入云端模型后，它读取的内容可能发送给模型提供者。仅监听 127.0.0.1，单文件最多 20 MiB。哈希用于检查内容一致性，不证明物理操作或个人身份。见 [SECURITY.md](SECURITY.md)。

## 开发与发行

```powershell
npm ci --ignore-scripts
npm test
npm run test:package
```

CI 配置 Windows / Linux 测试，并把真实 npm 包安装到仓库外验证 CLI、Skill、两个项目、人工提交、归档、重启和 MCP。tag 触发检查与 Draft Release；维护者检查公开后，再手动触发 npm 发布。账号、包名和 GitHub 仓库确认前保留 private:true，不会误发布。

推广和插件市场暂缓。开发遵守 [AGENTS.md](AGENTS.md)，发行规则见 [部署与发布](docs/部署与发布.md)。原有 `npm start` 作为独立源码运行方式保留，默认 data/ 和 4317；不要让它与 CLI 服务同时打开同一数据库。
