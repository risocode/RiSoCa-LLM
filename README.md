# RiSoCa AI Agent

Local-first project intelligence agent. Scans, indexes, stores, and reports on any codebase.

## Setup

**Requires Node.js 22 LTS** — see [docs/setup.md](docs/setup.md).

```powershell
npm run setup
npm run doctor
```

If you see a `NODE_MODULE_VERSION` error after changing Node versions:

```powershell
npm run rebuild:native
```

## Usage

```powershell
npm run scan -- "D:\Path\To\Project"
npm run analyze -- "D:\Path\To\Project"
npm run ask -- . "What does this project do?"
```

## Safe workflows

All file changes and terminal commands require approval:

```powershell
npm run write -- . "src/example.ts" "export const x = 1;"
npm run approve -- "<operationId>"

npm run cmd -- . "npm test"
npm run pending
npm run approve -- "<operationId>"
```

Read-only git (no approval):

```powershell
npm run git:status -- .
npm run git:diff -- .
```

## Shortcut commands

```powershell
npm run doctor        # health check (Node, SQLite, Ollama, git)
npm run check         # preflight + test + build
npm run pending       # list pending file + command operations
npm run local:status  # git status + pending ops
npm run local:ask     # ask with default question
```

## Ollama (local AI)

Keep Ollama running in a **second PowerShell window**:

```powershell
ollama serve
ollama pull qwen2.5-coder:7b
npm run ask -- . "What does this project do?"
```

If ask fails, run `npm run doctor` for fix instructions.

## Outputs

| Path | Description |
|------|-------------|
| `data/risoca.db` | SQLite database with projects, files, symbols, import graph |
| `data/project-map.json` | Human-readable project map from latest scan |
| `data/audit.log.jsonl` | Audit log for approved operations |

## Development

```powershell
npm run check
```

See [docs/setup.md](docs/setup.md) for Windows setup, common errors, and approval examples.

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/phase1-build-order.md](docs/phase1-build-order.md).

| Languages | Framework |
| ---------- | -------- |
| JSON, JavaScript, Markdown, Other, TypeScript | none |

# Risks
- 1 file(s) exceed 500 lines
- No CI/CD pipeline detected
- 1 circular import chain(s) detected
- 2 unresolved import(s)
- 3 orphan file(s) with no graph connections