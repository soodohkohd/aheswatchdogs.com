import { app, HttpRequest, HttpResponseInit } from '@azure/functions';

import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import { ShiftDayCount, ShiftEntity, TABLES } from '../models';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 *  Public — per-day **counts only** (no names/PII) for the logged-out schedule
 *  view. Signing up / removing / seeing names all require a volunteer session
 *  (see `my/*` + `auth/*`). */
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
    counts.set(entity.partitionKey, (counts.get(entity.partitionKey) ?? 0) + 1);
  }

  const days: ShiftDayCount[] = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return json(200, { days });
}

export async function shifts(request: HttpRequest): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') return preflight();
  return listCounts(request);
}

app.http('shifts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'shifts',
  handler: shifts,
});
