import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { RosterDay } from './models';

/** Volunteer-tier schedule calls (require a session token, attached by the
 *  volunteerAuthInterceptor). Roster shows names but no PII; sign-up/remove
 *  always act on the signed-in volunteer's own shifts. */
@Injectable({ providedIn: 'root' })
export class MyShiftsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/my`;

  /** Confirm the session is still valid. */
  session(): Observable<{ email: string }> {
    return this.http.get<{ email: string }>(`${this.base}/session`);
  }

  /** The signed-in volunteer's own upcoming dates. */
  myDates(): Observable<{ dates: string[] }> {
    return this.http.get<{ dates: string[] }>(`${this.base}/shifts`);
  }

  /** Per-day roster (names only) for a date range. */
  roster(from: string, to: string): Observable<{ days: RosterDay[] }> {
    return this.http.get<{ days: RosterDay[] }>(`${this.base}/roster`, { params: { from, to } });
  }

  signUp(date: string): Observable<{ date: string }> {
    return this.http.post<{ date: string }>(`${this.base}/shifts`, { date });
  }

  remove(date: string): Observable<{ date: string; removed: boolean }> {
    return this.http.post<{ date: string; removed: boolean }>(`${this.base}/shifts/remove`, { date });
  }

  /** Delete the signed-in volunteer's account + all their days. */
  deleteAccount(): Observable<{ deleted: boolean; shiftsRemoved: number }> {
    return this.http.post<{ deleted: boolean; shiftsRemoved: number }>(`${this.base}/account/delete`, {});
  }
}
