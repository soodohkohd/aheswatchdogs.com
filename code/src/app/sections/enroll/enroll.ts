import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { SignupService } from '../../signup.service';
import { ShirtSize, SignupRequest } from '../../models';

@Component({
  selector: 'app-enroll',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './enroll.html',
  styleUrl: './enroll.scss',
})
export class Enroll {
  private readonly fb = inject(FormBuilder);
  private readonly signupService = inject(SignupService);

  protected readonly shirtSizes: ShirtSize[] = ['S', 'M', 'L', 'XL', 'XXL'];
  protected readonly ptaRegisterUrl =
    'https://jointotem.com/ca/murrieta/antelope-hills-elementary-pta/join/register';
  // Titles only — the actual players live on the signed-in Schedule portal,
  // where watching is tracked (see schedule.ts trainingVideos).
  protected readonly trainingVideos = [
    { title: 'Foundational Playground Practices' },
    { title: 'Supporting Conflict Resolution' },
  ];

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly triedSubmit = signal(false);
  /** The email just registered (shown in the success message). */
  protected readonly submittedEmail = signal('');

  /** The success card — scrolled into view once it renders after submitting. */
  private readonly successMsg = viewChild<ElementRef<HTMLElement>>('successMsg');

  constructor() {
    // When the success card appears (after a successful submit), scroll back to
    // the top of the page so the confirmation is the first thing they see.
    effect(() => {
      if (this.successMsg()) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    mobile: ['', Validators.required],
    students: [''], // optional
    availability: [''], // optional
    shirtSize: ['M' as ShirtSize, Validators.required],
  });

  /** Whether to surface a field's error — once it's been touched or a submit
   *  was attempted. Keeps the form quiet until the user has engaged. */
  protected showError(name: string): boolean {
    const control = this.form.get(name);
    return !!control && control.invalid && (control.touched || this.triedSubmit());
  }

  protected submit(): void {
    this.triedSubmit.set(true);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      this.error.set('Please fill in the required fields above, then submit again.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    this.submittedEmail.set(this.form.controls.email.value);
    this.signupService.submit(this.form.getRawValue() as SignupRequest).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.error?.errors?.[0] ??
            'Something went wrong submitting your registration. Please try again, or email support@aheswatchdogs.com.',
        );
      },
    });
  }
}
