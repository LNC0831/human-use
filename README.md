# Human Use

**Turn the step an AI needs a person to perform into a work order with answers, evidence and a verifiable archive.**

[简体中文](README.zh-CN.md) · [Integration guide](docs/接入指南.md) · [API](docs/API.md) · [Deployment and releases](docs/部署与发布.md) · [MIT](LICENSE)

Human Use runs on your computer. An agent creates a request, a person completes
the checklist and supplies answers or files in a browser, and the agent reviews
an explicit submission version and hash. Acceptance freezes a SHA-256-addressed
package containing the evidence and workflow history.

## Install once, introduce it to any project

Requires **Node.js 24+**. The npm release name and publishing account are being
finalized; no registry installation is available yet. To try the current source:

```sh
git clone https://github.com/LNC0831/human-use.git
cd human-use
npm ci --ignore-scripts
npm pack
npm install -g ./human-use-0.3.0.tgz
human-use setup codex
```

`setup codex` installs two user-level skills under `~/.agents/skills/`: setup and
daily human handoffs. It preserves unrelated skills and refuses to replace an
unmanaged skill with the same name. Start a new Codex session if they are not visible.

In a project, ask Codex: **“Introduce Human Use into this project.”**
The setup skill uses the CLI to initialize, start a background service and open
the project's browser page. The equivalent manual command is:

```sh
human-use init --project /absolute/path/to/project
```

Windows paths such as `E:/my-project` work. Add `--no-open` for headless use or
`--no-hooks` for Skill + API only. The default client is Codex; `--client claude`
generates Claude project hooks. Hook files still require client trust/reloading.

## Project data and lifecycle

The program is installed once. Each project has its own `.human-use/` directory,
credential and service instance. Ports are assigned automatically on 127.0.0.1.
Repeated initialization and starts reuse an existing instance and preserve data.

```text
your-project/
  human-use.json          Project configuration
  .human-use/             Private, gitignored local data
    workorders.sqlite
    attachments/
    archives/<sha256>/
    api-token
    runtime.json
    service.log
```

Initialization merges small managed sections into AGENTS.md and .gitignore;
existing text is preserved. Regular folders work without Git. Worktree sharing
is outside this version's scope. Run inside the initialized project or pass
`--project` explicitly:

```sh
human-use status
human-use stop
human-use start
human-use open
```

Closing the browser or AI client does not stop the service. Stop active project
services before upgrading the npm package. After upgrading, run `human-use setup
codex` again and restart the services. Uninstalling the program leaves project
records intact. There is no OS auto-start or in-place hot update.

For old v0.2 data, stop the old service and migrate before initializing an empty
destination: `human-use migrate --from /old/data --project /your/project`.
The source remains intact and archive hashes are preserved; the destination
receives a separate credential. See [deployment details](docs/部署与发布.md).

## Skill + API by default; MCP optional

The installed skill discovers the project's address and credential through the
CLI. Users do not need to fill in token paths or port numbers.

```sh
human-use api POST /api/tickets /path/to/request.json
human-use api GET /api/tickets?status=submitted
human-use api GET /api/tickets/TK-000001
```

An example request is in [examples/ticket.json](examples/ticket.json). Supported
units are checklist, text, number, choice and attachment. Click an attachment
area and press **Ctrl+V** to paste a screenshot, or select files normally.
Uploads are included automatically; use the × in the top-right corner to remove
an attachment. People can delete never-submitted uploads; files referenced by a historical
submission remain available as evidence. A return review can append
`additional_units` for new questions or uploads; each new submission freezes
its own requirements alongside the answers.

MCP uses the same API and exposes 10 tools, including original evidence reading,
versioned review, bounded waits and explicit session bindings:

```sh
human-use integrate codex --mcp
human-use mcp
```

The first command merges project MCP configuration; the second is the stdio
entry used by the client. stdout contains protocol messages only. Claude Code
is also supported by `integrate claude --mcp`. MCP tools never substitute for
human draft editing or submission.

The browser uses SSE for live changes, persistent unread receipts and update
notices that preserve unsaved input. Optional hooks route human events to an
explicitly bound session and display selected AI actions. Idle wakeup depends on
the host: Codex uses a bounded Stop window or next-turn catch-up; Claude's optional
asyncRewake example remains experimental. See the [integration guide](docs/接入指南.md).

## Evidence and archives

People can save drafts, report blockers and resume. Every submission is a
snapshot. Returning work preserves that snapshot and allows another submission.
Agents must inspect the actual answers and relevant original files, then review
the latest version with its exact hash and a reason.

Accepted packages contain ticket.json, submissions/*.json, original attachments,
reviews.json, events.json and manifest.json. The package ID is the SHA-256 of the
manifest bytes, whose entries list all other file hashes and sizes. ZIP is an
export container, not the input to the package ID. Modified archives fail verification
and cannot be exported through the app. Read receipts and activity notices do not
rewrite frozen evidence.

Data stays local: no cloud storage, external CDN or telemetry. A connected cloud
model may receive evidence it reads. Hashes check content consistency, not physical
actions or personal identity. Files are limited to 20 MiB; PNG, JPEG, WebP and GIF
are previewed, while other files download. See [SECURITY.md](SECURITY.md).

## Development and releases

```sh
npm ci --ignore-scripts
npm test
npm run test:package
```

Tests use Node's built-in runner and the official MCP SDK. The package smoke test
installs the actual `.tgz` outside the checkout and exercises the CLI shim, copied
skills, separate projects, browser submission, archive, restart and MCP.
GitHub Actions runs these checks on Node 24 for Windows and Linux.
Restricted Windows sandboxes may need loopback/process permissions; the skills
explain how to request approval for local CLI access.

Version tags such as `v0.3.0` run CI and prepare a draft GitHub Release with the
npm archive and checksums. npm publication is a separate manual workflow using
the reviewed release asset and configured publishing identity. Publishing remains
disabled until the npm owner and package name are confirmed. Marketplace
distribution and promotion are deferred.

For legacy source-only operation, `npm start` still runs the standalone server on
port 4317 with `WORKORDER_DATA_DIR` / `PORT`; do not point it at a concurrently
running CLI-managed database. Read [AGENTS.md](AGENTS.md),
[CONTRIBUTING.md](CONTRIBUTING.md) and the [release guide](docs/部署与发布.md).

## License

[MIT](LICENSE), copyright 2026 Human Use contributors.
