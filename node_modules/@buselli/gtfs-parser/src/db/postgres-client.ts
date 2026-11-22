/**
 * Thin wrapper around the `postgres` driver for the gtfs-parser's PostGIS writes.
 * Exported as a factory so tests can inject a fake connection string.
 */
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export function createSql(connectionString: string): Sql {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}
