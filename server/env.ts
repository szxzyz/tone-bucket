import { existsSync, readFileSync } from 'fs';

// Load .env before any database/auth modules are evaluated. ESM evaluates
// imported modules before the importing module's body, so keeping this logic
// in index.ts alone is too late for modules such as db.ts.
if (existsSync('.env')) {
  try {
    const envContents = readFileSync('.env', 'utf8');
    for (const line of envContents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch (error) {
    console.warn('⚠️ Could not parse .env file:', error);
  }
}
