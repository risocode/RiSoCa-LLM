# RiSoCa AI Agent — Architecture (Phase 1)

## Overview

Phase 1 is a **read-only project intelligence pipeline**:

```
CLI → pathGuard → scanner → indexer → SQLite + project-map.json → health report
```

## Subsystems

| Module | Path | Role |
|--------|------|------|
| CLI | `src/cli/commands.ts` | `scan` and `analyze` commands |
| Scanner | `src/scanner/` | Stack/framework detection, health scoring |
| Indexer | `src/indexer/` | Files, symbols, imports, project map |
| Memory | `src/memory/` | Persist scans and sessions |
| Database | `src/database/` | SQLite schema and connection |
| Security | `src/security/pathGuard.ts` | Path validation, block `.env` reads |
| Tools | `src/tools/` | Read-only file read and search |

## Data

- `data/risoca.db` — projects, scans, indexed files, symbols, import edges
- `data/project-map.json` — latest unified project map

## Deferred (later phases)

- File editing, terminal, git tools (Phase 3–5)
- AI provider integration (Phase 4)
- Plugins, MCP, multi-agent (Phase 8–9)
- Web dashboard, cloud sync (Phase 10)
