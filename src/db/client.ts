import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(databasePath: string) {
  const resolvedPath = databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
