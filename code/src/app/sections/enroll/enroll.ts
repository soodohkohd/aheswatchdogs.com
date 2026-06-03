import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { SignupService } from '../../signup.service';
import { ShirtSize, SignupRequest } from '../../models';

@Component({
  selector: 'app-enroll',
  imports: [ReactiveFormsModule],
  templateUrl: './enroll.html',
  styleUrl: './enroll.scss',
})
export class Enroll {
  private readonly fb = inject(FormBuilder);
  private readonly signupService = inject(SignupService);

  protected readonly shirtSizes: ShirtSize[] = ['S', 'M', 'L', 'XL', 'XXL'];
  protected readonly ptaRegisterUrl =
    'https://jointotem.com/ca/murrieta/antelope-hills-elementary-pta/join/register';
  // Self-hosted in Azure Blob Storage (Range-capable, unlike pm2 serve — see
  // CLAUDE.md "Large media on blob storage").
  protected readonly trainingVideos = [
    {
      title: 'Foundational Playground Practices',
      src: 'https://aheswatchdogsmedia.blob.core.windows.net/media/foundational-playground-practices.mp4',
    },
    {
      title: 'Supporting Conflict Resolution',
      src: 'https://aheswatchdogsmedia.blob.core.windows.net/media/supporting-conflict-resolution.mp4',
    },
  ];

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly triedSubmit = signal(false);

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
