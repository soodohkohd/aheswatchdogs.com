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

export type AccountStatus = 'pending' | 'active' | 'denied' | 'inactive' | 'unknown';

export interface AccountVideo {
  slug: string;
  title: string;
  watched: boolean;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: string;
  status: AccountStatus;
  createdAt: string;
  reviewedAt?: string;
  enrollment: {
    ptaRegistered: boolean;
    trainingVideosCompleted: boolean;
    videos: AccountVideo[];
  };
}

/** Editable fields sent to the update endpoint. */
export interface AccountUpdate {
  id: string;
  name: string;
  email: string;
  mobile: string;
  students: string;
  availability: string;
  shirtSize: string;
  status: AccountStatus;
  ptaRegistered: boolean;
  videosWatched: string[];
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

  // ---- Accounts ----

  accounts(): Observable<{ accounts: Account[] }> {
    return this.http.get<{ accounts: Account[] }>(`${this.base}/accounts`);
  }

  approveAccount(id: string): Observable<{ ok: boolean; emailSent: boolean; emailError?: boolean }> {
    return this.http.post<{ ok: boolean; emailSent: boolean; emailError?: boolean }>(
      `${this.base}/accounts/approve`,
      { id },
    );
  }

  denyAccount(id: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/accounts/deny`, { id });
  }

  updateAccount(update: AccountUpdate): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/accounts/update`, update);
  }

  deleteAccount(id: string): Observable<{ ok: boolean; shiftsRemoved: number }> {
    return this.http.post<{ ok: boolean; shiftsRemoved: number }>(`${this.base}/accounts/delete`, { id });
  }
}
