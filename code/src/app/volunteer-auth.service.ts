import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../environments/environment';
import { VerifyCodeResponse } from './models';

const TOKEN_KEY = 'ahes_vol_token';
const EMAIL_KEY = 'ahes_vol_email';
const NAME_KEY = 'ahes_vol_name';

/** Volunteer (non-admin) passwordless auth: request a 6-digit email code, then
 *  exchange it for a session token. Session-only — the token lives in
 *  sessionStorage and is gone when the tab/browser closes. */
@Injectable({ providedIn: 'root' })
export class VolunteerAuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/auth`;

  private readonly token = signal<string | null>(sessionStorage.getItem(TOKEN_KEY));
  readonly email = signal<string | null>(sessionStorage.getItem(EMAIL_KEY));
  readonly name = signal<string | null>(sessionStorage.getItem(NAME_KEY));
  readonly loggedIn = computed(() => !!this.token());

  /** Send a login code to a registered volunteer's email. */
  requestCode(email: string): Observable<{ sent: boolean; emailSent?: boolean }> {
    return this.http.post<{ sent: boolean; emailSent?: boolean }>(`${this.base}/request-code`, { email });
  }

  /** Exchange email + code for a session; stores it on success. */
  verifyCode(email: string, code: string): Observable<VerifyCodeResponse> {
    return this.http.post<VerifyCodeResponse>(`${this.base}/verify-code`, { email, code }).pipe(
      tap((res) => this.setSession(res)),
    );
  }

  private setSession(res: VerifyCodeResponse): void {
    sessionStorage.setItem(TOKEN_KEY, res.token);
    sessionStorage.setItem(EMAIL_KEY, res.email);
    sessionStorage.setItem(NAME_KEY, res.name ?? '');
    this.token.set(res.token);
    this.email.set(res.email);
    this.name.set(res.name ?? '');
  }

  signOut(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(NAME_KEY);
    this.token.set(null);
    this.email.set(null);
    this.name.set(null);
  }

  getToken(): string | null {
    return this.token();
  }
}
