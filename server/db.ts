import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";

const rawConnectionString = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error("DATABASE_URL must be set for database connection");
}

// pg's connection-string parser can let sslmode query parameters override the
// explicit ssl object. Strip those parameters so managed Render/Aiven/Neon DBs
// consistently use the scoped policy below instead of strict chain validation.
function normalizeConnectionString(value: string): { connectionString: string; sslDisabled: boolean } {
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    const sslDisabled = sslMode === 'disable';
    url.searchParams.delete('sslmode');
    url.searchParams.delete('sslcert');
    url.searchParams.delete('sslkey');
    url.searchParams.delete('sslrootcert');
    return { connectionString: url.toString(), sslDisabled };
  } catch {
    return { connectionString: value, sslDisabled: value.includes('sslmode=disable') };
  }
}

const { connectionString, sslDisabled } = normalizeConnectionString(rawConnectionString);
// Local PostgreSQL (localhost / 127.0.0.1) does NOT need SSL.
const isLocalDb = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const effectiveSslDisabled = sslDisabled && isLocalDb;

export const pool = new Pool({
  connectionString,
  // Fail fast when the managed database is unavailable instead of holding
  // Telegram/API requests for 10–60 seconds while every auth query waits.
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
  max: Number(process.env.DB_POOL_MAX || 15),
  idleTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ...(isLocalDb || effectiveSslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
});

pool.on('error', (error) => {
  // Prevent idle-client errors from becoming uncaught process errors. The
  // next query will obtain a fresh connection from the pool.
  console.error('⚠️ PostgreSQL pool client error:', error.message);
});

export const db = drizzle(pool as any, { schema });
