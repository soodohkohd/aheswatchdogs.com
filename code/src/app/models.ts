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
  id: string;
}

/** The 3-step enrollment checklist tracked per volunteer (admin-facing). */
export interface EnrollmentStatus {
  formCompleted: boolean;
  ptaRegistered: boolean;
  trainingVideosCompleted: boolean;
}

/** Public schedule: how many Watch D.O.G.S. are signed up per day (no names). */
export interface ShiftDayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/** Payload to sign up for a shift — pick a day, identify by registered email. */
export interface ShiftSignupRequest {
  date: string;
  email: string;
}
