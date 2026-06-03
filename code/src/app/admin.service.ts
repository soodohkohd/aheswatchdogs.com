import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export interface RosterVolunteer {
  id: string;
  name: string;
  email: string;
  /** True for coordinator-added entries (name only, no account). */
  manual: boolean;
}

export interface RosterDay {
  date: string;
  count: number;
  volunteers: RosterVolunteer[];
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

  /** Coordinator override: add a person to a day by name only (no account). */
  addShift(date: string, name: string): Observable<{ id: string; name: string; date: string }> {
    return this.http.post<{ id: string; name: string; date: string }>(`${this.base}/shifts/add`, { date, name });
  }
}
