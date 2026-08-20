import sqlite3 from 'sqlite3';
import path from 'node:path';
import { initSchema } from './db.js';

export function createNodeDatabase(databasePath = process.env.DATABASE_PATH || path.resolve('data.db')) {
  return new Promise((resolve, reject) => {
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
  });
}
