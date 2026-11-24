CREATE TABLE team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invitationToken TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL
);

CREATE TABLE team_member (
  teamId TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (teamId, userId)
);

CREATE INDEX team_member_user_idx ON team_member(userId, teamId);

CREATE TABLE team_selection (
  userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  teamId TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE contest (
  id TEXT PRIMARY KEY,
  teamId TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX contest_team_created_idx ON contest(teamId, createdAt DESC);
