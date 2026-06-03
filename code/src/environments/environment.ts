/** Development environment. Swapped for environment.prod.ts in production
 *  builds via the `fileReplacements` entry in angular.json. */
export const environment = {
  production: false,
  // Relative path — the dev server proxies /api to the local Functions host
  // (http://localhost:7071) via proxy.conf.json, so the browser stays
  // same-origin and no CORS config is needed in dev.
  apiBaseUrl: '/api',
  // Public Google OAuth client ID for "Sign in with Google" admin auth.
  // Not a secret. http://localhost:4200 is an authorized origin on this client.
  googleClientId: '253413359966-8191ne4g1c7tgs1elksno6oceipljpjb.apps.googleusercontent.com',
  siteOrigin: 'http://localhost:4200',
};
