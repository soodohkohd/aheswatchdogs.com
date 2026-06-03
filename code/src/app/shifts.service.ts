import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { ShiftDayCount } from './models';

/** Public schedule call: per-day counts only (no names). Signing up, removing,
 *  and seeing names all require a volunteer session — see MyShiftsService. */
@Injectable({ providedIn: 'root' })
export class ShiftsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/shifts`;

  counts(from: string, to: string): Observable<{ days: ShiftDayCount[] }> {
    return this.http.get<{ days: ShiftDayCount[] }>(this.base, { params: { from, to } });
  }
}
