import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, defaultDbPath } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(defaultDbPath());
const store = new SessionStore();
const app = express();

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const STALE_SESSION_MS = 2 * 60 * 1000;
setInterval(() => store.sweepStaleSessions(STALE_SESSION_MS), 30_000).unref();

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll ouvindo em http://localhost:${port}`);
});
