import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ShiftsService } from '../../shifts.service';
import { MyShiftsService } from '../../my-shifts.service';
import { EnrollmentService } from '../../enrollment.service';
import { VolunteerAuthService } from '../../volunteer-auth.service';
import { MonthCalendar } from '../../shared/month-calendar/month-calendar';
import { EnrollmentState, MyAccount, MyAccountUpdate, RosterPerson } from '../../models';

const SHIRT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

/** A training video player with its canonical slug (matches the API's
 *  TRAINING_VIDEOS). Self-hosted on Azure Blob Storage (Range-capable). */
interface TrainingVideo {
  slug: string;
  title: string;
  src: string;
}

interface DayRow {
  date: string;
  label: string;
  count: number;
}

const WEEKDAYS_AHEAD = 15;

/** How far past the furthest-watched point a video may jump before we treat it
 *  as a fast-forward attempt and snap it back. Generous enough for normal
 *  timeupdate granularity, tight enough to block scrubbing ahead. */
const FORWARD_TOLERANCE_SEC = 1.5;

@Component({
  selector: 'app-schedule',
  imports: [ReactiveFormsModule, RouterLink, MonthCalendar],
  templateUrl: './schedule.html',
  styleUrl: './schedule.scss',
})
export class Schedule implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly shiftsService = inject(ShiftsService);
  private readonly myShifts = inject(MyShiftsService);
  private readonly enrollmentService = inject(EnrollmentService);
  protected readonly auth = inject(VolunteerAuthService);

  // ---- Training videos / enrollment progress (logged-in) ----
  // Slugs MUST match the API's TRAINING_VIDEOS (api/src/models.ts).
  protected readonly trainingVideos: TrainingVideo[] = [
    {
      slug: 'foundational-playground-practices',
      title: 'Foundational Playground Practices',
      src: 'https://aheswatchdogsmedia.blob.core.windows.net/media/foundational-playground-practices.mp4',
    },
    {
      slug: 'supporting-conflict-resolution',
      title: 'Supporting Conflict Resolution',
      src: 'https://aheswatchdogsmedia.blob.core.windows.net/media/supporting-conflict-resolution.mp4',
    },
  ];
  protected readonly enrollment = signal<EnrollmentState | null>(null);
  /** Slug currently being saved after its video ended (shows a "Saving…" hint). */
  protected readonly savingVideo = signal<string | null>(null);
  /** The gate's <video> elements — used to enforce one-at-a-time playback. */
  private readonly videoEls = viewChildren<ElementRef<HTMLVideoElement>>('vid');
  /** Furthest point (seconds) each video has been watched to, so the volunteer
   *  can't scrub ahead. Not persisted — resets per page load until the video is
   *  marked watched, after which seeking is unrestricted. */
  private readonly watchedTo = new Map<string, number>();

  protected readonly calMonth = signal(this.firstOfThisMonth());
  protected readonly loading = signal(true);

  /** Logged-out: per-day counts. Logged-in: per-day roster (names). */
  private readonly counts = signal<Map<string, number>>(new Map());
  private readonly roster = signal<Map<string, RosterPerson[]>>(new Map());
  /** The signed-in volunteer's own upcoming dates. */
  protected readonly myDates = signal<string[]>([]);
  /** Day whose roster panel is open (logged-in). */
  protected readonly selectedDate = signal<string | null>(null);

  // ---- Login flow ----
  protected readonly loginStep = signal<'email' | 'code'>('email');
  protected readonly requesting = signal(false);
  protected readonly verifying = signal(false);
  protected readonly loginError = signal<string | null>(null);
  protected readonly loginInfo = signal<string | null>(null);
  protected readonly notRegistered = signal(false);

  protected readonly emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly codeForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  // ---- Action feedback (sign up / remove) ----
  protected readonly actionError = signal<string | null>(null);
  protected readonly working = signal(false);

  // ---- My account (self-service edit) ----
  protected readonly shirtSizes = SHIRT_SIZES;
  protected readonly myAccount = signal<MyAccount | null>(null);
  protected readonly editingAccount = signal(false);
  protected readonly accountDraft = signal<MyAccountUpdate | null>(null);
  protected readonly savingAccount = signal(false);
  protected readonly accountError = signal<string | null>(null);
  protected readonly accountSaved = signal(false);

  // ---- Delete-account flow ----
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);
  /** Shown in the logged-out view after a successful account deletion. */
  protected readonly accountDeleted = signal(false);

  constructor() {
    // Reload schedule data whenever auth state flips (sign in / out).
    let prev = this.auth.loggedIn();
    effect(() => {
      const now = this.auth.loggedIn();
      if (now !== prev) {
        prev = now;
        this.selectedDate.set(null);
        this.counts.set(new Map());
        this.roster.set(new Map());
        this.enrollment.set(null);
        this.reloadCurrentAndMine();
      }
    });
  }

  ngOnInit(): void {
    // If we have a stored session, confirm it's still valid before trusting it.
    if (this.auth.loggedIn()) {
      this.myShifts.session().subscribe({
        next: () => this.reloadCurrentAndMine(),
        error: () => {
          this.auth.signOut();
          this.reloadCurrentAndMine();
        },
      });
    } else {
      this.reloadCurrentAndMine();
    }
  }

  // ---------- data loading ----------

  private reloadCurrentAndMine(): void {
    const today = this.iso(new Date());
    const monthEnd = this.iso(
      new Date(this.calMonth().getFullYear(), this.calMonth().getMonth() + 1, 0),
    );
    const to = monthEnd > this.addDays(today, 56) ? monthEnd : this.addDays(today, 56);
    const from = today < this.iso(this.calMonth()) ? today : this.iso(this.calMonth());
    this.loadRange(from, to, true);
    if (this.auth.loggedIn()) {
      this.loadMyDates();
      this.loadEnrollment();
      this.loadAccount();
    }
  }

  private loadAccount(): void {
    this.myShifts.account().subscribe({
      next: (a) => this.myAccount.set(a),
      error: () => {},
    });
  }

  private loadMyDates(): void {
    this.myShifts.myDates().subscribe({
      next: ({ dates }) => this.myDates.set(dates),
      error: () => {},
    });
  }

  private loadEnrollment(): void {
    this.enrollmentService.get().subscribe({
      next: (state) => this.enrollment.set(state),
      error: () => {},
    });
  }

  // ---------- training videos ----------

  protected isWatched(slug: string): boolean {
    return this.enrollment()?.videos.find((v) => v.slug === slug)?.watched ?? false;
  }

  protected readonly allVideosWatched = computed(
    () => this.enrollment()?.trainingVideosCompleted ?? false,
  );

  /** One video plays at a time: starting one pauses all the others. */
  protected onVideoPlay(event: Event): void {
    const playing = event.target as HTMLVideoElement;
    for (const ref of this.videoEls()) {
      if (ref.nativeElement !== playing) ref.nativeElement.pause();
    }
  }

  /** Block fast-forwarding: a video may only advance to where it's already been
   *  watched (plus a small tolerance for normal playback). Jumps ahead snap back
   *  to the furthest-watched point. Rewinding is always allowed, and once a
   *  video is marked watched, seeking is unrestricted. */
  protected onVideoProgress(event: Event, slug: string): void {
    if (this.isWatched(slug)) return;
    const el = event.target as HTMLVideoElement;
    const limit = this.watchedTo.get(slug) ?? 0;
    if (el.currentTime > limit + FORWARD_TOLERANCE_SEC) {
      el.currentTime = limit; // tried to skip ahead — pull it back
    } else if (el.currentTime > limit) {
      this.watchedTo.set(slug, el.currentTime); // normal playback — advance the limit
    }
  }

  /** A training video reached its end → record completion for this volunteer. */
  protected onVideoEnded(slug: string): void {
    if (this.isWatched(slug) || this.savingVideo()) return;
    this.savingVideo.set(slug);
    this.enrollmentService.markVideoWatched(slug).subscribe({
      next: (state) => {
        this.enrollment.set(state);
        this.savingVideo.set(null);
      },
      error: () => this.savingVideo.set(null),
    });
  }

  private loadRange(from: string, to: string, initial = false): void {
    if (initial) this.loading.set(true);
    if (this.auth.loggedIn()) {
      this.myShifts.roster(from, to).subscribe({
        next: ({ days }) => {
          this.roster.update((prev) => {
            const next = new Map(prev);
            this.pruneRange(next, from, to);
            for (const d of days) next.set(d.date, d.people);
            return next;
          });
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    } else {
      this.shiftsService.counts(from, to).subscribe({
        next: ({ days }) => {
          this.counts.update((prev) => {
            const next = new Map(prev);
            this.pruneRange(next, from, to);
            for (const d of days) next.set(d.date, d.count);
            return next;
          });
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  private pruneRange<T>(map: Map<string, T>, from: string, to: string): void {
    for (const key of map.keys()) if (key >= from && key <= to) map.delete(key);
  }

  protected onMonthChange(month: Date): void {
    this.calMonth.set(month);
    const from = this.iso(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = this.iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    this.loadRange(from, to);
  }

  /** Pull the latest counts/roster (and my days) — so a volunteer sees others'
   *  recent sign-ups/removals without reloading the page. */
  protected refresh(): void {
    this.reloadCurrentAndMine();
  }

  // ---------- derived views ----------

  protected countFor(date: string): number {
    if (this.auth.loggedIn()) return this.roster().get(date)?.length ?? 0;
    return this.counts().get(date) ?? 0;
  }

  protected rosterFor(date: string): RosterPerson[] {
    return this.roster().get(date) ?? [];
  }

  protected isMine(date: string): boolean {
    return this.myDates().includes(date);
  }

  protected isSelected(date: string): boolean {
    return this.selectedDate() === date;
  }

  /** Mobile upcoming-days list (logged-out informational + logged-in pickable). */
  protected readonly upcomingDays = computed<DayRow[]>(() => {
    // depend on whichever map is active
    this.counts();
    this.roster();
    const labelFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const rows: DayRow[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    while (rows.length < WEEKDAYS_AHEAD) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        const iso = this.iso(cursor);
        rows.push({ date: iso, label: labelFmt.format(cursor), count: this.countFor(iso) });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
  });

  /** My upcoming days with friendly labels, for the "My days" panel. */
  protected readonly myDayRows = computed<DayRow[]>(() => {
    const labelFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    return this.myDates()
      .filter((d) => d >= this.iso(new Date()))
      .sort((a, b) => a.localeCompare(b))
      .map((d) => ({ date: d, label: labelFmt.format(new Date(`${d}T00:00:00`)), count: 0 }));
  });

  protected labelFor(date: string): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${date}T00:00:00`));
  }

  // ---------- day selection + actions ----------

  protected pick(date: string): void {
    if (!this.auth.loggedIn()) return; // logged-out: cells are informational
    this.actionError.set(null);
    this.selectedDate.set(this.selectedDate() === date ? null : date);
  }

  protected signUpDay(date: string): void {
    if (this.working()) return;
    this.working.set(true);
    this.actionError.set(null);
    this.myShifts.signUp(date).subscribe({
      next: () => {
        this.working.set(false);
        this.afterChange(date);
      },
      error: (err) => {
        this.working.set(false);
        this.actionError.set(err?.error?.errors?.[0] ?? 'Could not sign up. Please try again.');
      },
    });
  }

  protected removeDay(date: string): void {
    if (this.working()) return;
    this.working.set(true);
    this.actionError.set(null);
    this.myShifts.remove(date).subscribe({
      next: () => {
        this.working.set(false);
        this.afterChange(date);
      },
      error: (err) => {
        this.working.set(false);
        this.actionError.set(err?.error?.errors?.[0] ?? 'Could not remove. Please try again.');
      },
    });
  }

  /** Refresh the affected month + my-days after a sign up/remove. */
  private afterChange(date: string): void {
    const d = new Date(`${date}T00:00:00`);
    const from = this.iso(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = this.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    this.loadRange(from, to);
    this.loadMyDates();
  }

  // ---------- login flow ----------

  protected requestCode(): void {
    if (this.emailForm.invalid || this.requesting()) {
      this.emailForm.markAllAsTouched();
      return;
    }
    this.requesting.set(true);
    this.loginError.set(null);
    this.loginInfo.set(null);
    this.notRegistered.set(false);
    this.accountDeleted.set(false);
    const email = this.emailForm.controls.email.value.trim().toLowerCase();
    this.auth.requestCode(email).subscribe({
      next: () => {
        this.requesting.set(false);
        this.loginStep.set('code');
        this.loginInfo.set(`We emailed a 6-digit code to ${email}. It expires in 10 minutes.`);
      },
      error: (err) => {
        this.requesting.set(false);
        if (err?.status === 404 && err?.error?.notRegistered) {
          this.notRegistered.set(true);
        }
        this.loginError.set(
          err?.error?.errors?.[0] ?? 'Could not send your code. Please try again.',
        );
      },
    });
  }

  protected verifyCode(): void {
    if (this.codeForm.invalid || this.verifying()) {
      this.codeForm.markAllAsTouched();
      return;
    }
    this.verifying.set(true);
    this.loginError.set(null);
    const email = this.emailForm.controls.email.value.trim().toLowerCase();
    const code = this.codeForm.controls.code.value.trim();
    this.auth.verifyCode(email, code).subscribe({
      next: () => {
        this.verifying.set(false);
        this.codeForm.reset({ code: '' });
        this.loginInfo.set(null);
        // auth.loggedIn() flips → the effect reloads data.
      },
      error: (err) => {
        this.verifying.set(false);
        this.loginError.set(err?.error?.errors?.[0] ?? 'That code didn’t work. Try again.');
      },
    });
  }

  protected resetLogin(): void {
    this.loginStep.set('email');
    this.codeForm.reset({ code: '' });
    this.loginError.set(null);
    this.loginInfo.set(null);
    this.notRegistered.set(false);
  }

  protected signOut(): void {
    this.auth.signOut();
    this.myDates.set([]);
    this.selectedDate.set(null);
    this.enrollment.set(null);
    this.watchedTo.clear();
    this.myAccount.set(null);
    this.cancelEditAccount();
    this.accountSaved.set(false);
    this.confirmingDelete.set(false);
    this.resetLogin();
    this.emailForm.reset({ email: '' });
  }

  // ---- my account edit ----

  protected startEditAccount(): void {
    const a = this.myAccount();
    if (!a) return;
    this.accountError.set(null);
    this.accountSaved.set(false);
    this.accountDraft.set({
      name: a.name,
      mobile: a.mobile,
      students: a.students,
      availability: a.availability,
      shirtSize: a.shirtSize,
    });
    this.editingAccount.set(true);
  }

  protected cancelEditAccount(): void {
    this.editingAccount.set(false);
    this.accountDraft.set(null);
    this.accountError.set(null);
  }

  protected patchAccount<K extends keyof MyAccountUpdate>(field: K, value: MyAccountUpdate[K]): void {
    this.accountDraft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  protected saveAccount(): void {
    const draft = this.accountDraft();
    if (!draft || this.savingAccount()) return;
    if (!draft.name.trim() || !draft.mobile.trim()) {
      this.accountError.set('Name and mobile are required.');
      return;
    }
    this.savingAccount.set(true);
    this.accountError.set(null);
    this.myShifts.updateAccount(draft).subscribe({
      next: () => {
        this.savingAccount.set(false);
        this.editingAccount.set(false);
        this.accountSaved.set(true);
        // Reflect locally + refresh rosters (the denormalized name may have changed).
        this.myAccount.update((a) => (a ? { ...a, ...draft } : a));
        this.accountDraft.set(null);
        this.reloadCurrentAndMine();
      },
      error: (err) => {
        this.savingAccount.set(false);
        this.accountError.set(err?.error?.errors?.[0] ?? 'Could not save your changes. Please try again.');
      },
    });
  }

  // ---- delete account ----

  protected askDelete(): void {
    this.deleteError.set(null);
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  protected deleteAccount(): void {
    if (this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.myShifts.deleteAccount().subscribe({
      next: () => {
        this.deleting.set(false);
        this.confirmingDelete.set(false);
        // Account is gone — drop the session and show a confirmation.
        this.signOut();
        this.accountDeleted.set(true);
      },
      error: (err) => {
        this.deleting.set(false);
        this.deleteError.set(
          err?.error?.errors?.[0] ?? 'Could not delete your account. Please try again.',
        );
      },
    });
  }

  // ---------- date helpers ----------

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
}
