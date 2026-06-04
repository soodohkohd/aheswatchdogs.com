import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { RestError } from '@azure/data-tables';

import { authenticateAdmin, AuthResult } from '../auth';
import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { sendWelcomeEmail } from '../email';
import {
  AccountSummary,
  AccountUpdateRequest,
  EnrollmentEntity,
  MANUAL_SHIFT_PREFIX,
  SHIRT_SIZES,
  ShiftEntity,
  TABLES,
  TRAINING_VIDEOS,
  TRAINING_VIDEO_SLUGS,
  VolunteerEntity,
  VolunteerStatus,
} from '../models';

const MAX_NAME_LEN = 120;
const MAX_LEN = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function odata(value: string): string {
  return value.replace(/'/g, "''");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Run the admin gate; returns the auth result so handlers can branch. */
async function guard(request: HttpRequest): Promise<AuthResult> {
  return authenticateAdmin(request);
}

function denied(result: Extract<AuthResult, { ok: false }>): HttpResponseInit {
  return json(result.status, { errors: [result.error] });
}

/** GET /api/admin/me — validate the session and echo the signed-in email. */
async function me(request: HttpRequest): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);
  return json(200, { email: auth.email });
}

interface RosterDay {
  date: string;
  count: number;
  volunteers: { id: string; name: string; email: string; manual: boolean }[];
}

/** GET /api/admin/schedule?from=&to= — full roster per day (names included;
 *  this is the admin view, unlike the public counts-only endpoint). */
async function schedule(request: HttpRequest): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  const from = request.query.get('from') || today();
  const to = request.query.get('to') || addDays(from, 27);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return json(400, { errors: ['from/to must be YYYY-MM-DD dates.'] });
  }

  const shifts = await getTable(TABLES.shifts);
  const byDate = new Map<string, RosterDay>();
  const filter = `PartitionKey ge '${odata(from)}' and PartitionKey le '${odata(to)}'`;
  for await (const s of shifts.listEntities<ShiftEntity>({ queryOptions: { filter } })) {
    const day = byDate.get(s.partitionKey) ?? { date: s.partitionKey, count: 0, volunteers: [] };
    day.volunteers.push({
      id: s.rowKey,
      name: s.volunteerName,
      email: s.email,
      manual: s.manual === true || s.rowKey.startsWith(MANUAL_SHIFT_PREFIX),
    });
    day.count = day.volunteers.length;
    byDate.set(s.partitionKey, day);
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) d.volunteers.sort((a, b) => a.name.localeCompare(b.name));
  return json(200, { days });
}

/** POST /api/admin/shifts/add { date, name } — coordinator override: add a
 *  person to a day by name only, with no volunteer account. Stored as a Shifts
 *  row with a synthetic `manual:<uuid>` id so it counts and shows on rosters and
 *  can be removed like any other sign-up. Always creates a new row (no
 *  dedupe) — the same name can be added more than once on purpose. */
