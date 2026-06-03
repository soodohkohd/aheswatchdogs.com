import { HttpRequest } from '@azure/functions';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { SESSION_TTL_MS } from './models';

/**
 * Volunteer sessions are **stateless, signed tokens** (no server-side storage):
 * `base64url(payload) . base64url(HMAC-SHA256(payload, SESSION_SECRET))`.
 * The payload carries the volunteer id, email, and an expiry. We verify by
 * recomputing the HMAC and checking expiry — so there's nothing to clean up,
 * and "session-based" means the frontend just holds the token in sessionStorage.
 */

interface SessionPayload {
  sub: string; // volunteer id
  email: string;
  exp: number; // epoch ms
}

function secret(): string {
  const s = process.env['SESSION_SECRET'];
  if (s && s.length >= 16) return s;
  // Dev fallback: a per-process random secret. Tokens won't survive a restart
  // locally (fine for dev); in prod SESSION_SECRET must be set.
  return (globalThis as Record<string, unknown>)['__ahesDevSecret__'] as string ??
    ((globalThis as Record<string, unknown>)['__ahesDevSecret__'] = randomBytes(32).toString('hex'));
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Issue a signed session token for a volunteer. */
export function issueSession(volunteerId: string, email: string): string {
  const payload: SessionPayload = {
    sub: volunteerId,
    email,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Verify a token; returns the payload if valid+unexpired, else null. */
export function verifySession(token: string): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare (lengths must match for timingSafeEqual).
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.sub || !payload.email || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(request: HttpRequest): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export type VolunteerAuth =
  | { ok: true; volunteerId: string; email: string }
  | { ok: false; status: 401; error: string };

/** Gate for the volunteer-tier (`my/*`) routes. */
export function authenticateVolunteer(request: HttpRequest): VolunteerAuth {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Sign in to continue.' };
  const payload = verifySession(token);
  if (!payload) return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' };
  return { ok: true, volunteerId: payload.sub, email: payload.email };
}
