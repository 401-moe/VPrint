import { env } from "cloudflare:workers";
import worker from "../../src/worker/index";

export const loopbackOrigin = "http://127.0.0.1:8787";

export function request(path: string, init: RequestInit = {}) {
  return new Request(`${loopbackOrigin}${path}`, init);
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export async function signUp(member: { email: string; password: string; name: string }) {
  const response = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify(member),
    }),
    env,
  );

  if (!response.ok) throw new Error(`sign-up failed: ${response.status}`);
  return { response, cookie: cookies(response) };
}

export async function createTeam(cookie: string, name: string) {
  const response = await worker.fetch(
    request("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    }),
    env,
  );
  if (!response.ok) throw new Error(`team creation failed: ${response.status}`);
  return (await response.json()) as { id: string; invitationToken: string };
}

export async function join(cookie: string, token: string) {
  return worker.fetch(request(`/api/team-invitations/${token}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  }), env);
}

export async function workspace(cookie: string, params: Record<string, string> = {}) {
  return worker.fetch(
    request(`/api/workspace?${new URLSearchParams(params)}`, {
      headers: { cookie },
    }),
    env,
  );
}

export async function memberCookie(name: string) {
  const { cookie } = await signUp({
    email: `team-${crypto.randomUUID()}@vprint.example`, password: "correct horse battery staple", name,
  });
  return cookie;
}

export async function createContest(cookie: string, teamId: string, name: string) {
  const response = await worker.fetch(request(`/api/teams/${teamId}/contests`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name }),
  }), env);
  if (response.status !== 201) throw new Error(`contest creation failed: ${response.status}`);
  return await response.json() as { id: string; name: string; createdAt: number };
}
