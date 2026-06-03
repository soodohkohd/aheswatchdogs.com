import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, provideRouter, Router, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { filter } from 'rxjs/operators';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { adminAuthInterceptor } from './admin-auth.interceptor';
import { volunteerAuthInterceptor } from './volunteer-auth.interceptor';

const DEFAULT_DESCRIPTION =
  'Antelope Hills Elementary School Watch D.O.G.S. — program info, volunteer sign-up, and guidelines for serving on campus.';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([adminAuthInterceptor, volunteerAuthInterceptor])),
    provideRouter(
      routes,
      // Scroll to top on forward navigation; restore prior position on
      // back/forward — matches the native-app expectation.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    // Route-aware <meta> + OG/Twitter card updater. The defaults baked into
    // index.html cover crawlers that don't execute JS; this handles in-app
    // SPA navigations and modern crawlers that do. Each route's description
    // comes from `data.description` in app.routes.ts.
    provideAppInitializer(() => {
      if (typeof window === 'undefined') return;
      const router = inject(Router);
      const meta = inject(Meta);

      router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((event) => {
          let route = router.routerState.snapshot.root;
          while (route.firstChild) route = route.firstChild;
          const description =
            (route.data?.['description'] as string | undefined) ?? DEFAULT_DESCRIPTION;
          const url = `${environment.siteOrigin}${event.urlAfterRedirects}`;
          const title = document.title;

          meta.updateTag({ name: 'description', content: description });
          meta.updateTag({ property: 'og:title', content: title });
          meta.updateTag({ property: 'og:description', content: description });
          meta.updateTag({ property: 'og:url', content: url });
          meta.updateTag({ name: 'twitter:title', content: title });
          meta.updateTag({ name: 'twitter:description', content: description });

          const canonical = document.querySelector('link[rel="canonical"]');
          if (canonical) canonical.setAttribute('href', url);
        });
    }),
  ],
};
