import type { OAuthAccount } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};

const refreshLocks = new Map<string, Promise<OAuthAccount>>();

function form(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function exchangeAuthorizationCode(code: string, verifier: string): Promise<TokenResponse> {
  const response = await fetch(`${config.ML_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      client_id: config.ML_CLIENT_ID,
      client_secret: config.ML_CLIENT_SECRET,
      code,
      redirect_uri: config.ML_REDIRECT_URI,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new AppError(502, 'OAUTH_EXCHANGE_FAILED', 'O Mercado Livre recusou o código de autorização.', body);
  return body as TokenResponse;
}

async function refreshAccount(account: OAuthAccount): Promise<OAuthAccount> {
  if (!account.refreshTokenCipher) throw new AppError(401, 'RECONNECT_REQUIRED', 'Reconecte a conta do Mercado Livre.');
  const response = await fetch(`${config.ML_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'refresh_token',
      client_id: config.ML_CLIENT_ID,
      client_secret: config.ML_CLIENT_SECRET,
      refresh_token: decryptSecret(account.refreshTokenCipher),
    }),
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: { accessTokenCipher: null, refreshTokenCipher: null, revokedAt: new Date() },
    });
    throw new AppError(401, 'RECONNECT_REQUIRED', 'A autorização expirou ou foi revogada. Reconecte a conta.', body);
  }
  const token = body as TokenResponse;
  return prisma.oAuthAccount.update({
    where: { id: account.id },
    data: {
      accessTokenCipher: encryptSecret(token.access_token),
      refreshTokenCipher: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      lastRefreshAt: new Date(),
      revokedAt: null,
      tokenVersion: { increment: 1 },
    },
  });
}

export async function validAccount(accountId: string): Promise<OAuthAccount> {
  let account = await prisma.oAuthAccount.findUnique({ where: { id: accountId } });
  if (!account || account.disconnectedAt || !account.accessTokenCipher) {
    throw new AppError(401, 'RECONNECT_REQUIRED', 'Reconecte a conta do Mercado Livre.');
  }
  const refreshAt = Date.now() + config.REFRESH_SKEW_SECONDS * 1000;
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() > refreshAt) return account;
  const existing = refreshLocks.get(account.id);
  if (existing) return existing;
  const promise = refreshAccount(account).finally(() => refreshLocks.delete(account!.id));
  refreshLocks.set(account.id, promise);
  return promise;
}

function retryMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header && Number.isFinite(Number(header))) return Math.min(Number(header) * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 5_000) + Math.floor(Math.random() * 250);
}

export async function mlRequest<T>(accountId: string, path: string, init: RequestInit = {}): Promise<T> {
  let account = await validAccount(accountId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${config.ML_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
        authorization: `Bearer ${decryptSecret(account.accessTokenCipher!)}`,
      },
      signal: init.signal ?? AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return responseBody(response) as Promise<T>;
    if (response.status === 401 && attempt === 0) {
      account = await refreshAccount(account);
      continue;
    }
    const body = await responseBody(response);
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryMs(response, attempt)));
      continue;
    }
    throw new AppError(response.status, `ML_${response.status}`, 'O Mercado Livre não concluiu a solicitação.', body);
  }
  throw new AppError(502, 'ML_UNAVAILABLE', 'O Mercado Livre está temporariamente indisponível.');
}

export async function userProfile(accessToken: string): Promise<{ id: number; nickname: string; site_id?: string }> {
  const response = await fetch(`${config.ML_API_BASE_URL}/users/me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new AppError(502, 'PROFILE_FAILED', 'Não foi possível validar a conta autorizada.', body);
  return body as { id: number; nickname: string; site_id?: string };
}
