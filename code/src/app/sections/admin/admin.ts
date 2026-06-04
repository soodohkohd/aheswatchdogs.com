import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';

import { AuthService } from '../../auth.service';
import { Account, AccountStatus, AccountUpdate, AdminService, RosterDay } from '../../admin.service';
import { MonthCalendar } from '../../shared/month-calendar/month-calendar';

type AdminTab = 'schedule' | 'accounts';

interface CreateDraft {
  name: string;
  email: string;
  mobile: string;
  shirtSize: string;
  students: string;
  availability: string;
}

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

/** Accounts per page on the Accounts tab. */
const ACCOUNTS_PAGE_SIZE = 10;

type StatusFilter = 'all' | AccountStatus;

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
  /** Manual "add by name" override (coordinator). */
  protected readonly manualName = signal('');
  protected readonly addingManual = signal(false);
  /** "Add existing account-holder to a day" picker (schedule day panel). */
  protected readonly pickedVolunteerId = signal('');
  protected readonly addingExisting = signal(false);
  protected readonly gsiReady = signal(false);
  protected readonly justSignedOut = signal(false);

  // ---- Accounts tab ----
  protected readonly activeTab = signal<AdminTab>('schedule');
  protected readonly accounts = signal<Account[]>([]);
  protected readonly accountsLoading = signal(false);
  protected readonly accountsError = signal<string | null>(null);
  protected readonly accountNotice = signal<string | null>(null);
  /** Id of the account a row-action is in flight for (disables its buttons). */
  protected readonly accountBusy = signal<string | null>(null);
  /** Id of the account being edited inline, and its working draft. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal<AccountUpdate | null>(null);
  /** Id pending a delete confirmation. */
  protected readonly confirmDeleteId = signal<string | null>(null);
  protected readonly shirtSizes = ['S', 'M', 'L', 'XL', 'XXL'];
  /** Editable statuses — `pending` is omitted: a pending account must be
   *  Approved or Denied first (it isn't editable). */
  protected readonly statuses: AccountStatus[] = ['active', 'inactive', 'denied'];

  protected readonly pendingCount = computed(
    () => this.accounts().filter((a) => a.status === 'pending').length,
  );

  /** Active accounts, sorted by first name (then full name) — the picker for
   *  adding existing volunteers to a day. */
  protected readonly activeAccounts = computed(() => {
    const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
    return this.accounts()
      .filter((a) => a.status === 'active')
      .sort((x, y) => firstName(x.name).localeCompare(firstName(y.name)) || x.name.localeCompare(y.name));
  });

  // ---- Create account (coordinator) ----
  protected readonly showCreate = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly createDraft = signal<CreateDraft>({
    name: '',
    email: '',
    mobile: '',
    shirtSize: 'M',
    students: '',
    availability: '',
  });

  // ---- search / filter / pagination ----
  protected readonly searchTerm = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly page = signal(1);
  protected readonly statusFilters: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'denied', label: 'Denied' },
  ];

  /** Accounts after status filter + text search (name/email/mobile/students). */
  protected readonly filteredAccounts = computed<Account[]>(() => {
    const q = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    return this.accounts().filter((a) => {
      if (status !== 'all' && a.status !== status) return false;
      if (q) {
        const hay = `${a.name} ${a.email} ${a.mobile} ${a.students}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredAccounts().length / ACCOUNTS_PAGE_SIZE)),
  );
  /** Page clamped to the valid range (filtered list can shrink under us). */
  protected readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));

  protected readonly pagedAccounts = computed<Account[]>(() => {
    const start = (this.currentPage() - 1) * ACCOUNTS_PAGE_SIZE;
    return this.filteredAccounts().slice(start, start + ACCOUNTS_PAGE_SIZE);
  });

  protected readonly rangeStart = computed(() =>
    this.filteredAccounts().length === 0 ? 0 : (this.currentPage() - 1) * ACCOUNTS_PAGE_SIZE + 1,
  );
  protected readonly rangeEnd = computed(() =>
    Math.min(this.currentPage() * ACCOUNTS_PAGE_SIZE, this.filteredAccounts().length),
  );

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
    this.activeTab.set('schedule');
    this.accounts.set([]);
    this.cancelEdit();
    this.confirmDeleteId.set(null);
    this.accountNotice.set(null);
    this.accountsError.set(null);
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.page.set(1);
    this.showCreate.set(false);
    this.pickedVolunteerId.set('');
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

  /** Initial load: cover the mobile upcoming window + the current month, and
   *  load accounts so the Accounts tab badge (pending count) is populated as
   *  soon as the coordinator signs in — not only when they open the tab. */
  private loadInitial(): void {
    const today = this.iso(new Date());
    const { from } = this.monthBounds(this.calMonth());
    this.loadRange(from < today ? from : today, this.addDays(today, 56));
    this.loadAccounts();
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
    this.manualName.set('');
    this.pickedVolunteerId.set('');
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${iso}T00:00:00`));
  }

  /** Coordinator override: add a typed name to the given day (no account). */
  protected addManual(date: string): void {
    const name = this.manualName().trim();
    if (!name || this.addingManual()) return;
    this.addingManual.set(true);
    this.authError.set(null);
    this.adminService.addShift(date, name).subscribe({
      next: () => {
        this.addingManual.set(false);
        this.manualName.set('');
        const { from, to } = this.monthBounds(new Date(`${date}T00:00:00`));
        this.loadRange(from, to);
      },
      error: (err) => {
        this.addingManual.set(false);
        this.authError.set(err?.error?.errors?.[0] ?? 'Could not add that person. Please try again.');
      },
    });
  }

  /** Add an existing active account-holder to the given day. */
  protected addExisting(date: string): void {
    const id = this.pickedVolunteerId();
    if (!id || this.addingExisting()) return;
    this.addingExisting.set(true);
    this.authError.set(null);
    this.adminService.addAccountShift(date, id).subscribe({
      next: () => {
        this.addingExisting.set(false);
        this.pickedVolunteerId.set('');
        const { from, to } = this.monthBounds(new Date(`${date}T00:00:00`));
        this.loadRange(from, to);
      },
      error: (err) => {
        this.addingExisting.set(false);
        this.authError.set(err?.error?.errors?.[0] ?? 'Could not add that volunteer. Please try again.');
      },
    });
  }

  // ---- create account (coordinator) ----

  protected openCreate(): void {
    // Creating and editing are mutually exclusive — close any in-progress edit.
    this.cancelEdit();
    this.confirmDeleteId.set(null);
    this.createError.set(null);
    this.createDraft.set({ name: '', email: '', mobile: '', shirtSize: 'M', students: '', availability: '' });
    this.showCreate.set(true);
  }

  protected cancelCreate(): void {
    this.showCreate.set(false);
    this.createError.set(null);
  }

  protected patchCreate(field: keyof CreateDraft, value: string): void {
    this.createDraft.update((d) => ({ ...d, [field]: value }));
  }

  protected submitCreate(): void {
    const d = this.createDraft();
    if (this.creating()) return;
    if (!d.name.trim() || !d.email.trim() || !d.mobile.trim()) {
      this.createError.set('Name, email, and mobile are required.');
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    this.accountNotice.set(null);
    this.adminService
      .createAccount({
        name: d.name.trim(),
        email: d.email.trim(),
        mobile: d.mobile.trim(),
        shirtSize: d.shirtSize,
        students: d.students.trim(),
        availability: d.availability.trim(),
      })
      .subscribe({
        next: (res) => {
          this.creating.set(false);
          this.showCreate.set(false);
          this.accountNotice.set(
            res.emailError
              ? `${d.name.trim()} created (active), but the welcome email failed to send.`
              : `${d.name.trim()} created and activated — welcome email sent.`,
          );
          this.loadAccounts();
        },
        error: (err) => {
          this.creating.set(false);
          this.createError.set(err?.error?.errors?.[0] ?? 'Could not create the account. Please try again.');
        },
      });
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

  // ---------- Accounts tab ----------

  protected setTab(tab: AdminTab): void {
    this.activeTab.set(tab);
    if (tab === 'accounts' && this.accounts().length === 0) this.loadAccounts();
  }

  protected loadAccounts(): void {
    this.accountsLoading.set(true);
    this.accountsError.set(null);
    this.adminService.accounts().subscribe({
      next: ({ accounts }) => {
        this.accounts.set(accounts);
        this.accountsLoading.set(false);
      },
      error: () => {
        this.accountsLoading.set(false);
        this.accountsError.set('Could not load accounts. Try signing in again.');
      },
    });
  }

  protected statusLabel(s: AccountStatus): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
    this.page.set(1);
  }

  protected onStatusFilter(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(1);
  }

  protected prevPage(): void {
    this.page.set(Math.max(1, this.currentPage() - 1));
  }

  protected nextPage(): void {
    this.page.set(Math.min(this.totalPages(), this.currentPage() + 1));
  }

  /** Optimistically set an account's status locally for instant feedback. */
  private setLocalStatus(id: string, status: AccountStatus): void {
    this.accounts.update((list) => list.map((x) => (x.id === id ? { ...x, status } : x)));
  }

  protected approve(a: Account): void {
    if (this.accountBusy()) return;
    this.accountBusy.set(a.id);
    this.accountsError.set(null);
    this.accountNotice.set(null);
    this.setLocalStatus(a.id, 'active'); // instant feedback; reconciled below
    this.adminService.approveAccount(a.id).subscribe({
      next: (res) => {
        this.accountBusy.set(null);
        this.accountNotice.set(
          res.emailError
            ? `${a.name} approved, but the welcome email failed to send.`
            : `${a.name} approved — welcome email sent.`,
        );
        this.loadAccounts();
      },
      error: (err) => {
        this.accountBusy.set(null);
        this.accountsError.set(err?.error?.errors?.[0] ?? 'Could not approve. Please try again.');
        this.loadAccounts(); // revert the optimistic change to server truth
      },
    });
  }

  protected deny(a: Account): void {
    if (this.accountBusy()) return;
    this.accountBusy.set(a.id);
    this.accountsError.set(null);
    this.accountNotice.set(null);
    this.setLocalStatus(a.id, 'denied'); // instant feedback; reconciled below
    this.adminService.denyAccount(a.id).subscribe({
      next: () => {
        this.accountBusy.set(null);
        this.accountNotice.set(`${a.name} denied.`);
        this.loadAccounts();
      },
      error: (err) => {
        this.accountBusy.set(null);
        this.accountsError.set(err?.error?.errors?.[0] ?? 'Could not deny. Please try again.');
        this.loadAccounts(); // revert the optimistic change to server truth
      },
    });
  }

  // ---- inline edit ----

  protected startEdit(a: Account): void {
    if (a.status === 'pending') return; // must be approved/denied first
    this.showCreate.set(false); // don't edit while creating a new account
    this.confirmDeleteId.set(null);
    this.editingId.set(a.id);
    this.editDraft.set({
      id: a.id,
      name: a.name,
      email: a.email,
      mobile: a.mobile,
      students: a.students,
      availability: a.availability,
      shirtSize: a.shirtSize,
      // Pending accounts aren't editable; legacy/unknown defaults to active.
      status: a.status === 'active' || a.status === 'inactive' || a.status === 'denied' ? a.status : 'active',
      ptaRegistered: a.enrollment.ptaRegistered,
      videosWatched: a.enrollment.videos.filter((v) => v.watched).map((v) => v.slug),
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set(null);
  }

  /** Patch a single field on the working edit draft. */
  protected patchDraft<K extends keyof AccountUpdate>(field: K, value: AccountUpdate[K]): void {
    this.editDraft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  protected toggleVideo(slug: string, watched: boolean): void {
    this.editDraft.update((d) => {
      if (!d) return d;
      const set = new Set(d.videosWatched);
      if (watched) set.add(slug);
      else set.delete(slug);
      return { ...d, videosWatched: [...set] };
    });
  }

  protected saveEdit(): void {
    const draft = this.editDraft();
    if (!draft || this.accountBusy()) return;
    this.accountBusy.set(draft.id);
    this.accountsError.set(null);
    this.accountNotice.set(null);
    this.adminService.updateAccount(draft).subscribe({
      next: () => {
        this.accountBusy.set(null);
        this.accountNotice.set(`${draft.name} updated.`);
        this.cancelEdit();
        this.loadAccounts();
      },
      error: (err) => {
        this.accountBusy.set(null);
        this.accountsError.set(err?.error?.errors?.[0] ?? 'Could not save changes. Please try again.');
      },
    });
  }

  // ---- delete ----

  protected askDeleteAccount(a: Account): void {
    this.editingId.set(null);
    this.confirmDeleteId.set(a.id);
  }

  protected cancelDeleteAccount(): void {
    this.confirmDeleteId.set(null);
  }

  protected confirmDeleteAccount(a: Account): void {
    if (this.accountBusy()) return;
    this.accountBusy.set(a.id);
    this.accountsError.set(null);
    this.accountNotice.set(null);
    this.adminService.deleteAccount(a.id).subscribe({
      next: () => {
        this.accountBusy.set(null);
        this.confirmDeleteId.set(null);
        this.accountNotice.set(`${a.name}'s account was deleted.`);
        this.loadAccounts();
      },
      error: (err) => {
        this.accountBusy.set(null);
        this.accountsError.set(err?.error?.errors?.[0] ?? 'Could not delete the account. Please try again.');
      },
    });
  }

  protected formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  }
}
