import { Pool } from 'pg';
const globalDb = globalThis as unknown as { previewPool?: Pool };
export const db = globalDb.previewPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 15000, connectionTimeoutMillis: 15000 });
if (process.env.NODE_ENV !== 'production') globalDb.previewPool = db;
