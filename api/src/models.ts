import { TableEntity } from '@azure/data-tables';

/** API contract — mirror of code/src/app/models.ts on the frontend. */

export type ShirtSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SHIRT_SIZES: ShirtSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

/** Account state for a volunteer. A record is created `pending` at sign-up and
 *  a coordinator reviews it in the admin Accounts tab:
 *   - `pending`  — new, awaiting review (cannot be edited; must be approved/denied)
 *   - `active`   — approved; **the only state that can sign in** (welcome email sent on approval)
 *   - `denied`   — the deliberate "deny" decision at review time
 *   - `inactive` — a coordinator turned off a previously-active account later
 *  Legacy records with no `status` are treated as NOT active (see `isActive`). */
export type VolunteerStatus = 'pending' | 'active' | 'denied' | 'inactive';

/** Login code: 6 digits, valid 10 minutes, max 5 wrong attempts. */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

/** Volunteer session token lifetime (session-based; ~4 hours). */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

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
  /** Account state. Absent on legacy records → treat as NOT active. */
  status?: VolunteerStatus;
  /** ISO timestamp the volunteer first proved email ownership (code login). */
  verifiedAt?: string;
  /** ISO timestamp a coordinator approved/denied the registration. */
  reviewedAt?: string;
  /** ISO timestamp the approval welcome email was sent. */
  welcomeSentAt?: string;
  /** Current single-use 6-digit login code (hashed is overkill at this scale;
   *  stored plain, short-lived). Cleared on successful login. */
  loginCode?: string;
  /** ISO timestamp after which the login code is no longer valid. */
  loginCodeExpires?: string;
  /** Wrong-attempt counter for the current code; resets on each new request. */
  loginCodeAttempts?: number;
}

/** Canonical training videos, by stable slug. `trainingVideosCompleted` is
 *  true only when every slug here has been watched. Adding a video here makes
 *  it required; the slugs are persisted in `Enrollment.videosWatched`. */
export interface TrainingVideo {
  slug: string;
  title: string;
}
export const TRAINING_VIDEOS: TrainingVideo[] = [
  { slug: 'foundational-playground-practices', title: 'Foundational Playground Practices' },
  { slug: 'supporting-conflict-resolution', title: 'Supporting Conflict Resolution' },
];
export const TRAINING_VIDEO_SLUGS: string[] = TRAINING_VIDEOS.map((v) => v.slug);

/** `Enrollment` table — PartitionKey = volunteer id, RowKey 'status'.
 *  Mirrors the brochure's 3-step checklist. */
export interface EnrollmentEntity extends TableEntity {
  partitionKey: string;
  rowKey: 'status';
  formCompleted: boolean;
  ptaRegistered: boolean;
  /** Derived: true once every TRAINING_VIDEOS slug appears in videosWatched. */
  trainingVideosCompleted: boolean;
  /** CSV of watched video slugs (per-video progress). Order-insensitive. */
  videosWatched?: string;
  /** ISO timestamp a video-watch was last recorded. */
  videosUpdatedAt?: string;
  updatedAt: string;
}

/** Volunteer-facing enrollment state (GET /api/my/enrollment). */
export interface EnrollmentState {
  formCompleted: boolean;
  ptaRegistered: boolean;
  trainingVideosCompleted: boolean;
  /** Per-video watched flags, in canonical order. */
  videos: Array<{ slug: string; title: string; watched: boolean }>;
}

/** Payload to record a watched training video. */
export interface WatchVideoRequest {
  video: string; // a TRAINING_VIDEOS slug
}

/** One account row for the admin Accounts tab — volunteer details + status +
 *  enrollment progress (PTA + per-video watched). */
export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
  status: VolunteerStatus | 'unknown';
  createdAt: string;
  reviewedAt?: string;
  enrollment: {
    ptaRegistered: boolean;
    trainingVideosCompleted: boolean;
    videos: Array<{ slug: string; title: string; watched: boolean }>;
  };
}

/** Admin payload to update a volunteer's editable fields and/or status, plus
 *  manually-managed enrollment flags (PTA has no automated link to this app, so
 *  coordinators set it by hand; video flags are overridable for flexibility). */
export interface AccountUpdateRequest {
  id: string;
  name?: string;
  email?: string;
  mobile?: string;
  students?: string;
  availability?: string;
  shirtSize?: ShirtSize;
  status?: VolunteerStatus;
  /** Manually set PTA-registered (no automated PTA integration). */
  ptaRegistered?: boolean;
  /** Manual override of which training-video slugs count as watched. */
  videosWatched?: string[];
}

/** Passwordless login: request a 6-digit code, then exchange it for a session. */
export interface RequestCodeRequest {
  email: string;
}
export interface VerifyCodeRequest {
  email: string;
  code: string;
}

/** Volunteer-tier payload to add/remove one's own shift for a date. */
export interface MyShiftRequest {
  date: string; // YYYY-MM-DD
}

/** Volunteer self-service profile (contact fields only; email is fixed). */
export interface MyAccount {
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
}
export interface MyAccountUpdateRequest {
  name?: string;
  mobile?: string;
  students?: string;
  availability?: string;
  shirtSize?: ShirtSize;
}

/** Admin: coordinator creates a new account (becomes active immediately). */
export interface AccountCreateRequest {
  name: string;
  email: string;
  mobile: string;
  shirtSize: ShirtSize;
  students?: string;
  availability?: string;
}

/** One person on a day's roster, as shown to a signed-in volunteer (names
 *  only — no email/PII). `isMe` marks the viewer's own row. */
export interface RosterPerson {
  name: string;
  isMe: boolean;
}

/** A day's roster for the signed-in volunteer view. */
export interface RosterDay {
  date: string;
  people: RosterPerson[];
}

/** `Shifts` table — PartitionKey = date (YYYY-MM-DD), RowKey = volunteer id.
 *  Date-as-partition makes "who's on campus this day" one fast query. Name +
 *  email are denormalized for the (admin-facing) roster view. */
export interface ShiftEntity extends TableEntity {
  partitionKey: string; // date
  rowKey: string; // volunteer id, or `manual:<uuid>` for coordinator-added guests
  volunteerName: string;
  email: string;
  createdAt: string;
  /** True for coordinator-added entries with no volunteer account (name only). */
  manual?: boolean;
}

/** Prefix marking a Shifts RowKey as a coordinator-added manual entry (no
 *  account). Kept distinct from real volunteer ids (UUIDs). */
export const MANUAL_SHIFT_PREFIX = 'manual:';

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
