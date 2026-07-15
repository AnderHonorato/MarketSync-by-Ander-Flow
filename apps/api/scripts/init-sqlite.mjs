import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), process.argv[2] ?? 'prisma/dev.db');
if (process.argv.includes('--reset') && existsSync(target)) rmSync(target);
const database = new DatabaseSync(target);
database.exec('PRAGMA foreign_keys = ON;');
database.exec('CREATE TABLE IF NOT EXISTS "_LocalMigration" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);');
const applied = database.prepare('SELECT "name" FROM "_LocalMigration"').all().map((row) => row.name);
const hasExistingSchema = Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Session'").get());
if (hasExistingSchema && !applied.includes('20260712000000_init')) {
  database.prepare('INSERT INTO "_LocalMigration" ("name") VALUES (?)').run('20260712000000_init');
  applied.push('20260712000000_init');
}
const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
for (const name of readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
  if (applied.includes(name)) continue;
  const sqlPath = resolve(migrationRoot, name, 'migration.sql');
  if (!existsSync(sqlPath)) continue;
  database.exec('BEGIN;');
  try {
    database.exec(readFileSync(sqlPath, 'utf8'));
    database.prepare('INSERT INTO "_LocalMigration" ("name") VALUES (?)').run(name);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    if (error?.code === 'ERR_SQLITE_ERROR' && /already exists/i.test(error?.message ?? '')) {
      database.prepare('INSERT INTO "_LocalMigration" ("name") VALUES (?)').run(name);
      continue;
    }
    throw error;
  }
}
database.close();
console.log(`SQLite inicializado em ${target}`);
