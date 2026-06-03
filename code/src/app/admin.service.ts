import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export interface RosterDay {
  date: string;
  count: number;
  volunteers: { id: string; name: string; email: string }[];
}

/** Admin (authenticated) calls. The bearer token is added by
 *  adminAuthInterceptor for any /api/admin URL. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/manage`;

  schedule(from: string, to: string): Observable<{ days: RosterDay[] }> {
    return this.http.get<{ days: RosterDay[] }>(`${this.base}/schedule`, { params: { from, to } });
  }

  removeShift(date: string, volunteerId: string): Observable<{ removed: boolean }> {
    return this.http.post<{ removed: boolean }>(`${this.base}/shifts/remove`, { date, volunteerId });
  }
}
