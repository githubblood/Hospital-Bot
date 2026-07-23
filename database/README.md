# Database

`schema.sql` is the full, current schema (Postgres, matching what's live on Supabase). It
includes trigger functions and seed data for the subscription plans.

## Applying it

There is no migration runner in this project. Schema changes so far have been applied by
hand — either by running the relevant `ALTER TABLE` statements directly against the live
database, or by running the whole of `schema.sql` against a fresh instance. `schema.sql`
itself is kept up to date after every such change, so it always reflects the current
live shape of the database, not just the original design.

To set up a fresh database (local Postgres or a new Supabase project), run `schema.sql`
against it directly (e.g. via `psql`, or the Supabase SQL editor), then set `DATABASE_URL`
in `.env` to point at it.

## No migrations/ or seeders/ folder (yet)

This project doesn't have a migration-file convention or seed scripts beyond
`scripts/createPlatformAdmin.js` (a one-off script to create the first platform
super-admin account). If the project grows to the point of needing tracked, incremental
migrations, that would be a genuine new addition — not something this reorganization
invents placeholders for.
