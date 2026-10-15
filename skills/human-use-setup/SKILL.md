---
name: human-use-setup
description: Introduce, initialize, or configure Human Use in the current project when the user asks to enable human work orders, including “引入 Human Use” or “给当前项目接入 Human Use”. Also use for project service status, startup, stopping, and optional MCP or hook setup. Does not publish packages or initialize unrelated projects.
---

# Introduce Human Use into a project

The software is installed once; each project keeps private work orders and evidence in its own `.human-use/` directory. Use the bundled CLI wrapper with Node.js 24+. It points to the installed program and does not depend on the shell PATH:

```sh
node <this-skill-directory>/scripts/cli.mjs init --project <current-project-root> --client codex
```

Use the project directory supplied by the user or the active coding workspace. If they are working in a subdirectory, identify the intended project root before initializing. An ordinary folder works; Git is optional. Worktree sharing is outside this version's scope.

## Sandbox permissions

Even though Human Use stays local, CLI commands contact a loopback HTTP service and may launch a background process. A restricted agent sandbox can block these operations, including `status` and API reads. If the host already reports that local networking or process launch requires approval, request its normal execution permission for the specific CLI command before running it; installation does not grant that permission.

If a command reports `fetch failed`, especially with `connect EACCES` or `EPERM` on `127.0.0.1`, suspect a sandbox restriction rather than a stopped service. When the host supports escalation, retry the same command once through its approval mechanism (in Codex, `exec_command` with `sandbox_permissions: "require_escalated"` and a reason explaining access to the project's local Human Use service). Do not repeatedly initialize, restart a healthy service, delete runtime files, change ports, or disable the sandbox to fix a permission denial. A bare `fetch failed` can have other causes; if the approved retry still fails, inspect `service.log` and report the actual error. If permission is unavailable or denied, report the restriction and stop retrying.

For later API calls and hooks, local networking permissions still apply. A successful install or browser page does not prove the agent or hook can reach the service. Never claim hooks are working based only on generated configuration. See [Codex permissions](https://learn.chatgpt.com/docs/agent-approvals-security).

## Initialize the project

The CLI creates `human-use.json`, merges a small managed section into AGENTS.md and ignore rules, generates project-local Codex hooks, starts or reuses the background service, and opens the browser. Existing work orders and unrelated configuration are preserved. Do not manually reconstruct these steps or copy the application into the project. If the user asks only for initialization without opening a browser, pass `--no-open`; hooks can be omitted with `--no-hooks`.

Report the project, data directory, service URL and any integration notice from the JSON result. Do not print the API token. A browser-launch failure does not undo initialization; use `status` and share the URL. If startup fails, inspect the reported service.log and resolve that error rather than repeatedly initializing.

Skill + API is ready independently of MCP. Codex must review/trust generated hooks before running them; it may need a new session. Do not bypass host trust or claim hooks are active merely because files exist. Add MCP only if requested:

```sh
node <this-skill-directory>/scripts/cli.mjs integrate codex --mcp --project <project-root>
```

Use `status`, `start`, `stop` and `open` with the same `--project` argument for lifecycle requests. Initialization is repeatable and reuses existing data. Migrating old data requires an explicit source directory and a stopped source service; use `migrate --from <source> --project <destination>` before initializing an empty destination. Never overwrite an existing project database.

Software upgrades do not delete project data. Stop active project services before updating the npm package, rerun `human-use setup codex` to refresh these wrappers, then start the projects. Do not publish packages, configure a global MCP server, or register an OS startup service as part of project initialization.
