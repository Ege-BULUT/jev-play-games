// Applies db/schema.sql to the Supabase Postgres. Usage: node --env-file=.env.local scripts/migrate.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = new URL(process.env.POSTGRES_URL_NON_POOLING);
url.searchParams.delete('sslmode'); // pg's sslmode parsing overrides the ssl option below
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await client.end();
console.log('schema applied');
