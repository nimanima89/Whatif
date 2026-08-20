import path from 'node:path';
import { initSchema } from './db.js';

export function createNodeDatabase(databasePath = process.env.DATABASE_PATH || path.resolve('data.db')) {
  return new Promise(async (resolve, reject) => {
    try {
      // Try built-in node:sqlite first (Node 22+)
      try {
        const { DatabaseSync } = await import('node:sqlite');
        const syncDb = new DatabaseSync(databasePath);
        const db = {
          dbRun(sql, params = []) {
            return new Promise((res, rej) => {
              try {
                const stmt = syncDb.prepare(sql);
                const info = stmt.run(...params);
                res(info);
              } catch (err) {
                rej(err);
              }
            });
          },
          dbGet(sql, params = []) {
            return new Promise((res, rej) => {
              try {
                const stmt = syncDb.prepare(sql);
                const row = stmt.get(...params);
                res(row);
              } catch (err) {
                rej(err);
              }
            });
          },
          dbAll(sql, params = []) {
            return new Promise((res, rej) => {
              try {
                const stmt = syncDb.prepare(sql);
                const rows = stmt.all(...params);
                res(rows);
              } catch (err) {
                rej(err);
              }
            });
          },
          dbExec(sql) {
            return new Promise((res, rej) => {
              try {
                syncDb.exec(sql);
                res();
              } catch (err) {
                rej(err);
              }
            });
          }
        };

        await initSchema(db);
        return resolve(db);
      } catch (nodeSqliteErr) {
        // Fallback to sqlite3 if node:sqlite fails
        const sqlite3 = (await import('sqlite3')).default;
        const sqlite = sqlite3.verbose();
        const db = new sqlite.Database(databasePath, async (error) => {
          if (error) return reject(error);

          db.dbRun = (sql, params = []) => new Promise((res, rej) => {
            db.run(sql, params, function(err){ if(err) rej(err); else res(this); });
          });
          db.dbGet = (sql, params = []) => new Promise((res, rej) => {
            db.get(sql, params, (err, row) => err ? rej(err) : res(row));
          });
          db.dbAll = (sql, params = []) => new Promise((res, rej) => {
            db.all(sql, params, (err, rows) => err ? rej(err) : res(rows));
          });
          db.dbExec = (sql) => new Promise((res, rej) => {
            db.exec(sql, (err) => err ? rej(err) : res());
          });

          try {
            await initSchema(db);
            resolve(db);
          } catch (schemaError) {
            reject(schemaError);
          }
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}
