import { randomInt } from 'node:crypto';

import { LOGIN_CODE_TTL_MS, VolunteerEntity } from './models';

/** Generate a fresh 6-digit login code + its expiry timestamp. */
export function newLoginCode(): { code: string; expires: string } {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expires = new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString();
  return { code, expires };
}

/** A volunteer counts as active once they've proved email ownership (code
 *  login). Legacy records (no `status`) count as NOT active. */
export function isActive(volunteer: Pick<VolunteerEntity, 'status'>): boolean {
  return volunteer.status === 'active';
}
