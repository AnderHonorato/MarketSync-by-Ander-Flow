import type { NextFunction, Request, Response } from 'express';
import type { Session } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { csrfForSession, hashClientValue, randomOpaque, safeEqual, sha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

const sessionMaxAgeMs = config.SESSION_TTL_HOURS * 60 * 60 * 1000;

function setSessionCookie(res: Response, rawSessionId: string): void {
  res.cookie(config.SESSION_COOKIE_NAME, rawSessionId, {
    httpOnly: true,
    secure: config.COOKIE_SECURE || config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeMs,
  });
}

async function createSession(req: Request, res: Response): Promise<{ raw: string; session: Session }> {
  const raw = randomOpaque(32);
  const session = await prisma.session.create({
    data: {
      id: sha256(raw),
      expiresAt: new Date(Date.now() + sessionMaxAgeMs),
      userAgentHash: hashClientValue(req.get('user-agent')),
      ipHash: hashClientValue(req.ip),
    },
  });
  await prisma.auditEvent.create({
    data: {
      sessionId: session.id,
      action: 'session.start',
      outcome: 'SUCCESS',
      metadataJson: JSON.stringify({ source: 'browser' }),
      ipHash: hashClientValue(req.ip),
    },
  });
  setSessionCookie(res, raw);
  return { raw, session };
}

export async function ensureSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawCookie = req.cookies?.[config.SESSION_COOKIE_NAME];
    let session = typeof rawCookie === 'string'
      ? await prisma.session.findUnique({ where: { id: sha256(rawCookie) } })
      : null;
    let raw = typeof rawCookie === 'string' ? rawCookie : '';

    if (!session || session.expiresAt <= new Date()) {
      ({ raw, session } = await createSession(req, res));
    } else if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      session = await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    req.rawSessionId = raw;
    req.appSession = session;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthenticated(req: Request, _res: Response, next: NextFunction): void {
  if (!req.appSession?.accountId) {
    next(new AppError(401, 'AUTH_REQUIRED', 'Conecte uma conta do Mercado Livre.'));
    return;
  }
  next();
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const received = req.get('x-csrf-token') ?? '';
  const expected = req.rawSessionId ? csrfForSession(req.rawSessionId) : '';
  if (!received || !expected || !safeEqual(received, expected)) {
    next(new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente ou inválido.'));
    return;
  }
  next();
}

export function sessionView(req: Request): { authenticated: boolean; csrfToken: string; expiresAt: string } {
  if (!req.appSession || !req.rawSessionId) throw new AppError(500, 'SESSION_MISSING', 'Sessão indisponível.');
  return {
    authenticated: Boolean(req.appSession.accountId),
    csrfToken: csrfForSession(req.rawSessionId),
    expiresAt: req.appSession.expiresAt.toISOString(),
  };
}

export async function clearCurrentSession(req: Request, res: Response): Promise<void> {
  if (req.appSession) await prisma.session.update({
    where: { id: req.appSession.id },
    data: { expiresAt: new Date(), lastSeenAt: new Date() },
  }).catch(() => undefined);
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE || config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
