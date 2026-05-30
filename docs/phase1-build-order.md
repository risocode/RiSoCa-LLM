# Phase 1 Build Order

- [x] Step 1: Initialize TypeScript project
- [x] Step 2: Create CLI entry
- [x] Step 3: Implement project scanner
- [x] Step 4: Implement ignore rules
- [x] Step 5: Implement file indexer
- [x] Step 6: Implement dependency graph + symbol indexer + project map
- [x] Step 7: Implement SQLite schema
- [x] Step 8: Save scan results to database
- [x] Step 9: Generate project-map.json
- [x] Step 10: Wire `npm run scan`

## Verify

```bash
npm install
npm test
npm run scan -- "tests/fixtures/minimal-project"
npm run analyze -- "tests/fixtures/minimal-project"
```

## Success criteria

1. Scan runs without errors
2. `data/risoca.db` contains project data
3. `data/project-map.json` is valid JSON
4. Console prints health and complexity scores
5. Tests pass
6. Target project files are not modified
