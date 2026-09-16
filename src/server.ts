import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, defaultDbPath } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { createTokenRouter } from './web/tokenRoutes.js';
import { createWebRouter } from './web/routes.js';
import { AgentHub } from './agent/hub.js';
import { attachAgentWsServer } from './agent/wsServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(defaultDbPath());
const hub = new AgentHub();
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
app.use(createTokenRouter(db));
app.use(createWebRouter(hub));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const httpServer = http.createServer(app);
attachAgentWsServer(httpServer, db, hub);

const port = Number(process.env.PORT) || 5002;
httpServer.listen(port, () => {
  console.log(`remote-controll ouvindo em http://localhost:${port}`);
});
