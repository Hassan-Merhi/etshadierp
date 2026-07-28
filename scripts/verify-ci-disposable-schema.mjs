import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for disposable schema verification");
}

const client = new pg.Client({ connectionString, ssl: false });
await client.connect();

try {
  const result = await client.query(
    "select current_database() as database, count(*)::int as tables from information_schema.tables where table_schema = 'public'",
  );
  const summary = result.rows[0];
  console.log(summary);
  if (!summary || summary.tables < 1) {
    throw new Error("Disposable schema contains no public tables");
  }
} finally {
  await client.end();
}
