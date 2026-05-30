# Setup Guide

## Requirements

- **Node.js 22 LTS** (required, see `.nvmrc`)
- npm 10+
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (for `better-sqlite3` native compile)
- **Ollama** (optional, for `npm run ask`)
- **Git** (optional, for `git:status` / terminal git tools)

## First-time Windows setup

1. Install **Node.js 22 LTS** from [nodejs.org](https://nodejs.org/) or via nvm-windows:

```powershell
nvm install 22
nvm use 22
node -v   # should show v22.x
```

2. Clone/open the project and install dependencies:

```powershell
cd C:\Path\To\RiSoCa-AI-Agent
npm run setup
```

3. Run the health check:

```powershell
npm run doctor
npm run doctor -- --verbose
```

4. (Optional) Install Ollama for local AI ask:

```powershell
# Install Ollama for Windows from https://ollama.com
# In a second PowerShell window:
ollama serve
ollama pull qwen2.5-coder:7b
```

5. Verify the toolchain:

```powershell
npm run check
npm run scan -- .
```

## Quick setup

```bash
npm run setup
npm run doctor
```

## Native module ABI errors

If you see:

```
NODE_MODULE_VERSION mismatch
```

**Root cause:** Node.js was upgraded/downgraded after `better-sqlite3` was compiled.

**Fix:**

```powershell
npm run rebuild:native
```

Or reinstall:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

Always rebuild after switching Node major versions.

## Ollama setup (ask command)

Ollama must run in a **separate terminal** while you use `npm run ask`.

```powershell
# Terminal 1 — keep running
ollama serve

# Terminal 2 — project commands
ollama pull qwen2.5-coder:7b
npm run ask -- . "What does this project do?"
```

Configure model/provider in `config/default.json`:

```json
{
  "ai": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "fallbackModel": "qwen2.5-coder:3b"
  }
}
```

### Common Ollama errors

| Symptom | Fix |
|---------|-----|
| `Ollama is not running` | Start a second PowerShell and run: `ollama serve` |
| Model not installed | `ollama pull qwen2.5-coder:7b` (or your configured model) |
| Slow first response on CPU | Use `qwen2.5-coder:3b` in config for faster asks |

## Safe approval workflow

File edits, deletes, and terminal commands create **pending operations**. Nothing runs until you approve.

### Example: pending file write

```powershell
npm run write -- . "notes.txt" "hello"
# prints operation ID and:
#   npm run approve -- "<operationId>"
npm run approve -- "<operationId>"
```

### Example: pending terminal command

```powershell
npm run cmd -- . "npm test"
npm run pending
npm run approve -- "<operationId>"
```

### Example: read-only git (no approval)

```powershell
npm run git:status -- .
npm run git:diff -- .
```

### Reject an operation

```powershell
npm run reject -- "<operationId>"
```

## Shortcut commands

| Command | Purpose |
|---------|---------|
| `npm run doctor` | Local runtime health check |
| `npm run check` | preflight + test + build |
| `npm run pending` | List pending file + command ops |
| `npm run local:status` | Git status + pending ops |
| `npm run local:ask` | Ask default project question |

## Verify installation

```powershell
npm run doctor
npm test
npm run build
npm run scan -- .
npm run analyze -- .
```

## Troubleshooting

- **`better-sqlite3` / SQLite errors on startup** → run `npm run rebuild:native` (see `npm run doctor -- --verbose` for Node ABI vs module ABI)
- **`doctor` shows SQLite FAIL** → `npm run rebuild:native`
- **`doctor` shows Ollama FAIL** → start `ollama serve` in another terminal
- **`git:status` fails** → install Git for Windows or run `git init` in the project
- **Pending operation stuck** → `npm run pending` then `approve` or `reject`

Configure AI settings in `config/default.json`.
