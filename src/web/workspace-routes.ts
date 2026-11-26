export const teamRoute = /^\/team\/(?<teamId>[\w-]+)(?:\/(?<settings>settings))?$/;
export const contestRoute = /^\/team\/(?<teamId>[\w-]+)\/contest\/(?<contestId>[\w-]+)(?:\/(?<settings>settings)|\/print\/(?<printId>[\w-]+))?$/;

export function contestPath(teamId: string, contestId: string) {
  return `/team/${teamId}/contest/${contestId}`;
}
