export interface WorkspaceTeam {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface TeamSummary extends WorkspaceTeam {
  memberCount: number;
  contestCount: number;
}

export interface Contest {
  id: string;
  name: string;
  createdAt: number;
}

export interface ContestSummary extends Contest {
  printCount: number;
}

export type WorkspaceData =
  | { scope: "user"; teams: TeamSummary[]; selectedTeamId: string | null }
  | { scope: "team"; team: WorkspaceTeam; contests: ContestSummary[] }
  | { scope: "team-settings"; team: WorkspaceTeam; invitationUrl: string }
  | { scope: "contest"; team: WorkspaceTeam; contest: Contest };
