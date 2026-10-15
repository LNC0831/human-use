# Contributing to Human Use

Bug reports, concrete feature proposals, documentation improvements, and focused
pull requests are welcome. Issues and pull requests may be written in English or Chinese.

## Development

Use Node.js 24 or newer. The core server and Skill use built-in modules; MCP uses
the official SDK and Zod. There is no build step. From the repository root:

```sh
npm ci --ignore-scripts
npm start
npm test
```

Run these commands separately: the first keeps the local service running;
the second runs the test suite. Stop the server with Ctrl+C.

Read [AGENTS.md](AGENTS.md) before changing code. Keep the implementation direct,
limit changes to the stated problem, and run checks appropriate to the change.
For UI changes, check the actual interaction in a browser. For API changes,
update [docs/API.md](docs/API.md).

Use synthetic work orders and a separate WORKORDER_DATA_DIR for manual testing.
Keep custom data directories outside the checkout. Do not commit API tokens,
SQLite files, work-order packages, or personal evidence.

## Pull requests

Describe the problem, the resulting behavior, and how you checked it. Preserve
the archive format and hash rules unless a format change is an explicit part
of the proposal. Discuss substantial protocol or persistence changes in an issue first.

The repository uses LF line endings. Contributions are accepted under the
project's [MIT license](LICENSE).
