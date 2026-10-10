'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type AccountRole = 'NRI' | 'AGENT' | 'ADMIN' | 'AUDITOR';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: AccountRole;
  status: string;
  originCountry?: string | null;
  currentCountry?: string | null;
  timeZone?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type JsonRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
type SessionContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  request: JsonRequest;
  signIn: (email: string, password: string, totp?: string) => Promise<{ mfaSetupRequired: boolean; role: AccountRole }>;
  setupMfa: () => Promise<{ secret: string; otpauthUrl: string }>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function sendRequest(path: string, options: RequestInit = {}, accessToken?: string): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(`/api/v1/${path.replace(/^\/+/, '')}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const body: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const message = typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : `The request failed (${response.status}).`;
    throw new ApiError(message, response.status, typeof record.code === 'string' ? record.code : undefined);
  }

  return body as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useRef<string | null>(null);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const response = await sendRequest('auth/refresh', { method: 'POST' });
    if (!response.ok) {
      if (response.status === 401) return null;
      await parseResponse(response);
    }
    const result = await parseResponse<{ accessToken: string }>(response);
    accessToken.current = result.accessToken;
    return result.accessToken;
  }, []);

  const request = useCallback<JsonRequest>(async (path, options = {}) => {
    let token = accessToken.current;
    let response = await sendRequest(path, options, token ?? undefined);
    if (response.status === 401 && token) {
      token = await refreshSession();
      if (!token) {
        accessToken.current = null;
        setUser(null);
        throw new ApiError('Your session has expired. Sign in again.', 401, 'SESSION_EXPIRED');
      }
      response = await sendRequest(path, options, token);
    }
    return parseResponse(response);
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string, totp?: string) => {
    const response = await sendRequest('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) })
    });
    const result = await parseResponse<{ accessToken: string; user: AuthUser; mfaSetupRequired?: boolean }>(response);
    accessToken.current = result.accessToken;
    setUser(result.user);
    setError(null);
    return { mfaSetupRequired: result.mfaSetupRequired === true, role: result.user.role };
  }, []);

  const setupMfa = useCallback(() => request<{ secret: string; otpauthUrl: string }>('auth/mfa/setup', { method: 'POST' }), [request]);

  const verifyMfa = useCallback(async (code: string) => {
    const result = await request<{ accessToken: string }>('auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    accessToken.current = result.accessToken;
  }, [request]);

  const signOut = useCallback(async () => {
    try {
      await sendRequest('auth/logout', { method: 'POST' });
    } finally {
      accessToken.current = null;
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const token = await refreshSession();
        if (!active || !token) return;
        const response = await sendRequest('me', {}, token);
        const profile = await parseResponse<AuthUser>(response);
        if (active) {
          setUser(profile);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          accessToken.current = null;
          if (!(cause instanceof ApiError && cause.status === 401)) {
            setError(cause instanceof Error ? cause.message : 'Unable to restore your session.');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, [refreshSession]);

  return (
    <SessionContext.Provider value={{ user, loading, error, request, signIn, setupMfa, verifyMfa, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within SessionProvider.');
  return session;
}
