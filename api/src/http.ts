import { HttpResponseInit } from '@azure/functions';

/** CORS headers for browser calls from the SPA. In production set
 *  ALLOWED_ORIGIN to the site origin; defaults to '*' for local dev. */
export function corsHeaders(): Record<string, string> {
  const origin = process.env['ALLOWED_ORIGIN'] || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // Authorization is required for the admin (/manage/*) bearer token — without
    // it the browser's CORS preflight blocks authenticated requests.
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

/** Standard CORS preflight response. */
export function preflight(): HttpResponseInit {
  return { status: 204, headers: corsHeaders() };
}

/** JSON response with CORS headers attached. */
export function json(status: number, body: unknown): HttpResponseInit {
  return { status, headers: corsHeaders(), jsonBody: body };
}
