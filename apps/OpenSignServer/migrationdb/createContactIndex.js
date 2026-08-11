import { runWithDatabase, migrationExists, recordMigration, ensurePostgresColumn } from './utils.js';

const MIGRATION_NAME = 'contactIndex_1';

export default async function createContactIndex() {
  await runWithDatabase(async ctx => {
    if (await migrationExists(MIGRATION_NAME, ctx)) {
      console.log(' INFO  The unique index for contracts_Contactbook is already present.');
      return;
    }

    if (ctx.type === 'mongodb') {
      const collection = ctx.db.collection('contracts_Contactbook');
      const query = {
        IsImported: { $eq: true },
        $or: [{ IsDeleted: false }, { IsDeleted: { $eq: false } }],
      };
      await collection.createIndex(
        { _p_CreatedBy: 1, Email: 1, IsImported: 1 },
        { unique: true, partialFilterExpression: query }
      );
    } else {
      await ensurePostgresColumn(ctx.client, 'contracts_Contactbook', 'IsImported', 'boolean');
      await ctx.client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "contactIndex_1"
        ON "contracts_Contactbook" ("CreatedBy", "Email", "IsImported")
        WHERE "IsImported" = true AND "IsDeleted" = false
      `);
    }

    await recordMigration(
      MIGRATION_NAME,
      'Created unique index on CreatedBy, IsImported, Email',
      ctx
    );
    console.log(' SUCCESS  The unique index for contracts_Contactbook is created.');
  });
}
