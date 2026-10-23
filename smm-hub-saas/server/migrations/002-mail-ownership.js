function up(db) {
  const columns = db
    .prepare('PRAGMA table_info(job_queue)')
    .all()
    .map((column) => column.name);
  if (!columns.includes('subject_user_id'))
    db.exec(
      'ALTER TABLE job_queue ADD COLUMN subject_user_id INTEGER REFERENCES users(id)'
    );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_jobs_subject ON job_queue(subject_user_id,name,status)'
  );
}
module.exports = { up };
