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

/** Validate + normalize the incoming sign-up payload. */
function parse(body: unknown): { value?: SignupRequest; errors: string[] } {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const required = (key: string, label: string): string => {
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
    if (!v) errors.push(`${label} is required.`);
    if (v.length > MAX_LEN) errors.push(`${label} is too long.`);
    return v;
  };
  const optional = (key: string, label: string): string => {
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
    if (v.length > MAX_LEN) errors.push(`${label} is too long.`);
    return v;
  };

  const name = required('name', 'Name');
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
  if (request.method === 'OPTIONS') return preflight();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { errors: ['Invalid JSON body.'] });
  }

  const { value, errors } = parse(body);
  if (!value) return json(400, { errors });

  const now = new Date().toISOString();

  try {
    const volunteers = await getTable(TABLES.volunteers);

    // One volunteer per email. Re-registering does nothing useful now — the
    // schedule's email-code sign-in handles ownership — so point them there.
    const escapedEmail = value.email.replace(/'/g, "''");
    for await (const _existing of volunteers.listEntities<VolunteerEntity>({
      queryOptions: { filter: `email eq '${escapedEmail}'`, select: ['rowKey'] },
    })) {
      return json(409, {
        alreadyRegistered: true,
        errors: [
          'This email is already registered. Head to the Schedule and sign in with your email to pick days.',
        ],
      });
    }

    // New volunteer → created as pending. They become active the first time they
    // sign in with an emailed code (see auth/verify-code).
    const id = randomUUID();
    const volunteer: VolunteerEntity = {
      partitionKey: 'volunteer',
      rowKey: id,
      ...value,
      createdAt: now,
      status: 'pending',
    };
    await volunteers.createEntity(volunteer);

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

    return json(201, { id });
  } catch (err) {
    context.error('signup: failed to write volunteer', err);
    return json(500, { errors: ['Could not save your registration. Please try again later.'] });
  }
}

app.http('signup', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'signup',
  handler: signup,
});