async function addShift(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  let body: { date?: string; name?: string };
  try {
    body = (await request.json()) as { date?: string; name?: string };
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const date = (body.date || '').trim();
  const name = (body.name || '').trim();
  if (!DATE_RE.test(date)) return json(400, { errors: ['A valid date (YYYY-MM-DD) is required.'] });
  if (!name) return json(400, { errors: ['A name is required.'] });
  if (name.length > MAX_NAME_LEN) return json(400, { errors: ['That name is too long.'] });

  try {
    const shifts = await getTable(TABLES.shifts);
    const id = `${MANUAL_SHIFT_PREFIX}${randomUUID()}`;
    const entity: ShiftEntity = {
      partitionKey: date,
      rowKey: id,
      volunteerName: name,
      email: '',
      manual: true,
      createdAt: new Date().toISOString(),
    };
    await shifts.createEntity(entity);
    return json(201, { id, name, date });
  } catch (err) {
    context.error('admin/shifts/add failed', err);
    return json(500, { errors: ['Could not add that person. Please try again.'] });
  }
}

/** POST /api/admin/shifts/remove { date, volunteerId } — remove a sign-up. */
async function removeShift(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  let body: { date?: string; volunteerId?: string };
  try {
    body = (await request.json()) as { date?: string; volunteerId?: string };
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const date = (body.date || '').trim();
  const volunteerId = (body.volunteerId || '').trim();
  if (!DATE_RE.test(date) || !volunteerId) {
    return json(400, { errors: ['A valid date and volunteerId are required.'] });
  }

  try {
    const shifts = await getTable(TABLES.shifts);
    await shifts.deleteEntity(date, volunteerId);
    return json(200, { removed: true });
  } catch (err) {
    context.error('admin/shifts/remove failed', err);
    return json(500, { errors: ['Could not remove the shift. Please try again.'] });
  }
}

// ---------------------------------------------------------------------------
// Accounts management (Accounts tab): list, approve, deny, update, delete.
// ---------------------------------------------------------------------------

/** Parse the stored CSV of watched video slugs into a set (canonical only). */
function parseWatched(csv: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of (csv ?? '').split(',')) {
    const slug = raw.trim();
    if (slug && TRAINING_VIDEO_SLUGS.includes(slug)) set.add(slug);
  }
  return set;
}

function toSummary(v: VolunteerEntity, e: EnrollmentEntity | undefined): AccountSummary {
  const watched = parseWatched(e?.videosWatched);
  return {
    id: v.rowKey,
    name: v.name,
    email: v.email,
    mobile: v.mobile,
    students: v.students,
    availability: v.availability,
    shirtSize: v.shirtSize,
    status: v.status ?? 'unknown',
    createdAt: v.createdAt,
    reviewedAt: v.reviewedAt,
    enrollment: {
      ptaRegistered: e?.ptaRegistered ?? false,
      trainingVideosCompleted: TRAINING_VIDEO_SLUGS.every((s) => watched.has(s)),
      videos: TRAINING_VIDEOS.map((tv) => ({ slug: tv.slug, title: tv.title, watched: watched.has(tv.slug) })),
    },
  };
}

const STATUS_RANK: Record<string, number> = { pending: 0, active: 1, denied: 2, unknown: 3 };

/** GET /api/manage/accounts — all volunteers + status + enrollment progress. */
async function listAccounts(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  try {
    const volunteers = await getTable(TABLES.volunteers);
    const enrollment = await getTable(TABLES.enrollment);

    const enrollByVol = new Map<string, EnrollmentEntity>();
    for await (const e of enrollment.listEntities<EnrollmentEntity>({
      queryOptions: { filter: `RowKey eq 'status'` },
    })) {
      enrollByVol.set(e.partitionKey, e);
    }

    const accounts: AccountSummary[] = [];
    for await (const v of volunteers.listEntities<VolunteerEntity>({
      queryOptions: { filter: `PartitionKey eq 'volunteer'` },
    })) {
      accounts.push(toSummary(v, enrollByVol.get(v.rowKey)));
    }

    // Pending first (needs attention), then by most-recent registration.
    accounts.sort((a, b) => {
      const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      return r !== 0 ? r : b.createdAt.localeCompare(a.createdAt);
    });
    return json(200, { accounts });
  } catch (err) {
    context.error('admin/accounts list failed', err);
    return json(500, { errors: ['Could not load accounts. Please try again.'] });
  }
}

async function getVolunteer(id: string): Promise<VolunteerEntity | null> {
  const volunteers = await getTable(TABLES.volunteers);
  try {
    return await volunteers.getEntity<VolunteerEntity>('volunteer', id);
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return null;
    throw err;
  }
}

/** Set a volunteer's status. Approving (→active) from a non-active state sends
 *  the welcome email. POST /api/manage/accounts/approve|deny { id } */
async function reviewAccount(
  request: HttpRequest,
  context: InvocationContext,
  decision: 'approve' | 'deny',
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const id = (body.id || '').trim();
  if (!id) return json(400, { errors: ['A volunteer id is required.'] });

  try {
    const volunteer = await getVolunteer(id);
    if (!volunteer) return json(404, { errors: ['That account no longer exists.'] });

    const now = new Date().toISOString();
    const newStatus: VolunteerStatus = decision === 'approve' ? 'active' : 'denied';
    const wasActive = volunteer.status === 'active';

    const volunteers = await getTable(TABLES.volunteers);
    await volunteers.updateEntity(
      { partitionKey: 'volunteer', rowKey: id, status: newStatus, reviewedAt: now } as VolunteerEntity,
      'Merge',
    );

    // On approval (first transition to active), send the welcome email.
    let emailSent = false;
    if (decision === 'approve' && !wasActive) {
      try {
        emailSent = await sendWelcomeEmail(volunteer.email, volunteer.name, context);
        if (emailSent) {
          await volunteers.updateEntity(
            { partitionKey: 'volunteer', rowKey: id, welcomeSentAt: now } as VolunteerEntity,
            'Merge',
          );
        }
      } catch (mailErr) {
        context.error('admin/accounts approve: welcome email failed', mailErr);
        // Account is approved regardless; surface that the email didn't send.
        return json(200, { ok: true, status: newStatus, emailSent: false, emailError: true });
      }
    }
    return json(200, { ok: true, status: newStatus, emailSent });
  } catch (err) {
    context.error(`admin/accounts ${decision} failed`, err);
    return json(500, { errors: [`Could not ${decision} the account. Please try again.`] });
  }
}

/** POST /api/manage/accounts/update — edit contact fields, status, and the
 *  manually-managed enrollment flags (PTA + video overrides). */
async function updateAccount(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  let body: AccountUpdateRequest;
  try {
    body = (await request.json()) as AccountUpdateRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const id = (body.id || '').trim();
  if (!id) return json(400, { errors: ['A volunteer id is required.'] });

  try {
    const volunteer = await getVolunteer(id);
    if (!volunteer) return json(404, { errors: ['That account no longer exists.'] });

    const errors: string[] = [];
    const patch: Partial<VolunteerEntity> = { partitionKey: 'volunteer', rowKey: id };

    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) errors.push('Name cannot be empty.');
      else patch.name = name;
    }
    if (body.mobile !== undefined) {
      const mobile = str(body.mobile);
      if (!mobile) errors.push('Mobile cannot be empty.');
      else patch.mobile = mobile;
    }
    if (body.students !== undefined) patch.students = str(body.students);
    if (body.availability !== undefined) patch.availability = str(body.availability);
    if (body.shirtSize !== undefined) {
      if (!SHIRT_SIZES.includes(body.shirtSize)) errors.push('Invalid t-shirt size.');
      else patch.shirtSize = body.shirtSize;
    }
    if (body.status !== undefined) {
      if (!['pending', 'active', 'denied', 'inactive'].includes(body.status)) errors.push('Invalid status.');
      else patch.status = body.status;
    }

    let newEmail: string | undefined;
    if (body.email !== undefined) {
      newEmail = str(body.email).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) errors.push('Invalid email.');
      else if (newEmail !== volunteer.email) {
        // Enforce email uniqueness (excluding this account).
        const volunteers = await getTable(TABLES.volunteers);
        for await (const other of volunteers.listEntities<VolunteerEntity>({
          queryOptions: { filter: `email eq '${odata(newEmail)}'`, select: ['rowKey'] },
        })) {
          if (other.rowKey !== id) errors.push('Another account already uses that email.');
        }
        if (!errors.length) patch.email = newEmail;
      }
    }

    for (const field of ['name', 'mobile', 'students', 'availability'] as const) {
      const v = patch[field];
      if (typeof v === 'string' && v.length > MAX_LEN) errors.push(`${field} is too long.`);
    }
    if (errors.length) return json(400, { errors });

    const volunteers = await getTable(TABLES.volunteers);
    await volunteers.updateEntity(patch as VolunteerEntity, 'Merge');

    // Keep denormalized Shifts rows (name/email on each sign-up) in sync.
    if (patch.name !== undefined || patch.email !== undefined) {
      const shifts = await getTable(TABLES.shifts);
      for await (const s of shifts.listEntities<ShiftEntity>({
        queryOptions: { filter: `RowKey eq '${odata(id)}'` },
      })) {
        await shifts.updateEntity(
          {
            partitionKey: s.partitionKey,
            rowKey: id,
            ...(patch.name !== undefined ? { volunteerName: patch.name } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
          } as ShiftEntity,
          'Merge',
        );
      }
    }

    // Manually-managed enrollment flags (PTA + video overrides).
    if (body.ptaRegistered !== undefined || body.videosWatched !== undefined) {
      const enrollment = await getTable(TABLES.enrollment);
      let existing: EnrollmentEntity | undefined;
      try {
        existing = await enrollment.getEntity<EnrollmentEntity>(id, 'status');
      } catch (err) {
        if (!(err instanceof RestError && err.statusCode === 404)) throw err;
      }
      const watched =
        body.videosWatched !== undefined
          ? new Set(body.videosWatched.filter((s) => TRAINING_VIDEO_SLUGS.includes(s)))
          : parseWatched(existing?.videosWatched);
      const now = new Date().toISOString();
      const row: EnrollmentEntity = {
        partitionKey: id,
        rowKey: 'status',
        formCompleted: existing?.formCompleted ?? true,
        ptaRegistered: body.ptaRegistered ?? existing?.ptaRegistered ?? false,
        trainingVideosCompleted: TRAINING_VIDEO_SLUGS.every((s) => watched.has(s)),
        videosWatched: [...watched].join(','),
        videosUpdatedAt: existing?.videosUpdatedAt,
        updatedAt: now,
      };
      await enrollment.upsertEntity(row, 'Merge');
    }

    return json(200, { ok: true });
  } catch (err) {
    context.error('admin/accounts update failed', err);
    return json(500, { errors: ['Could not update the account. Please try again.'] });
  }
}

