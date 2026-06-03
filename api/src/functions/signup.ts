import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';

import { getTable } from '../storage/tables';
import { json, preflight } from '../http';
import {
  EnrollmentEntity,
  SHIRT_SIZES,
  ShirtSize,
  SignupRequest,
  TABLES,
  VolunteerEntity,
} from '../models';

const MAX_LEN = 2000;

/** Validate + normalize the incoming sign-up payload. Returns either a clean
 *  SignupRequest or a list of human-readable errors. The endpoint is public,
 *  so validate strictly. */
function parse(body: unknown): { value?: SignupRequest; errors: string[] } {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  // Required string: must be present.
  const required = (key: string, label: string): string => {
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
    if (!v) errors.push(`${label} is required.`);
    if (v.length > MAX_LEN) errors.push(`${label} is too long.`);
    return v;
  };

  // Optional string: defaults to empty, only length-checked.
  const optional = (key: string, label: string): string => {
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
    if (v.length > MAX_LEN) errors.push(`${label} is too long.`);
    return v;
  };

  const name = required('name', 'Name');
  // Normalize email to lowercase so storage, dedup, and shift lookups all
  // compare consistently.
  const email = required('email', 'Email').toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Email is invalid.');
  const mobile = required('mobile', 'Mobile');
  const students = optional('students', 'Student(s)');
  const availability = optional('availability', 'Availability');

  const shirtSize = b['shirtSize'] as ShirtSize;
  if (!SHIRT_SIZES.includes(shirtSize)) errors.push('A valid t-shirt size is required.');

  if (errors.length) return { errors };
  return { value: { name, email, mobile, students, availability, shirtSize }, errors };
}

export async function signup(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') {
    return preflight();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }

  const { value, errors } = parse(body);
  if (!value) {
    return json(400, { errors });
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    const volunteers = await getTable(TABLES.volunteers);

    // Reject duplicate registrations — one volunteer record per email.
    const escapedEmail = value.email.replace(/'/g, "''");
    for await (const _existing of volunteers.listEntities<VolunteerEntity>({
      queryOptions: { filter: `email eq '${escapedEmail}'`, select: ['rowKey'] },
    })) {
      return json(409, {
        errors: ['This email is already registered. If that’s you, you’re all set — no need to sign up again.'],
      });
    }

    // 1) Create the volunteer record.
    const volunteer: VolunteerEntity = {
      partitionKey: 'volunteer',
      rowKey: id,
      ...value,
      createdAt: now,
    };
    await volunteers.createEntity(volunteer);

    // 2) Seed the 3-step enrollment checklist (form done; PTA + training pending).
    const enrollment = await getTable(TABLES.enrollment);
    const status: EnrollmentEntity = {
      partitionKey: id,
      rowKey: 'status',
      formCompleted: true,
      ptaRegistered: false,
      trainingVideosCompleted: false,
      updatedAt: now,
    };
    await enrollment.createEntity(status);
  } catch (err) {
    context.error('signup: failed to write volunteer', err);
    return json(500, { errors: ['Could not save your registration. Please try again later.'] });
  }

  return json(201, { id });
}

app.http('signup', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'signup',
  handler: signup,
});
