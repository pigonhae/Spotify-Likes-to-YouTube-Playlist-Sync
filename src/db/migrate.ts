import fs from "node:fs/promises";
import path from "node:path";

import type { QueryClientLike } from "./client.js";

interface MigrationClient extends QueryClientLike {
  connect?: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    release: () => void;
  }>;
}

export async function runMigrations(pool: MigrationClient, migrationsDir: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS __app_migrations (
      name TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);

  const appliedResult = await pool.query("SELECT name FROM __app_migrations ORDER BY name");
  const applied = new Set(
    (appliedResult.rows ?? []).map((row) => String((row as { name: string }).name)),
  );

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    if (!pool.connect) {
      throw new Error("Migrations require a connect-capable database client");
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO __app_migrations (name, applied_at) VALUES ($1, $2)", [
        file,
        Date.now(),
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
