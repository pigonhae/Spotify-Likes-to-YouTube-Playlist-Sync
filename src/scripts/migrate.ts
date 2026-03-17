import { getConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

const config = getConfig();
const database = createDatabase(config.DATABASE_PATH);
runMigrations(database.sqlite, "drizzle");

console.log(`Migrations applied to ${config.DATABASE_PATH}`);
