import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { RestError } from '@azure/data-tables';

import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { authenticateVolunteer } from '../session';
import { MyShiftRequest, RosterDay, ShiftEntity, TABLES, VolunteerEntity } from '../models';

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
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** GET /api/my/session → confirm the session and return who's signed in. */
export async function mySession(request: HttpRequest): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = authenticateVolunteer(request);
  if (!auth.ok) return json(auth.status, { errors: [auth.error] });
  return json(200, { email: auth.email });
}

/** GET /api/my/shifts → the signed-in volunteer's own upcoming dates.
 *  POST /api/my/shifts { date } → sign self up for a date. */
export async function myShifts(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = authenticateVolunteer(request);
  if (!auth.ok) return json(auth.status, { errors: [auth.error] });

  const shifts = await getTable(TABLES.shifts);

  if (request.method === 'GET') {
    const from = today();
    // Own rows are RowKey == volunteerId across date partitions (small scan).
    const dates: string[] = [];
    for await (const s of shifts.listEntities<ShiftEntity>({
      queryOptions: { filter: `RowKey eq '${odata(auth.volunteerId)}' and PartitionKey ge '${from}'` },
    })) {
      dates.push(s.partitionKey);
    }
    dates.sort((a, b) => a.localeCompare(b));
    return json(200, { dates });
  }

  // POST → sign up self.
  let body: MyShiftRequest;
  try {
    body = (await request.json()) as MyShiftRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!isValidDate(date)) return json(400, { errors: ['A valid date (YYYY-MM-DD) is required.'] });
  if (date < today()) return json(400, { errors: ['That date is in the past.'] });

  try {
    // Denormalize the volunteer's name onto the shift row for the roster view.
    const volunteers = await getTable(TABLES.volunteers);
    let name = '';
    try {
      const v = await volunteers.getEntity<VolunteerEntity>('volunteer', auth.volunteerId);
      name = v.name;
    } catch {
      /* fall through with empty name */
    }
    const entity: ShiftEntity = {
      partitionKey: date,
      rowKey: auth.volunteerId,
      volunteerName: name,
      email: auth.email,
      createdAt: new Date().toISOString(),
    };
    await shifts.upsertEntity(entity, 'Replace');
    return json(201, { date });
  } catch (err) {
    context.error('my: sign up failed', err);
    return json(500, { errors: ['Could not save your shift. Please try again later.'] });
  }
}

/** POST /api/my/shifts/remove { date } → remove the signed-in volunteer's own
 *  shift for a date. Can only ever remove one's own (keyed by session id). */
export async function myShiftRemove(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = authenticateVolunteer(request);
  if (!auth.ok) return json(auth.status, { errors: [auth.error] });

  let body: MyShiftRequest;
  try {
    body = (await request.json()) as MyShiftRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!isValidDate(date)) return json(400, { errors: ['A valid date is required.'] });

  try {
    const shifts = await getTable(TABLES.shifts);
    await shifts.deleteEntity(date, auth.volunteerId);
    return json(200, { date, removed: true });
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) {
      return json(200, { date, removed: false }); // already not signed up — idempotent
    }
    context.error('my: remove failed', err);
    return json(500, { errors: ['Could not remove your shift. Please try again later.'] });
  }
}

/** GET /api/my/roster?from=&to= → per-day roster (NAMES only, no email) for the
 *  signed-in volunteer view, with `isMe` marking the viewer's own rows. */
export async function myRoster(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = authenticateVolunteer(request);
  if (!auth.ok) return json(auth.status, { errors: [auth.error] });

  const from = request.query.get('from') || today();
  const to = request.query.get('to') || addDays(from, 27);
  if (!isValidDate(from) || !isValidDate(to)) {
    return json(400, { errors: ['from/to must be YYYY-MM-DD dates.'] });
  }

  try {
    const shifts = await getTable(TABLES.shifts);
    const byDate = new Map<string, RosterDay>();
    const filter = `PartitionKey ge '${odata(from)}' and PartitionKey le '${odata(to)}'`;
    for await (const s of shifts.listEntities<ShiftEntity>({ queryOptions: { filter } })) {
      const day = byDate.get(s.partitionKey) ?? { date: s.partitionKey, people: [] };
      day.people.push({ name: s.volunteerName || 'Watch D.O.G.', isMe: s.rowKey === auth.volunteerId });
      byDate.set(s.partitionKey, day);
    }
    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of days) d.people.sort((a, b) => a.name.localeCompare(b.name));
    return json(200, { days });
  } catch (err) {
    context.error('my: roster failed', err);
    return json(500, { errors: ['Could not load the roster. Please try again later.'] });
  }
}

/** POST /api/my/account/delete → delete the signed-in volunteer's account and
 *  ALL their data: every shift sign-up, their enrollment row, and the volunteer
 *  record. Keyed by the session id, so a volunteer can only delete themselves.
 *  Idempotent — missing rows are ignored. */
export async function myAccountDelete(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  const auth = authenticateVolunteer(request);
  if (!auth.ok) return json(auth.status, { errors: [auth.error] });

  try {
    // 1) Remove every shift this volunteer signed up for (RowKey == id).
    const shifts = await getTable(TABLES.shifts);
    const mine: string[] = [];
    for await (const s of shifts.listEntities<ShiftEntity>({
      queryOptions: { filter: `RowKey eq '${odata(auth.volunteerId)}'`, select: ['partitionKey'] },
    })) {
      mine.push(s.partitionKey);
    }
    for (const date of mine) {
      try {
        await shifts.deleteEntity(date, auth.volunteerId);
      } catch (err) {
        if (!(err instanceof RestError && err.statusCode === 404)) throw err;
      }
    }

    // 2) Remove the enrollment checklist row (PK = volunteer id, RK 'status').
    const enrollment = await getTable(TABLES.enrollment);
    try {
      await enrollment.deleteEntity(auth.volunteerId, 'status');
    } catch (err) {
      if (!(err instanceof RestError && err.statusCode === 404)) throw err;
    }

    // 3) Remove the volunteer record itself.
    const volunteers = await getTable(TABLES.volunteers);
    try {
      await volunteers.deleteEntity('volunteer', auth.volunteerId);
    } catch (err) {
      if (!(err instanceof RestError && err.statusCode === 404)) throw err;
    }

    return json(200, { deleted: true, shiftsRemoved: mine.length });
  } catch (err) {
    context.error('my: account delete failed', err);
    return json(500, { errors: ['Could not delete your account. Please try again later.'] });
  }
}

app.http('my-session', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'my/session', handler: mySession });
app.http('my-shifts', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'my/shifts', handler: myShifts });
app.http('my-shifts-remove', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'my/shifts/remove', handler: myShiftRemove });
app.http('my-roster', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'my/roster', handler: myRoster });
app.http('my-account-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'my/account/delete', handler: myAccountDelete });
