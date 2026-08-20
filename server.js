import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDatabaseFactory } from './db.js';
import { createNodeDatabase } from './db-node.js';
import { app, configureAppRuntime, seed } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

setDatabaseFactory(() => createNodeDatabase());
configureAppRuntime({
  backgroundTasks: process.env.DISABLE_BOTS !== 'true',
  secureCookies: process.env.NODE_ENV === 'production',
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

await seed();
app.listen(port, '0.0.0.0', () => console.log(`What If server listening on ${port}`));
