# Migrations

Applied in filename order by `scripts/migrate.py`. See `saas_layer/migrations.py`.

- **0001** is the baseline and lives in Python (`saas_layer/migrations._baseline`),
  because the `init_*` functions it calls *are* the current schema definition.
  Transcribing them into SQL here would create a second definition free to drift
  from the first.
- **0002 onwards** are SQL files in this directory, named `NNNN_description.sql`.

Write forward-only migrations. A migration that has been applied to a deployed
database is history; change the schema with a new file rather than by editing an
old one, because the ledger records that the old one already ran.
