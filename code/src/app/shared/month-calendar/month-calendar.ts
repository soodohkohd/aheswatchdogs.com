import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, contentChild, input, output } from '@angular/core';

/** Context handed to the projected `#dayCell` template for each grid cell. */
export interface DayCellContext {
  $implicit: string; // ISO date (YYYY-MM-DD)
  day: number; // day-of-month
  inMonth: boolean; // belongs to the displayed month (vs. leading/trailing)
  isPast: boolean; // before today
  isToday: boolean;
  isWeekend: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Reusable month grid. The parent supplies a `#dayCell` template that renders
 * each day's content (count, roster, etc.) using the cell context. The
 * component owns the grid, weekday header, and prev/next navigation; it emits
 * `monthChange` so the parent can load data for the visible month.
 */
@Component({
  selector: 'app-month-calendar',
  imports: [NgTemplateOutlet],
  templateUrl: './month-calendar.html',
  styleUrl: './month-calendar.scss',
})
export class MonthCalendar {
  /** Any date within the month to display. */
  readonly month = input.required<Date>();
  readonly monthChange = output<Date>();

  protected readonly weekdays = WEEKDAYS;
  protected readonly dayCell = contentChild<TemplateRef<DayCellContext>>('dayCell');

  protected readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(this.month()),
  );

  protected readonly cells = computed<DayCellContext[]>(() => {
    const m = this.month();
    const year = m.getFullYear();
    const mon = m.getMonth();
    const first = new Date(year, mon, 1);
    const start = new Date(year, mon, 1 - first.getDay()); // back to the Sunday

    const now = new Date();
    const todayIso = this.iso(now);
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const out: DayCellContext[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = this.iso(d);
      out.push({
        $implicit: iso,
        day: d.getDate(),
        inMonth: d.getMonth() === mon,
        isPast: d.getTime() < todayMid,
        isToday: iso === todayIso,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return out;
  });

  private iso(d: Date): string {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  protected prev(): void {
    const m = this.month();
    this.monthChange.emit(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  protected next(): void {
    const m = this.month();
    this.monthChange.emit(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
}
