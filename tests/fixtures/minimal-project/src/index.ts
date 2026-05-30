import express from 'express';
import { helper } from './utils/helper.js';

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, value: helper() });
});

export default app;
