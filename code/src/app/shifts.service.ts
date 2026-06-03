import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { ShiftDayCount, ShiftSignupRequest } from './models';

/** Public schedule calls: read per-day counts and sign up for a day. */
@Injectable({ providedIn: 'root' })
export class ShiftsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/shifts`;

  counts(from: string, to: string): Observable<{ days: ShiftDayCount[] }> {
    return this.http.get<{ days: ShiftDayCount[] }>(this.base, { params: { from, to } });
  }

  signUp(payload: ShiftSignupRequest): Observable<{ date: string }> {
    return this.http.post<{ date: string }>(this.base, payload);
  }
}
