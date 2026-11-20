import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { Tokens } from './types';

const baseURL = import.meta.env.DEV ? '/api/v1/' : (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/?$/, '/');
const key = 'stocksmart.session';
const transport = axios.create({ baseURL, timeout: 15000 });
export const api = axios.create({ baseURL, timeout: 15000, headers: { Accept: 'application/json' } });
let tokens: Tokens | null = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (typeof saved?.access === 'string' && typeof saved?.refresh === 'string') tokens = saved;
} catch { /* Storage may be unavailable. The session still works in memory. */ }
let version = 0;
let refresh: Promise<Tokens> | undefined;

export const session = {
  get: () => tokens,
  set(next: Tokens | null) {
    version += 1;
    tokens = next;
    refresh = undefined;
    persist();
  },
};

function persist() {
  try {
    if (tokens) sessionStorage.setItem(key, JSON.stringify(tokens));
    else sessionStorage.removeItem(key);
  } catch { /* Keep the active session in memory. */ }
}

type SessionRequest = InternalAxiosRequestConfig & { retried?: boolean; sessionVersion?: number };
const publicPaths = new Set(['auth/login/', 'auth/register/', 'auth/refresh/']);

api.interceptors.request.use((config: SessionRequest) => {
  config.sessionVersion = version;
  if (tokens && !publicPaths.has(config.url || '')) config.headers.set('Authorization', 'Bearer ' + tokens.access);
  return config;
});

api.interceptors.response.use((response) => response, async (error: AxiosError) => {
  const request = error.config as SessionRequest | undefined;
  if (error.response?.status !== 401 || !request || request.retried || !tokens || request.sessionVersion !== version
      || publicPaths.has(request.url || '') || request.url === 'auth/logout/') throw error;
  request.retried = true;
  const active = version;
  const staleHeader = request.headers.get('Authorization');
  if (staleHeader !== 'Bearer ' + tokens.access) return api.request(request);
  const pending = refresh ??= transport.post<Tokens>('auth/refresh/', { refresh: tokens.refresh }).then(({ data }) => {
    if (version !== active) throw new Error('The session changed.');
    tokens = data;
    persist();
    return data;
  }).catch((failure: unknown) => {
    if (version === active && axios.isAxiosError(failure) && [400, 401, 403].includes(failure.response?.status || 0)) {
      session.set(null);
      window.dispatchEvent(new Event('stocksmart:expired'));
    }
    throw failure;
  });
  try {
    await pending;
    if (version !== active) throw error;
    return api.request(request);
  } finally {
    if (refresh === pending) refresh = undefined;
  }
});

export function errorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : 'Something went wrong.';
  if (!error.response) return 'Unable to reach StockSmart. Check the backend connection and try again.';
  const data: unknown = error.response.data;
  if (typeof data === 'object' && data !== null) {
    const parts: string[] = [];
    function walk(value: unknown, path = '') {
      if (typeof value === 'string') parts.push(path ? path.replaceAll('_', ' ') + ': ' + value : value);
      else if (Array.isArray(value)) value.forEach((item) => walk(item, path));
      else if (typeof value === 'object' && value) {
        for (const [key, item] of Object.entries(value)) {
          if (key === 'code' || key === 'token_class' || key === 'token_type') continue;
          walk(item, ['detail', 'non_field_errors'].includes(key) ? path : [path, key].filter(Boolean).join(' › '));
        }
      }
    }
    walk(data);
    if (parts.length) return parts.join(' · ');
  }
  return error.response.status === 403 ? 'You do not have permission for this action.' : 'Request failed (' + error.response.status + ').';
}
