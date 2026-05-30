# RiSoCa AI Agent

Local-first project intelligence agent. Phase 1 scans, indexes, stores, and reports on any codebase — read-only, no file editing.

## Setup

```bash
npm install
```

## Usage

Scan a project (full pipeline: scan → index → SQLite → project-map.json):

```bash
npm run scan -- "D:\Path\To\Project"
```

Analyze a project (detailed report from DB or fresh scan):

```bash
npm run analyze -- "D:\Path\To\Project"
```

## Outputs

| Path | Description |
|------|-------------|
| `data/risoca.db` | SQLite database with projects, files, symbols, import graph |
| `data/project-map.json` | Human-readable project map from latest scan |

## Development

```bash
npm test
npm run build
```

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/phase1-build-order.md](docs/phase1-build-order.md).
