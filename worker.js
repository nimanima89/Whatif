import { handleAsNodeRequest } from 'cloudflare:node';
import { setDatabaseFactory } from './db.js';
import { createD1Database } from './db-d1.js';
import { app, configureAppRuntime } from './app.js';

const port = 3000;
app.listen(port);
configureAppRuntime({ backgroundTasks: false, secureCookies: true });

export default {
  fetch(request, env) {
    setDatabaseFactory(() => createD1Database(env.DB));
    return handleAsNodeRequest(port, request);
  },
};
