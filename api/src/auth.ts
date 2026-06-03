import { HttpRequest } from '@azure/functions';
import { OAuth2Client } from 'google-auth-library';

/**
 * Admin authentication: a request is admin iff it carries a valid Google
 * ID token (verified against Google's keys) whose verified email is on the
 * allowlist. The allowlist + client ID come from app settings so access can
 * change without a redeploy.
 */

const DEFAULT_ALLOWLIST = ['support@aheswatchdogs.com'];

let cachedClient: OAuth2Client | undefined;

function allowlist(): string[] {
  const raw = process.env['ADMIN_ALLOWLIST'];
  const list = raw
    ? raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_ALLOWLIST;
  return list;
}

function bearerToken(request: HttpRequest): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

/** Verify the request's bearer token and allowlist membership. */
export async function authenticateAdmin(request: HttpRequest): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Sign in to continue.' };
  }

  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) {
    return { ok: false, status: 401, error: 'Admin auth is not configured.' };
  }

  let email: string;
  try {
    cachedClient ??= new OAuth2Client(clientId);
    const ticket = await cachedClient.verifyIdToken({ idToken: token, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) {
      return { ok: false, status: 401, error: 'Could not verify your Google account.' };
    }
    email = payload.email.toLowerCase();
  } catch {
    return { ok: false, status: 401, error: 'Your session is invalid or expired. Sign in again.' };
  }

  if (!allowlist().includes(email)) {
    return {
      ok: false,
      status: 403,
      error: `Signed in as ${email}, which isn’t authorized for the coordinator dashboard. Use the program account or ask to be added.`,
    };
  }
  return { ok: true, email };
}
