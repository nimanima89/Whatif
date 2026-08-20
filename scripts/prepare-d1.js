#!/usr/bin/env node
/**
 * Pre-deploy bootstrap for the Cloudflare D1 database.
 *
 * Reads wrangler.jsonc and, if the D1 `database_id` is still the all-zeros
 * placeholder, creates the real D1 database with `wrangler d1 create` and
 * writes the real ID back into wrangler.jsonc. Also makes sure
 * `preview_database_id` is a real UUID so remote previews get a D1 binding
 * (previews share the same database).
 *
 * Safe to run repeatedly: once `database_id` is a real UUID it is a no-op,
 * so it can stay in the deploy pipeline forever.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const PLACEHOLDER = /^0{8}(-0{4}){3}-0{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_NAME = 'whatif-production';

function fail(message) {
  console.error(`[prepare-d1] ✗ ${message}`);
  process.exit(1);
}

function findDatabaseId(value) {
  if (value && typeof value === 'object') {
    if (typeof value.database_id === 'string') return value.database_id;
    for (const v of Object.values(value)) {
      const found = findDatabaseId(v);
      if (found) return found;
    }
  }
  return null;
}

function runWrangler(args) {
  return spawnSync('npx', ['--no-install', 'wrangler', ...args], {
    encoding: 'utf8',
    shell: true,
  });
}

let config = readFileSync(CONFIG, 'utf8');

const dbIdMatch = config.match(/"database_id"\s*:\s*"([^"]*)"/);
const previewIdMatch = config.match(/"preview_database_id"\s*:\s*"([^"]*)"/);
const databaseId = dbIdMatch && dbIdMatch[1];
const previewId = previewIdMatch && previewIdMatch[1];

if (!databaseId) fail('Could not find "database_id" in wrangler.jsonc');

let changed = false;
let realId = databaseId;

if (PLACEHOLDER.test(databaseId)) {
  console.log(`[prepare-d1] database_id is still a placeholder — creating D1 database "${DB_NAME}"...`);
  const created = runWrangler(['d1', 'create', DB_NAME, '--json', '--location', 'weur']);
  let output = created.stdout || created.stderr || '';

  let parsed = null;
  try {
    parsed = output ? JSON.parse(output) : null;
  } catch {
    parsed = null;
  }
  realId = parsed ? findDatabaseId(parsed) : null;

  if (!realId) {
    // Maybe it already exists under this name — look it up instead.
    if (/already exists/i.test(output)) {
      console.log('[prepare-d1] database already exists — looking up its ID...');
      const listed = runWrangler(['d1', 'list', '--json']);
      try {
        const rows = JSON.parse(listed.stdout || '[]');
        const existing = rows.find((row) => row.name === DB_NAME || row.database_name === DB_NAME);
        realId = existing && (existing.uuid || existing.database_id);
      } catch {
        realId = null;
      }
    }
    if (!realId) {
      const trimmed = output.trim();
      let hint =
        'If the database already exists, run "wrangler d1 list --json" and paste its id into wrangler.jsonc.';
      if (/not authenticated|wrangler login|please run/i.test(output)) {
        hint = 'You are not logged in to Cloudflare — run "npx wrangler login" first, then retry the deploy.';
      } else if (/^wrangler d1 create|usage:/i.test(trimmed)) {
        hint =
          'Wrangler could not create the database (are you logged in? run "npx wrangler login" first). ' +
          'If you already ran "npm ci", check your network connection.';
      }
      fail(`Could not read database_id from wrangler output:\n${output}\n${hint}`);
    }
  }

  config = config.replace(dbIdMatch[0], `"database_id": "${realId}"`);
  console.log(`[prepare-d1] ✓ D1 database "${DB_NAME}" ready: ${realId}`);
  changed = true;
} else if (!UUID.test(databaseId)) {
  fail(`"database_id" in wrangler.jsonc does not look like a UUID: ${databaseId}`);
}

// Remote previews need a real UUID for the preview binding too — point the
// preview environment at the same database (its migrations run with the
// production ones, so it is always in sync).
const currentIdMatch = config.match(/"database_id"\s*:\s*"([^"]*)"/);
if (!previewId || !UUID.test(previewId)) {
  const previewUuid = currentIdMatch[1];
  if (previewIdMatch) {
    config = config.replace(previewIdMatch[0], `"preview_database_id": "${previewUuid}"`);
  } else {
    config = config.replace(currentIdMatch[0], `${currentIdMatch[0]},\n      "preview_database_id": "${previewUuid}"`);
  }
  console.log(`[prepare-d1] ✓ preview_database_id set to ${previewUuid} (same as production DB)`);
  changed = true;
}

if (changed) writeFileSync(CONFIG, config);
console.log('[prepare-d1] D1 is ready — proceeding with deploy.');
