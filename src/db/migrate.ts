import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

export function runMigrations(sqlite: Database.Database, migrationsDir: string) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __app_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT name FROM __app_migrations ORDER BY name")
      .all()
      .map((row) => String((row as { name: string }).name)),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    sqlite.exec("BEGIN");

    try {
      sqlite.exec(sql);
      sqlite
        .prepare("INSERT INTO __app_migrations (name, applied_at) VALUES (?, ?)")
        .run(file, Date.now());
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