/** POST /api/manage/accounts/delete { id } — cascade delete a volunteer: their
 *  shifts, enrollment row, and the volunteer record. Idempotent. */
async function deleteAccount(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = await guard(request);
  if (!auth.ok) return denied(auth);

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const id = (body.id || '').trim();
  if (!id) return json(400, { errors: ['A volunteer id is required.'] });

  try {
    const shifts = await getTable(TABLES.shifts);
    const dates: string[] = [];
    for await (const s of shifts.listEntities<ShiftEntity>({
      queryOptions: { filter: `RowKey eq '${odata(id)}'`, select: ['partitionKey'] },
    })) {
      dates.push(s.partitionKey);
    }
    for (const date of dates) {
      try {
        await shifts.deleteEntity(date, id);
      } catch (err) {
        if (!(err instanceof RestError && err.statusCode === 404)) throw err;
      }
    }

    const enrollment = await getTable(TABLES.enrollment);
    try {
      await enrollment.deleteEntity(id, 'status');
    } catch (err) {
      if (!(err instanceof RestError && err.statusCode === 404)) throw err;
    }

    const volunteers = await getTable(TABLES.volunteers);
    try {
      await volunteers.deleteEntity('volunteer', id);
    } catch (err) {
      if (!(err instanceof RestError && err.statusCode === 404)) throw err;
    }

    return json(200, { ok: true, shiftsRemoved: dates.length });
  } catch (err) {
    context.error('admin/accounts delete failed', err);
    return json(500, { errors: ['Could not delete the account. Please try again.'] });
  }
}

// NOTE: route prefix is `manage`, NOT `admin` — the Functions host reserves
// the `admin` route prefix for its own management API and rejects it.
app.http('admin-me', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/me',
  handler: me,
});

app.http('admin-schedule', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/schedule',
  handler: schedule,
});

app.http('admin-shift-add', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/shifts/add',
  handler: addShift,
});

app.http('admin-shift-remove', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/shifts/remove',
  handler: removeShift,
});

app.http('admin-accounts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/accounts',
  handler: listAccounts,
});

app.http('admin-accounts-approve', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/accounts/approve',
  handler: (req, ctx) => reviewAccount(req, ctx, 'approve'),
});

app.http('admin-accounts-deny', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/accounts/deny',
  handler: (req, ctx) => reviewAccount(req, ctx, 'deny'),
});

app.http('admin-accounts-update', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/accounts/update',
  handler: updateAccount,
});

app.http('admin-accounts-delete', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'manage/accounts/delete',
  handler: deleteAccount,
});
