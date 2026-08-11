import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { generateId } from '../Utils.js';

dotenv.config({ quiet: true });

const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/dev';

export function getDatabaseURI() {
  return process.env.DATABASE_URI || process.env.MONGODB_URI || DEFAULT_MONGO_URI;
}

export function getDatabaseType(uri = getDatabaseURI()) {
  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
    return 'mongodb';
  }
  if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
    return 'postgres';
  }
  throw new Error(`Unsupported database URI scheme: ${uri}`);
}

async function withMongoClient(uri, fn) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    return await fn(client.db(), client);
  } finally {
    await client.close();
  }
}

async function withPostgresClient(uri, fn) {
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function runWithDatabase(fn) {
  const uri = getDatabaseURI();
  const type = getDatabaseType(uri);
  if (type === 'mongodb') {
    return withMongoClient(uri, (db, client) => fn({ type, db, client }));
  }
  return withPostgresClient(uri, client => fn({ type, client }));
}

async function ensureMigrationTablePostgres(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "Migrationdb" (
      "objectId" text PRIMARY KEY,
      "name" text UNIQUE,
      "createdAt" timestamptz DEFAULT now(),
      "updatedAt" timestamptz DEFAULT now(),
      "executedAt" timestamptz DEFAULT now(),
      "details" text
    )
  `);
  // If Parse Server auto-created the table first, it will only have the
  // default columns (objectId, createdAt, updatedAt, _rperm, _wperm).
  const columns = ['name', 'executedAt', 'details'];
  for (const column of columns) {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Migrationdb' AND column_name = '${column}'
        ) THEN
          ALTER TABLE "Migrationdb" ADD COLUMN "${column}" text;
        END IF;
      END $$
    `);
  }
  // Ensure the unique constraint on name exists for ON CONFLICT.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'Migrationdb' AND indexname = 'Migrationdb_name_key'
      ) THEN
        ALTER TABLE "Migrationdb" ADD CONSTRAINT "Migrationdb_name_key" UNIQUE ("name");
      END IF;
    END $$
  `);
}

export async function migrationExists(name, ctx) {
  if (ctx.type === 'mongodb') {
    const collection = ctx.db.collection('Migrationdb');
    const existing = await collection.findOne({ name });
    return !!existing;
  }
  await ensureMigrationTablePostgres(ctx.client);
  const result = await ctx.client.query(
    'SELECT 1 FROM "Migrationdb" WHERE "name" = $1 LIMIT 1',
    [name]
  );
  return result.rowCount > 0;
}

export async function recordMigration(name, details, ctx) {
  if (ctx.type === 'mongodb') {
    const collection = ctx.db.collection('Migrationdb');
    await collection.insertOne({
      _id: generateId(10),
      name,
      _created_at: new Date(),
      _updated_at: new Date(),
      executedAt: new Date(),
      details,
    });
    // Keep the original behaviour of registering the Migrationdb schema.
    const schemaCollection = ctx.db.collection('_SCHEMA');
    await schemaCollection.updateOne(
      { _id: 'Migrationdb' },
      {
        $setOnInsert: {
          _id: 'Migrationdb',
          objectId: 'string',
          name: 'string',
          updatedAt: 'date',
          createdAt: 'date',
          executedAt: 'date',
          details: 'string',
        },
      },
      { upsert: true }
    );
    return;
  }
  await ensureMigrationTablePostgres(ctx.client);
  await ctx.client.query(
    `
    INSERT INTO "Migrationdb" ("objectId", "name", "createdAt", "updatedAt", "executedAt", "details")
    VALUES ($1, $2, now(), now(), now(), $3)
    ON CONFLICT ("name") DO NOTHING
    `,
    [generateId(10), name, details]
  );
}

export async function ensurePostgresColumn(client, tableName, columnName, dataType = 'boolean') {
  // DO blocks cannot use parameter binding, so inline the identifiers.
  // These values come from internal migration code, not user input.
  const safeTable = tableName.replace(/"/g, '""');
  const safeColumn = columnName.replace(/"/g, '""');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${safeTable}' AND column_name = '${safeColumn}'
      ) THEN
        ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${dataType};
      END IF;
    END $$;
  `);
}
