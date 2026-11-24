CREATE TABLE github_choice (
  id TEXT PRIMARY KEY,
  githubId TEXT NOT NULL,
  login TEXT NOT NULL,
  verifiedEmail TEXT,
  newUserId TEXT NOT NULL,
  returnPath TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX github_choice_expiry ON github_choice(expiresAt);
