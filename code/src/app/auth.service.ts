import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * Admin session state. The token is a Google ID token, attached to
 * /api/manage/* calls by adminAuthInterceptor and validated server-side.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly TOKEN_KEY = 'ahes-admin-token';

  readonly token = signal<string | null>(this.read());
  readonly email = signal<string | null>(null);
  readonly isAuthed = computed(() => !!this.email());
  /** Server's message from the last failed validate (e.g. the 403 with the
   *  signed-in email). Surfaced on the sign-in card. */
  readonly lastError = signal<string | null>(null);

  readonly googleClientId = environment.googleClientId;

  private read(): string | null {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(this.TOKEN_KEY) : null;
  }

  private store(token: string | null): void {
    this.token.set(token);
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(this.TOKEN_KEY, token);
    else localStorage.removeItem(this.TOKEN_KEY);
  }

  signInWithGoogle(credential: string): Observable<boolean> {
    this.store(credential);
    return this.validate();
  }

  signOut(): void {
    this.store(null);
    this.email.set(null);
  }

  /** Confirm the current token with the API and capture the signed-in email.
   *  Clears the session on failure. Returns whether the session is valid. */
  validate(): Observable<boolean> {
    if (!this.token()) {
      this.email.set(null);
      return of(false);
    }
    return this.http.get<{ email: string }>(`${environment.apiBaseUrl}/manage/me`).pipe(
      tap(({ email }) => {
        this.email.set(email);
        this.lastError.set(null);
      }),
      map(() => true),
      catchError((err) => {
        this.lastError.set(err?.error?.errors?.[0] ?? null);
        this.signOut();
        return of(false);
      }),
    );
  }
}
