import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { sendLoginCodeEmail } from '../email';
import { newLoginCode } from '../verification';
import { issueSession } from '../session';
import {
  MAX_CODE_ATTEMPTS,
  RequestCodeRequest,
  TABLES,
  VerifyCodeRequest,
  VolunteerEntity,
} from '../models';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function odata(value: string): string {
  return value.replace(/'/g, "''");
}

async function findByEmail(email: string): Promise<VolunteerEntity | undefined> {
  const volunteers = await getTable(TABLES.volunteers);
  for await (const v of volunteers.listEntities<VolunteerEntity>({
    queryOptions: { filter: `email eq '${odata(email)}'` },
  })) {
    return v;
  }
  return undefined;
}

/** POST /api/auth/request-code { email }
 *  Emails a fresh 6-digit code to a registered volunteer. Unknown email → 404
 *  (so the UI can point them at "Join Watch D.O.G.S."). */
async function requestCode(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let body: RequestCodeRequest;
  try {
    body = (await request.json()) as RequestCodeRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return json(400, { errors: ['A valid email is required.'] });

  try {
    const volunteer = await findByEmail(email);
    if (!volunteer) {
      return json(404, {
        notRegistered: true,
        errors: ['We couldn’t find a volunteer with that email. Please join Watch D.O.G.S. first.'],
      });
    }

    const { code, expires } = newLoginCode();
    const volunteers = await getTable(TABLES.volunteers);
    await volunteers.updateEntity(
      {
        partitionKey: 'volunteer',
        rowKey: volunteer.rowKey,
        loginCode: code,
        loginCodeExpires: expires,
        loginCodeAttempts: 0,
      } as VolunteerEntity,
      'Merge',
    );

    let emailSent = false;
    try {
      emailSent = await sendLoginCodeEmail(volunteer.email, volunteer.name, code, context);
    } catch (err) {
      context.error('auth: failed to send login code', err);
      return json(502, { errors: ['We couldn’t send your code just now. Please try again shortly.'] });
    }
    return json(200, { sent: true, emailSent });
  } catch (err) {
    context.error('auth: request-code failed', err);
    return json(500, { errors: ['Could not start sign-in. Please try again later.'] });
  }
}

/** POST /api/auth/verify-code { email, code }
 *  Validates the code and returns a session token. A successful login also marks
 *  the account active (proves email ownership). */
async function verifyCode(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let body: VerifyCodeRequest;
  try {
    body = (await request.json()) as VerifyCodeRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return json(400, { errors: ['Enter your email and the 6-digit code.'] });
  }

  try {
    const volunteer = await findByEmail(email);
    if (!volunteer || !volunteer.loginCode || !volunteer.loginCodeExpires) {
      return json(400, { errors: ['No active code. Request a new one.'] });
    }
    if (volunteer.loginCodeExpires < new Date().toISOString()) {
      return json(410, { expired: true, errors: ['That code has expired. Request a new one.'] });
    }
    if ((volunteer.loginCodeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      return json(429, { errors: ['Too many attempts. Request a new code.'] });
    }

    const volunteers = await getTable(TABLES.volunteers);
    if (volunteer.loginCode !== code) {
      await volunteers.updateEntity(
        {
          partitionKey: 'volunteer',
          rowKey: volunteer.rowKey,
          loginCodeAttempts: (volunteer.loginCodeAttempts ?? 0) + 1,
        } as VolunteerEntity,
        'Merge',
      );
      return json(400, { errors: ['That code is incorrect. Check it and try again.'] });
    }

    // Success: clear the code, mark active, stamp first verification.
    await volunteers.updateEntity(
      {
        partitionKey: 'volunteer',
        rowKey: volunteer.rowKey,
        status: 'active',
        verifiedAt: volunteer.verifiedAt || new Date().toISOString(),
        loginCode: '',
        loginCodeExpires: '',
        loginCodeAttempts: 0,
      } as VolunteerEntity,
      'Merge',
    );

    const token = issueSession(volunteer.rowKey, volunteer.email);
    return json(200, { token, email: volunteer.email, name: volunteer.name });
  } catch (err) {
    context.error('auth: verify-code failed', err);
    return json(500, { errors: ['Could not verify your code. Please try again later.'] });
  }
}

export async function auth(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const action = request.params.action;
  if (action === 'request-code') return requestCode(request, context);
  if (action === 'verify-code') return verifyCode(request, context);
  return json(404, { errors: ['Unknown auth action.'] });
}

app.http('auth', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'auth/{action}',
  handler: auth,
});
