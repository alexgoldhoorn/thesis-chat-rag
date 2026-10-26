import { Pool } from "pg";

// Read-only role: it can only SELECT documents and call match_documents (db/init.sh).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  statement_timeout: 10_000,
});
