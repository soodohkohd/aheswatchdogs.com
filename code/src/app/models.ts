/** Shapes shared across the app. Mirror the API contract in api/. */

export type ShirtSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

/** Payload for the public sign-up POST — the registration form fields. */
export interface SignupRequest {
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
}

export interface SignupResponse {
  id?: string;
  /** Set when the email is already registered (→ send them to sign in). */
  alreadyRegistered?: boolean;
}

/** Passwordless login: request a code, then exchange it for a session. */
export interface VerifyCodeResponse {
  token: string;
  email: string;
  name: string;
}

/** A person on a day's roster as shown to a signed-in volunteer (names only). */
export interface RosterPerson {
  name: string;
  isMe: boolean;
}
export interface RosterDay {
  date: string; // YYYY-MM-DD
  people: RosterPerson[];
}

/** The 3-step enrollment checklist tracked per volunteer (admin-facing). */
export interface EnrollmentStatus {
  formCompleted: boolean;
  ptaRegistered: boolean;
  trainingVideosCompleted: boolean;
}

/** One training video with the signed-in volunteer's watched flag. */
export interface VideoState {
  slug: string;
  title: string;
  watched: boolean;
}

/** Volunteer-facing enrollment state (GET /api/my/enrollment). */
export interface EnrollmentState {
  formCompleted: boolean;
  ptaRegistered: boolean;
  trainingVideosCompleted: boolean;
  videos: VideoState[];
}

/** Public schedule: how many Watch D.O.G.S. are signed up per day (no names). */
export interface ShiftDayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/** A volunteer's own editable profile (contact fields; email is read-only). */
export interface MyAccount {
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
}
export interface MyAccountUpdate {
  name: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: ShirtSize;
}
