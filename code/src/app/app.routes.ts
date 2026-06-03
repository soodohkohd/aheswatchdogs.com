import { Routes } from '@angular/router';

/** Per-route description used as both the <meta name="description"> value and
 *  the OG/Twitter card description on share previews. Read by a single
 *  NavigationEnd subscriber in app.config.ts so components don't each
 *  duplicate the Meta-service plumbing. */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./sections/home/home').then((m) => m.Home),
    title: 'AHES Watch D.O.G.S.',
    data: {
      description:
        'Antelope Hills Elementary School Watch D.O.G.S. — who we are, why we serve, and how to join Watch D.O.G.S. on campus.',
    },
  },
  {
    path: 'guidelines',
    loadComponent: () => import('./sections/guidelines/guidelines').then((m) => m.Guidelines),
    title: 'Guidelines — AHES Watch D.O.G.S.',
    data: {
      description:
        'Watch D.O.G.S. volunteer guidelines: hours and check-in, the Do’s and Don’ts, and what to expect when serving on campus.',
    },
  },
  {
    path: 'enroll',
    loadComponent: () => import('./sections/enroll/enroll').then((m) => m.Enroll),
    title: 'Join — AHES Watch D.O.G.S.',
    data: {
      description:
        'Join Antelope Hills Watch D.O.G.S.: complete the registration form, register with the AHES PTA, and finish the required training videos.',
    },
  },
  {
    path: 'schedule',
    loadComponent: () => import('./sections/schedule/schedule').then((m) => m.Schedule),
    title: 'Schedule — AHES Watch D.O.G.S.',
    data: {
      description: 'See which days Watch D.O.G.S. volunteers are on campus and sign up for a shift.',
    },
  },
  {
    path: 'admin',
    loadComponent: () => import('./sections/admin/admin').then((m) => m.Admin),
    title: 'Coordinator Admin — AHES Watch D.O.G.S.',
    data: { description: 'Coordinator dashboard for managing volunteers, enrollment, and shifts.' },
  },
  {
    path: '**',
    loadComponent: () => import('./sections/not-found/not-found').then((m) => m.NotFound),
    title: 'Page Not Found — AHES Watch D.O.G.S.',
    data: { description: 'The page you tried to reach doesn’t exist on aheswatchdogs.com.' },
  },
];
