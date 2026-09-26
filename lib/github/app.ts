import { randomUUID } from "node:crypto";

/**
 * Signing in with GitHub, through the RepoBoard GitHub App and GitHub's
 * device flow: RepoBoard asks GitHub for a short code, the person enters it
 * on github.com and approves, and RepoBoard receives a token for exactly the
 * repositories the app is installed on and the person may open — including
 * ones where they are only a collaborator, which fine-grained keys cannot
 * reach. No secret is needed: the app's client id is public, and the app is
 * set not to expire its tokens.
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token
 */

/** The published RepoBoard app. Empty until it is registered; the environment can set another. */
const BUILT_IN = { clientId: "", slug: "" };

export function githubApp(): { clientId: string; slug: string } | null {
  const clientId = process.env.REPOBOARD_GITHUB_APP_CLIENT_ID || BUILT_IN.clientId;
  const slug = process.env.REPOBOARD_GITHUB_APP_SLUG || BUILT_IN.slug;
  return clientId ? { clientId, slug } : null;
}

/** github.com itself (not the API) — the fake GitHub stands in for both in the demo. */
const LOGIN = () => process.env.GITHUB_LOGIN_URL || "https://github.com";

/** Where a person installs the app on more repositories. */
export function installUrl(): string | null {
  const app = githubApp();
  if (!app?.slug) return null;
  return `${LOGIN()}/apps/${app.slug}/installations/new`;
}

interface Flow {
  deviceCode: string;
  interval: number;
  expiresAt: number;
  nextPollAt: number;
}

// Flows in progress, by an id the page holds; the device code stays here.
const flows = new Map<string, Flow>();

async function post(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${LOGIN()}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error("GitHub could not be reached. Check the internet connection.");
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !data.error) throw new Error(`GitHub answered with an error (${res.status}).`);
  return data;
}

export async function startSignIn(): Promise<{
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const app = githubApp();
  if (!app) throw new Error("Signing in with GitHub is not set up in this copy of RepoBoard.");
  const data = await post("/login/device/code", { client_id: app.clientId });
  if (data.error) throw new Error(String(data.error_description ?? data.error));
  const interval = Number(data.interval ?? 5);
  const expiresIn = Number(data.expires_in ?? 900);
  const flowId = randomUUID();
  for (const [id, f] of flows) if (f.expiresAt < Date.now()) flows.delete(id);
  flows.set(flowId, {
    deviceCode: String(data.device_code),
    interval,
    expiresAt: Date.now() + expiresIn * 1000,
    nextPollAt: Date.now() + interval * 1000,
  });
  return {
    flowId,
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    expiresIn,
    interval,
  };
}

export type SignInPoll =
  | { state: "pending" }
  | { state: "done"; token: string }
  | { state: "expired" }
  | { state: "denied" };

/** Asks GitHub whether the person approved yet — never more often than GitHub allows. */
export async function pollSignIn(flowId: string): Promise<SignInPoll> {
  const app = githubApp();
  const flow = flows.get(flowId);
  if (!app || !flow || flow.expiresAt < Date.now()) {
    flows.delete(flowId);
    return { state: "expired" };
  }
  if (Date.now() < flow.nextPollAt) return { state: "pending" };
  const data = await post("/login/oauth/access_token", {
    client_id: app.clientId,
    device_code: flow.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (typeof data.access_token === "string") {
    flows.delete(flowId);
    return { state: "done", token: data.access_token };
  }
  switch (data.error) {
    case "slow_down":
      flow.interval = Number(data.interval ?? flow.interval + 5);
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return { state: "pending" };
    case "authorization_pending":
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return { state: "pending" };
    case "access_denied":
      flows.delete(flowId);
      return { state: "denied" };
    case "expired_token":
      flows.delete(flowId);
      return { state: "expired" };
    default:
      throw new Error(String(data.error_description ?? data.error ?? "GitHub did not finish the sign-in."));
  }
}
