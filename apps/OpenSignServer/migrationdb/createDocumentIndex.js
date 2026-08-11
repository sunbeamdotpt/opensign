import { runWithDatabase, migrationExists, recordMigration } from './utils.js';

const MIGRATION_NAME = 'documentIndex_1';

export default async function createDocumentIndex() {
  await runWithDatabase(async ctx => {
    if (await migrationExists(MIGRATION_NAME, ctx)) {
      console.log(' INFO  The completed report index for contracts_document is already present.');
      return;
    }

    if (ctx.type === 'mongodb') {
      const docCollection = ctx.db.collection('contracts_Document');
      await docCollection.createIndex(
        { _p_CreatedBy: 1, _updated_at: -1 },
        {
          name: 'idx_docs_by_creator_recent_completed',
          partialFilterExpression: { IsCompleted: true },
        }
      );
      await docCollection.createIndex(
        { Signers: 1, _updated_at: -1 },
        {
          name: 'idx_docs_by_signer_recent_completed',
          partialFilterExpression: { IsCompleted: true },
        }
      );
    } else {
      await ctx.client.query(`
        CREATE INDEX IF NOT EXISTS "idx_docs_by_creator_recent_completed"
        ON "contracts_Document" ("CreatedBy", "updatedAt")
        WHERE "IsCompleted" = true
      `);
      await ctx.client.query(`
        CREATE INDEX IF NOT EXISTS "idx_docs_by_signer_recent_completed"
        ON "contracts_Document" USING GIN ("Signers")
        WHERE "IsCompleted" = true
      `);
    }

    await recordMigration(
      MIGRATION_NAME,
      'Created completed report indexes on contracts_Document',
      ctx
    );
    console.log(' SUCCESS  The completed report index for contracts_document is created.');
  });
}
