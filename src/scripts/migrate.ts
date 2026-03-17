import { getConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

const config = getConfig();
const database = createDatabase({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL,
  max: config.DATABASE_POOL_MAX,
});
await runMigrations(database.pool, "drizzle");

console.log("Migrations applied to PostgreSQL");
await database.close();
