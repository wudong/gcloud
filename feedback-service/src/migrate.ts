import getSql from './db';

export async function migrate() {
  console.log('Running feedback service migrations...');
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id           VARCHAR(100) NOT NULL DEFAULT 'default',
      name             VARCHAR(255),
      email            VARCHAR(255),
      message_type     VARCHAR(50) NOT NULL DEFAULT 'general',
      message          TEXT NOT NULL,
      page_path        VARCHAR(500),
      page_title       VARCHAR(200),
      metadata         JSONB DEFAULT '{}',
      status           VARCHAR(30) NOT NULL DEFAULT 'new',
      github_issue_url VARCHAR(500),
      created_at       TIMESTAMP NOT NULL DEFAULT now(),
      updated_at       TIMESTAMP NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feedback_attachments (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feedback_id  UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
      filename     VARCHAR(255) NOT NULL,
      mime_type    VARCHAR(100) NOT NULL,
      size_bytes   INTEGER NOT NULL,
      content      BYTEA NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT now()
    )
  `;

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_app_id ON feedback(app_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_attachments_fid ON feedback_attachments(feedback_id)`;

  console.log('Migrations complete.');
}
