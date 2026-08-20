export function createD1Database(d1) {
  if (!d1) throw new Error('The D1 DB binding is missing');

  return {
    async dbRun(sql, params = []) {
      return d1.prepare(sql).bind(...params).run();
    },
    async dbGet(sql, params = []) {
      return d1.prepare(sql).bind(...params).first();
    },
    async dbAll(sql, params = []) {
      const result = await d1.prepare(sql).bind(...params).all();
      return result.results || [];
    },
    async dbExec(sql) {
      return d1.exec(sql);
    },
  };
}
