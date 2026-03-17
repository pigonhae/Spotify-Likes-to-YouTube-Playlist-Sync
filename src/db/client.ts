import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export interface QueryClientLike {
  query: (text: string, params?: unknown[]) => Promise<{
    rows?: unknown[];
    rowCount?: number | null;
  }>;
  end?: () => Promise<void>;
}

export interface AppDatabase {
  pool: QueryClientLike;
  db: any;
  close: () => Promise<void>;
}

export function createDatabase(input: {
  connectionString: string;
  ssl?: boolean;
  max?: number;
  PoolClass?: typeof Pool;
}): AppDatabase {
  const PoolClass = input.PoolClass ?? Pool;
  const pool = new PoolClass({
    connectionString: input.connectionString,
    max: input.max,
    ssl: input.ssl ? { rejectUnauthorized: false } : undefined,
  }) as unknown as Pool;

  const db = drizzle(pool as never, { schema });

  return {
    pool,
    db,
    close: async () => {
      await pool.end();
    },
  };
}
