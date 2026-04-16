/**
 * Custom error class for HTTP errors.
 * This allows callers to inspect the full response object, including status, headers, and body.
 */
export class HttpError extends Error {
  response: Response;
  body: any;

  constructor(response: Response, body: any) {
    // Attempt to create a more descriptive error message from the response body if available.
    const detail = body?.detail || body?.message || response.statusText || 'Unknown error';
    const message = `HTTP Error: ${response.status} - ${detail}`;

    super(message);
    this.name = 'HttpError';
    this.response = response;
    this.body = body;
  }
}