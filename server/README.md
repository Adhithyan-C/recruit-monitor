# RecruitMonitor — Server

Node.js + Express + Socket.IO + PostgreSQL (Supabase) backend.

## Development

```bash
# Copy and fill in all required variables
cp .env.example .env

# Install dependencies
npm install

# Start dev server (auto-reloads on file change)
npm run dev        # http://localhost:4000

# Type-check without emitting
npm run typecheck

# Lint
npm run lint

# Production build
npm run build      # compiles src/ → dist/
npm start          # runs dist/server.js
```

## Running migrations

Migrations live in `/migrations/*.sql` and are applied in filename order (alphabetical = chronological).

### Connection string

> **Important**: always use the **direct** (non-pooled) connection string for migrations.
> The pooler (PgBouncer in transaction mode) doesn't support multi-statement DDL and
> will fail on `CREATE TYPE`, `CREATE TABLE`, and other DDL statements.

Find the direct string in:
**Supabase Dashboard → Settings → Database → Connection String → URI**
(Toggle off "Supabase Pooler" / select the "Direct connection" tab.)

```bash
# Set DATABASE_URL in .env (or export it inline)
export DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

# Run all pending migrations
npm run migrate
```

The runner creates a `schema_migrations` table on first run and skips already-applied files.
On failure it rolls back the failing migration and exits non-zero.

### Adding a new migration

Create `migrations/NNNN_description.sql`. Use a 4-digit prefix so ordering is preserved.
Never modify an already-applied migration; add a new one instead.

## Environment variables

See `.env.example` for the full list with descriptions.

Required variables that have no defaults:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → Direct connection URI |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `AGORA_APP_ID` | Agora Console → Project |
| `AGORA_APP_CERTIFICATE` | Agora Console → Project → Security → App Certificate |
| `DEEPGRAM_API_KEY` | Deepgram Console → API Keys |
| `CLIENT_ORIGIN` | Comma-separated list, e.g. `http://localhost:5173` |

## Architecture notes

This server is designed to run as a **single Node.js instance**. Scaling to multiple instances
would require:

1. A Socket.IO adapter (Redis or Postgres-based) to share events across instances.
2. Redis-backed replacements for the in-memory rate limiters and `JobScheduler`.
3. Distributed locking for the claim operation (currently uses Postgres `UPDATE … WHERE` atomicity).

The service interfaces (`PresenceService`, `ClaimService`, `JobScheduler`) are designed so that
Redis implementations can be swapped in without touching callers.
