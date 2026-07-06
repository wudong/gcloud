import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (_sql) return _sql;

  const databaseUrl = process.env.DATABASE_URL;
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
  const dbUser = process.env.DB_USER || 'app-user';
  const dbPass = process.env.DB_PASS || '';
  const dbName = process.env.DB_NAME || 'app-db';

  // Cloud Run with Cloud SQL: connect via Unix socket
  if (instanceConnectionName) {
    _sql = postgres({
      user: dbUser,
      password: dbPass,
      database: dbName,
      host: `/cloudsql/${instanceConnectionName}`,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    return _sql;
  }

  // Fallback: connection string (local dev)
  if (databaseUrl) {
    _sql = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    return _sql;
  }

  throw new Error('DATABASE_URL or INSTANCE_CONNECTION_NAME environment variable is required');
}

export default getSql;
