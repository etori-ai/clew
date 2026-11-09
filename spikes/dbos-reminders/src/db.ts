/**
 * The spike's "application database": one Postgres database that holds both Clew's side (timer intents, firing
 * attempts) and DBOS's system tables (schema `dbos`). That is the configuration under test: it is what makes
 * `dbos.enqueue_workflow` and `dbos.send_message` callable inside the same transaction as the ledger write.
 */
import pg from 'pg';

export const SPIKE_DATABASE = 'clew_dbos_spike';

export function databaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set (run inside the devcontainer)');
  const url = new URL(base);
  url.pathname = `/${SPIKE_DATABASE}`;
  return url.toString();
}

export const pool = new pg.Pool({ connectionString: databaseUrl(), max: 5 });

export async function migrate(): Promise<void> {
  await pool.query(`
    create table if not exists timer_intent (
      id text primary key,
      generation integer not null,
      due_at timestamptz not null,
      state text not null check (state in ('active', 'cancelled')),
      variant text not null default 'recv',
      fired_at timestamptz,
      fired_by text,
      updated_at timestamptz not null default now()
    );
    create table if not exists timer_attempt (
      seq bigserial primary key,
      id text not null,
      generation integer not null,
      executor text not null,
      outcome text not null,
      at timestamptz not null default now()
    );
  `);
}

export async function resetTables(): Promise<void> {
  await pool.query('truncate timer_intent, timer_attempt');
}
