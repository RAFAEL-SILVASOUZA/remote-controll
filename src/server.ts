import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new SessionStore();
const app = express();

app.use('/mcp', createMcpRouter(store));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
