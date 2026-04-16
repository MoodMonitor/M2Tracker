import { describe, it, expect } from 'vitest';
import { HttpError } from '@/services/httpError';

describe('HttpError', () => {
  it('is an instance of Error', () => {
    const response = new Response(null, { status: 404, statusText: 'Not Found' });
    const err = new HttpError(response, null);
    expect(err).toBeInstanceOf(Error);
  });

  it('sets the name to HttpError', () => {
    const response = new Response(null, { status: 500, statusText: 'Server Error' });
    const err = new HttpError(response, null);
    expect(err.name).toBe('HttpError');
  });

  it('builds message from body.detail', () => {
    const response = new Response(null, { status: 400, statusText: 'Bad Request' });
    const err = new HttpError(response, { detail: 'Field required' });
    expect(err.message).toContain('400');
    expect(err.message).toContain('Field required');
  });

  it('builds message from body.message when detail is absent', () => {
    const response = new Response(null, { status: 422, statusText: 'Unprocessable' });
    const err = new HttpError(response, { message: 'Validation failed' });
    expect(err.message).toContain('Validation failed');
  });

  it('falls back to statusText when body has no detail/message', () => {
    const response = new Response(null, { status: 503, statusText: 'Service Unavailable' });
    const err = new HttpError(response, {});
    expect(err.message).toContain('Service Unavailable');
  });

  it('attaches response and body to the instance', () => {
    const response = new Response(null, { status: 401, statusText: 'Unauthorized' });
    const body = { detail: 'Token expired' };
    const err = new HttpError(response, body);
    expect(err.response).toBe(response);
    expect(err.body).toBe(body);
    expect(err.response.status).toBe(401);
  });
});

