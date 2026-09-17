import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set - database operations may fail");
}

// Keep SSL handling scoped to Drizzle's PostgreSQL client. Render/Neon-style
// managed databases can present a self-signed intermediate certificate, while
// local databases can use a plain connection. Do not disable TLS globally.
function normalizeDatabaseUrl(value: string): { connectionString: string; sslDisabled: boolean; isLocal: boolean } {
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    // A remote Aiven/Render database must use TLS even if an old connection
    // string contains sslmode=disable. Only local PostgreSQL may be plaintext.
    const sslDisabled = sslMode === 'disable' && isLocal;
    url.searchParams.delete('sslmode');
    url.searchParams.delete('sslcert');
    url.searchParams.delete('sslkey');
    url.searchParams.delete('sslrootcert');
    return { connectionString: url.toString(), sslDisabled, isLocal };
  } catch {
    return { connectionString: value, sslDisabled: value.includes('sslmode=disable') && !process.env.NODE_ENV?.includes('production'), isLocal: false };
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL || '';
const { connectionString, sslDisabled, isLocal } = normalizeDatabaseUrl(rawDatabaseUrl);
const ssl = sslDisabled
  ? false
  : (!isLocal || rawDatabaseUrl.includes('neon.tech') || rawDatabaseUrl.includes('render.com') || process.env.NODE_ENV === 'production')
    ? { rejectUnauthorized: false }
    : false;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
    ssl,
  },
});
