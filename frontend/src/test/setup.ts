import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import { server } from '@/mocks/server';

// Silence expected console noise (retry warnings, error handler logs, etc.)
// Real errors still surface as test failures — this just keeps the output clean.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  vi.restoreAllMocks();
});


