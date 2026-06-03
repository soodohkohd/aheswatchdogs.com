import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';

import { AuthService } from '../../auth.service';
import { AdminService, RosterDay } from '../../admin.service';
import { MonthCalendar } from '../../shared/month-calendar/month-calendar';

// Google Identity Services global (loaded from gsi/client when a client ID is set).
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

@Component({
  selector: 'app-admin',
  imports: [MonthCalendar],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class Admin implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly adminService = inject(AdminService);

  private readonly googleBtn = viewChild<ElementRef<HTMLElement>>('googleBtn');

  protected readonly loading = signal(true);
  protected readonly authError = signal<string | null>(null);
  protected readonly scheduleLoading = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly gsiReady = signal(false);
  protected readonly justSignedOut = signal(false);

  /** Roster keyed by ISO date, feeding both the calendar and the mobile list. */
  private readonly roster = signal<Map<string, RosterDay>>(new Map());
  protected readonly calMonth = signal(this.firstOfThisMonth());
  protected readonly selectedDate = signal<string | null>(null);

  /** Upcoming days with sign-ups, for the mobile list. */
  protected readonly rosterDays = computed<RosterDay[]>(() => {
    const today = this.iso(new Date());
    return [...this.roster().values()]
      .filter((d) => d.date >= today && d.count > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  /** The roster for the day selected in the calendar (desktop panel). */
  protected readonly selectedRoster = computed<RosterDay | null>(() => {
    const date = this.selectedDate();
    if (!date) return null;
    return this.roster().get(date) ?? { date, count: 0, volunteers: [] };
  });

  constructor() {
    // Render the Google button whenever the sign-in card's button element is
    // present and GIS is ready. The element is created/destroyed as the user
    // signs in and out, so this re-runs on each sign-out (re-drawing the
    // button) — not just once at first load.
    effect(() => {
      const el = this.googleBtn()?.nativeElement;
      if (!el || !this.gsiReady() || !this.auth.googleClientId) return;
      window.google!.accounts.id.initialize({
        client_id: this.auth.googleClientId,
        callback: (resp) => this.onCredential(resp.credential),
      });
      window.google!.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 260,
      });
    });
  }

  ngOnInit(): void {
    if (this.auth.googleClientId) this.loadGsi();
    if (this.auth.token()) {
      this.auth.validate().subscribe((ok) => {
        this.loading.set(false);
        if (ok) this.loadInitial();
      });
    } else {
      this.loading.set(false);
    }
  }

  /** Load the Google Identity Services script once, then flag readiness so the
   *  render effect can draw the button. */
  private loadGsi(): void {
    if (window.google) {
      this.gsiReady.set(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => this.gsiReady.set(true));
      if (window.google) this.gsiReady.set(true);
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => this.gsiReady.set(true);
    document.head.appendChild(script);
  }

  private onCredential(credential: string): void {
    this.justSignedOut.set(false);
    this.completeSignIn(this.auth.signInWithGoogle(credential));
  }

  private completeSignIn(result: ReturnType<AuthService['validate']>): void {
    this.authError.set(null);
    this.loading.set(true);
    result.subscribe((ok) => {
      this.loading.set(false);
      if (ok) this.loadInitial();
      else
        this.authError.set(
          this.auth.lastError() ?? 'That account isn’t authorized for the coordinator dashboard.',
        );
    });
  }

  protected signOut(): void {
    this.auth.signOut();
    this.roster.set(new Map());
    this.selectedDate.set(null);
    this.authError.set(null);
    this.justSignedOut.set(true);
  }

  // --- date helpers ---
  private firstOfThisMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }
  private iso(d: Date): string {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  private addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return this.iso(d);
  }
  private monthBounds(month: Date): { from: string; to: string } {
    return {
      from: this.iso(new Date(month.getFullYear(), month.getMonth(), 1)),
      to: this.iso(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
    };
  }

  /** Initial load: cover the mobile upcoming window + the current month. */
  private loadInitial(): void {
    const today = this.iso(new Date());
    const { from } = this.monthBounds(this.calMonth());
    this.loadRange(from < today ? from : today, this.addDays(today, 56));
  }

  /** Load a date range's roster, replacing any stale entries inside it. */
  private loadRange(from: string, to: string): void {
    this.scheduleLoading.set(true);
    this.adminService.schedule(from, to).subscribe({
      next: ({ days }) => {
        this.roster.update((prev) => {
          const next = new Map(prev);
          for (const k of [...next.keys()]) if (k >= from && k <= to) next.delete(k);
          for (const d of days) next.set(d.date, d);
          return next;
        });
        this.scheduleLoading.set(false);
      },
      error: () => {
        this.scheduleLoading.set(false);
        this.authError.set('Could not load the schedule. Try signing in again.');
      },
    });
  }

  protected onMonthChange(month: Date): void {
    this.calMonth.set(month);
    const { from, to } = this.monthBounds(month);
    this.loadRange(from, to);
  }

  /** Reload both the upcoming window and the visible month. */
  protected refresh(): void {
    this.loadInitial();
    this.onMonthChange(this.calMonth());
  }

  protected countFor(date: string): number {
    return this.roster().get(date)?.count ?? 0;
  }

  protected selectDay(date: string): void {
    this.selectedDate.set(date);
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${iso}T00:00:00`));
  }

  protected remove(date: string, volunteerId: string): void {
    const key = `${date}|${volunteerId}`;
    this.removing.set(key);
    this.adminService.removeShift(date, volunteerId).subscribe({
      next: () => {
        this.removing.set(null);
        const { from, to } = this.monthBounds(new Date(`${date}T00:00:00`));
        this.loadRange(from, to);
      },
      error: () => {
        this.removing.set(null);
        this.authError.set('Could not remove that sign-up. Please try again.');
      },
    });
  }
}
