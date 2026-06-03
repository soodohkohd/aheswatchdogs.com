import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ShiftsService } from '../../shifts.service';
import { MonthCalendar } from '../../shared/month-calendar/month-calendar';

interface DayRow {
  date: string;
  label: string;
  count: number;
}

/** Upcoming weekdays (Mon–Fri) shown in the mobile list. */
const WEEKDAYS_AHEAD = 15;

@Component({
  selector: 'app-schedule',
  imports: [ReactiveFormsModule, RouterLink, MonthCalendar],
  templateUrl: './schedule.html',
  styleUrl: './schedule.scss',
})
export class Schedule implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly shiftsService = inject(ShiftsService);

  /** Per-day counts keyed by ISO date, shared by the calendar + mobile list. */
  private readonly counts = signal<Map<string, number>>(new Map());
  protected readonly calMonth = signal(this.firstOfThisMonth());
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly confirmation = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    date: ['', Validators.required],
  });

  /** Next N weekdays from today, with counts merged in (mobile list + the
   *  sign-up <select> options). */
  protected readonly upcomingDays = computed<DayRow[]>(() => {
    const map = this.counts();
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
        rows.push({ date: iso, label: labelFmt.format(cursor), count: map.get(iso) ?? 0 });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
  });

  ngOnInit(): void {
    // Cover the mobile upcoming window (~3 weeks) and the current calendar month.
    const today = this.iso(new Date());
    const monthEnd = this.iso(new Date(this.calMonth().getFullYear(), this.calMonth().getMonth() + 1, 0));
    const to = monthEnd > this.addDays(today, 56) ? monthEnd : this.addDays(today, 56);
    this.loadRange(today < this.iso(this.calMonth()) ? today : this.iso(this.calMonth()), to, true);
  }

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

  private loadRange(from: string, to: string, initial = false): void {
    if (initial) this.loading.set(true);
    this.shiftsService.counts(from, to).subscribe({
      next: ({ days }) => {
        this.counts.update((prev) => {
          const next = new Map(prev);
          for (const d of days) next.set(d.date, d.count);
          return next;
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected onMonthChange(month: Date): void {
    this.calMonth.set(month);
    const from = this.iso(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = this.iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    this.loadRange(from, to);
  }

  protected countFor(date: string): number {
    return this.counts().get(date) ?? 0;
  }

  protected isSelected(date: string): boolean {
    return this.form.controls.date.value === date;
  }

  protected pick(date: string): void {
    this.form.controls.date.setValue(date);
    this.confirmation.set(null);
    this.error.set(null);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      this.confirmation.set(null);
      this.error.set('Please enter your registered email and choose a day.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.confirmation.set(null);

    const chosen = this.form.controls.date.value;
    this.shiftsService.signUp(this.form.getRawValue()).subscribe({
      next: () => {
        this.submitting.set(false);
        const label = this.upcomingDays().find((d) => d.date === chosen)?.label ?? chosen;
        this.confirmation.set(`You’re signed up for ${label}. Thank you! 🐾`);
        this.form.controls.date.reset('');
        // Refresh the chosen day's month so its count reflects the new sign-up
        // (don't move the calendar the user is looking at).
        const d = new Date(`${chosen}T00:00:00`);
        const from = this.iso(new Date(d.getFullYear(), d.getMonth(), 1));
        const to = this.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        this.loadRange(from, to);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.error?.errors?.[0] ??
            'Something went wrong signing up. Please try again, or email support@aheswatchdogs.com.',
        );
      },
    });
  }
}
