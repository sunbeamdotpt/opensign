import { runWithDatabase, migrationExists, recordMigration } from './utils.js';

const MIGRATION_NAME = 'normalizedEmailUnique_1';

export default async function createNormalizedEmailUnique() {
  await runWithDatabase(async ctx => {
    if (await migrationExists(MIGRATION_NAME, ctx)) {
      console.log(' INFO  The unique index for normalizedEmail is already present.');
      return;
    }

    if (ctx.type === 'mongodb') {
      const collection = ctx.db.collection('_User');
      await collection.createIndex({ normalizedEmail: 1 }, { unique: true, sparse: true });
    } else {
      await ctx.client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "normalizedEmailUnique_1"
        ON "_User" ("normalizedEmail")
        WHERE "normalizedEmail" IS NOT NULL
      `);
    }

    await recordMigration(
      MIGRATION_NAME,
      'Created unique index on NormalizedEmail',
      ctx
    );
    console.log(' SUCCESS  The unique index for normalizedEmail is created.');
  });
}
