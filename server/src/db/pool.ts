import pg from "pg";

// NUMERIC (amount) comes back as a string by default; the engine wants numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 20 });
}
