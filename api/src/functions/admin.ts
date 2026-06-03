import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';

import { authenticateAdmin, AuthResult } from '../auth';
import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { MANUAL_SHIFT_PREFIX, ShiftEntity, TABLES } from '../models';

const MAX_NAME_LEN = 120;

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
