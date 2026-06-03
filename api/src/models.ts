import { TableEntity } from '@azure/data-tables';

/** API contract — mirror of code/src/app/models.ts on the frontend. */

export type ShirtSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SHIRT_SIZES: ShirtSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

/** Payload for the public sign-up POST. */
export interface SignupRequest {
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
}

/** `Volunteers` table — PartitionKey 'volunteer', RowKey = generated id.
 *  Email is stored as a field, NOT used as the key (keys are immutable). */
export interface VolunteerEntity extends TableEntity {
  partitionKey: 'volunteer';
  rowKey: string;
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
  createdAt: string;
}

/** `Enrollment` table — PartitionKey = volunteer id, RowKey 'status'.
 *  Mirrors the brochure's 3-step checklist. */
export interface EnrollmentEntity extends TableEntity {
  partitionKey: string;
  rowKey: 'status';
  formCompleted: boolean;
  ptaRegistered: boolean;
  trainingVideosCompleted: boolean;
  updatedAt: string;
}

/** Payload for a shift sign-up — pick a date, identify by registered email. */
export interface ShiftSignupRequest {
  date: string; // YYYY-MM-DD
  email: string;
}

/** `Shifts` table — PartitionKey = date (YYYY-MM-DD), RowKey = volunteer id.
 *  Date-as-partition makes "who's on campus this day" one fast query. Name +
 *  email are denormalized for the (admin-facing) roster view. */
export interface ShiftEntity extends TableEntity {
  partitionKey: string; // date
  rowKey: string; // volunteer id
  volunteerName: string;
  email: string;
  createdAt: string;
}

/** Public schedule shape — counts only, no PII. */
export interface ShiftDayCount {
  date: string;
  count: number;
}

export const TABLES = {
  volunteers: 'Volunteers',
  enrollment: 'Enrollment',
  shifts: 'Shifts',
} as const;
