import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { VolunteerAuthService } from './volunteer-auth.service';

/** Attach the volunteer session token to /api/my/* requests only. */
export const volunteerAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(VolunteerAuthService).getToken();
  if (token && req.url.includes('/api/my')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
