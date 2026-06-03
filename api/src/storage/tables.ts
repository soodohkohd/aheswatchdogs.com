import { TableClient, TableServiceClient } from '@azure/data-tables';

/** Returns the Table Storage connection string. Prefers a dedicated
 *  TABLES_CONNECTION_STRING, falling back to AzureWebJobsStorage (which is
 *  `UseDevelopmentStorage=true` under Azurite locally). */
function connectionString(): string {
  const conn = process.env['TABLES_CONNECTION_STRING'] || process.env['AzureWebJobsStorage'];
  if (!conn) {
    throw new Error('No table storage connection string (TABLES_CONNECTION_STRING / AzureWebJobsStorage).');
  }
  return conn;
}

const ensured = new Set<string>();

/** Get a TableClient for a table, creating the table on first use. Table
 *  creation is idempotent and cached per process so we only attempt it once. */
export async function getTable(tableName: string): Promise<TableClient> {
  const conn = connectionString();
  if (!ensured.has(tableName)) {
    const service = TableServiceClient.fromConnectionString(conn);
    await service.createTable(tableName); // no-op if it already exists
    ensured.add(tableName);
  }
  return TableClient.fromConnectionString(conn, tableName);
}
