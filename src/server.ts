import express from 'express';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';

const store = new SessionStore();
const app = express();

app.use('/mcp', createMcpRouter(store));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
