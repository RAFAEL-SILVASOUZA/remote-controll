import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, defaultDbPath } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { createPairingRouter } from './web/pairingRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(defaultDbPath());
const store = new SessionStore();
const app = express();
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5002';

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createPairingRouter(db, publicBaseUrl));
app.use('/mcp', createMcpRouter(store, db));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
