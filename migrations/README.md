# Database Migrations

This directory contains SQL migration files for the message service database.

## Running Migrations

To run a migration, connect to your PostgreSQL database and execute the SQL file:

```bash
psql -U your_username -d weapon-marketplace -f migrations/001_create_read_messages_table.sql
```

Or using the DATABASE_URL environment variable:

```bash
psql $DATABASE_URL -f migrations/001_create_read_messages_table.sql
```

## Migration Files

- `001_create_read_messages_table.sql` - Creates the `chat.read_messages` table to track which messages have been read by which users

## Creating New Migrations

1. Create a new SQL file with a sequential number prefix (e.g., `002_description.sql`)
2. Include clear comments describing what the migration does
3. Use `IF NOT EXISTS` clauses to make migrations idempotent where possible
4. Update this README with information about the new migration

