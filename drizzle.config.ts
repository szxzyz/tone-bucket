import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set - database operations may fail");
}

// Keep SSL handling scoped to Drizzle's PostgreSQL client. Render/Neon-style
// managed databases can present a self-signed intermediate certificate, while
// local databases can use a plain connection. Do not disable TLS globally.
function normalizeDatabaseUrl(value: string): { connectionString: string; sslDisabled: boolean } {
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

const rawDatabaseUrl = process.env.DATABASE_URL || '';
const { connectionString, sslDisabled } = normalizeDatabaseUrl(rawDatabaseUrl);
const ssl = sslDisabled
  ? false
  : (rawDatabaseUrl.includes('neon.tech') || rawDatabaseUrl.includes('render.com') || process.env.NODE_ENV === 'production')
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
