import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { EnrollmentState } from './models';

/** Volunteer-tier enrollment calls (require a session token, attached by the
 *  volunteerAuthInterceptor). Tracks the 3-step checklist + per-video progress
 *  for the signed-in volunteer. */
@Injectable({ providedIn: 'root' })
export class EnrollmentService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/my/enrollment`;

  /** The signed-in volunteer's checklist + per-video watched flags. */
  get(): Observable<EnrollmentState> {
    return this.http.get<EnrollmentState>(this.base);
  }

  /** Record that the volunteer finished a training video (idempotent). */
  markVideoWatched(slug: string): Observable<EnrollmentState> {
    return this.http.post<EnrollmentState>(`${this.base}/video`, { video: slug });
  }
}
