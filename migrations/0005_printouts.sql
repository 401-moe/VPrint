CREATE TABLE printout (
  id TEXT PRIMARY KEY,
  contestId TEXT NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id),
  requestId TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  UNIQUE(userId, contestId, requestId)
);

CREATE INDEX printout_contest_created_idx
  ON printout(contestId, createdAt DESC, id DESC);
