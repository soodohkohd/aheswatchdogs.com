import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { ShiftDayCount, ShiftEntity, ShiftSignupRequest, TABLES, VolunteerEntity } from '../models';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape a value for an OData string literal (single quotes are doubled). */
function odata(value: string): string {
  return value.replace(/'/g, "''");
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  Public — returns counts per day only (no volunteer PII). Defaults to the
 *  next four weeks when no range is given. */
async function listCounts(request: HttpRequest): Promise<HttpResponseInit> {
  const from = request.query.get('from') || today();
  const to = request.query.get('to') || addDays(from, 27);
  if (!isValidDate(from) || !isValidDate(to)) {
    return json(400, { errors: ['from/to must be YYYY-MM-DD dates.'] });
  }

  const shifts = await getTable(TABLES.shifts);
  const counts = new Map<string, number>();
  const filter = `PartitionKey ge '${odata(from)}' and PartitionKey le '${odata(to)}'`;
  for await (const entity of shifts.listEntities<ShiftEntity>({ queryOptions: { filter } })) {
    const date = entity.partitionKey;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const days: ShiftDayCount[] = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return json(200, { days });
}

/** POST /api/shifts { date, email }
 *  Public, but gated on a registered email — matches the volunteer record so
 *  shifts stay tied to real volunteers. Idempotent per (date, volunteer). */
async function signUp(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let body: ShiftSignupRequest;
  try {
    body = (await request.json()) as ShiftSignupRequest;
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const errors: string[] = [];
  if (!isValidDate(date)) errors.push('A valid date (YYYY-MM-DD) is required.');
  else if (date < today()) errors.push('That date is in the past.');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('A valid email is required.');
  if (errors.length) return json(400, { errors });

  try {
    // Look up the volunteer by email (small table; filter scan is fine).
    const volunteers = await getTable(TABLES.volunteers);
    let volunteer: VolunteerEntity | undefined;
    const filter = `email eq '${odata(email)}'`;
    for await (const v of volunteers.listEntities<VolunteerEntity>({ queryOptions: { filter } })) {
      volunteer = v;
      break;
    }
    if (!volunteer) {
      return json(404, {
        errors: [
          'We couldn’t find a volunteer with that email. Please complete the registration form first.',
        ],
      });
    }

    const shifts = await getTable(TABLES.shifts);
    const entity: ShiftEntity = {
      partitionKey: date,
      rowKey: volunteer.rowKey,
      volunteerName: volunteer.name,
      email: volunteer.email,
      createdAt: new Date().toISOString(),
    };
    await shifts.upsertEntity(entity, 'Replace');
    return json(201, { date });
  } catch (err) {
    context.error('shifts: failed to sign up for shift', err);
    return json(500, { errors: ['Could not save your shift. Please try again later.'] });
  }
}

export async function shifts(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method === 'GET') return listCounts(request);
  return signUp(request, context);
}

app.http('shifts', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'shifts',
  handler: shifts,
});
