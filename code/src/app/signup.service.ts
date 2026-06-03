import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { SignupRequest, SignupResponse } from './models';

/** Talks to the public sign-up endpoint on the Functions API. Admin/auth'd
 *  calls (volunteers list, enrollment, shifts) get their own service once
 *  the admin gate is built — see CLAUDE.md → Admin & authentication. */
@Injectable({ providedIn: 'root' })
export class SignupService {
  private readonly http = inject(HttpClient);

  submit(payload: SignupRequest): Observable<SignupResponse> {
    return this.http.post<SignupResponse>(`${environment.apiBaseUrl}/signup`, payload);
  }
}
