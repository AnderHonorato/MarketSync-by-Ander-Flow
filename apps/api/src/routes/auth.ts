import { Router } from 'express';
import { z } from 'zod';
import { config, mercadoLivreConfigured } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { decryptSecret, encryptSecret, pkceChallenge, randomOpaque, safeEqual, sha256 } from '../lib/crypto.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { clearCurrentSession, requireCsrf, sessionView } from '../middleware/session.js';
import { exchangeAuthorizationCode, userProfile } from '../services/mercadoLivre.js';

export const authRouter = Router();

authRouter.get('/session', (req, res) => res.json(sessionView(req)));

authRouter.get('/setup', (_req, res) => res.json({
  mercadoLivreConfigured,
  application: {
    configured: mercadoLivreConfigured,
    secureRedirect: config.ML_REDIRECT_URI.startsWith('https://'),
  },
}));

authRouter.get('/auth/mercadolivre/start', asyncHandler(async (req, res) => {
  if (!mercadoLivreConfigured) throw new AppError(503, 'SETUP_REQUIRED', 'Configure ML_CLIENT_ID e ML_CLIENT_SECRET no arquivo .env.');
  if (!req.appSession) throw new AppError(500, 'SESSION_MISSING', 'Sessão indisponível.');
  const state = randomOpaque(32);
  const verifier = randomOpaque(48);
  await prisma.oAuthAttempt.create({
    data: {
      sessionId: req.appSession.id,
      stateHash: sha256(state),
      codeVerifierCipher: encryptSecret(verifier),
      expiresAt: new Date(Date.now() + config.OAUTH_STATE_TTL_MINUTES * 60_000),
    },
  });
  const url = new URL(config.ML_AUTHORIZATION_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.ML_CLIENT_ID);
  url.searchParams.set('redirect_uri', config.ML_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('platform_id', 'web');
  // Com ?formato=json a interface recebe o link em vez do redirecionamento.
  // Serve pro fluxo "conectar pelo celular": o link abre no telefone (onde dá
  // pra fazer o reconhecimento facial) e a conta conecta NESTA sessão, porque
  // o callback identifica a tentativa pelo state, não pelo navegador.
  if (String(req.query.formato ?? '') === 'json') {
    res.json({ url: url.toString() });
    return;
  }
  res.redirect(url.toString());
}));

const mercadoLivreCallback = asyncHandler(async (req, res) => {
  if (!mercadoLivreConfigured) throw new AppError(503, 'SETUP_REQUIRED', 'Configure as credenciais do Mercado Livre.');
  const query = z.object({ code: z.string().min(4), state: z.string().min(20) }).parse(req.query);
  // O callback pode chegar por um túnel HTTPS enquanto a interface continua em
  // localhost. O state opaco identifica a tentativa original sem depender do
  // cookie do domínio público.
  const attempt = await prisma.oAuthAttempt.findFirst({
    where: { stateHash: sha256(query.state), usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!attempt || !safeEqual(attempt.stateHash, sha256(query.state))) {
    throw new AppError(400, 'OAUTH_STATE_INVALID', 'O login expirou ou o state é inválido.');
  }
  await prisma.oAuthAttempt.update({ where: { id: attempt.id }, data: { usedAt: new Date() } });
  const token = await exchangeAuthorizationCode(query.code, decryptSecret(attempt.codeVerifierCipher));
  const profile = await userProfile(token.access_token);
  if (String(profile.id) !== String(token.user_id)) throw new AppError(400, 'OAUTH_IDENTITY_MISMATCH', 'A identidade retornada é inconsistente.');
  const account = await prisma.oAuthAccount.upsert({
    where: { mlUserId: String(profile.id) },
    create: {
      mlUserId: String(profile.id), nickname: profile.nickname, siteId: profile.site_id,
      accessTokenCipher: encryptSecret(token.access_token), refreshTokenCipher: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    },
    update: {
      nickname: profile.nickname, siteId: profile.site_id,
      accessTokenCipher: encryptSecret(token.access_token), refreshTokenCipher: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000), revokedAt: null, disconnectedAt: null,
      tokenVersion: { increment: 1 },
    },
  });
  await prisma.session.update({ where: { id: attempt.sessionId }, data: { accountId: account.id } });
  await prisma.auditEvent.create({
    data: {
      accountId: account.id,
      sessionId: attempt.sessionId,
      action: 'oauth.connect',
      outcome: 'SUCCESS',
      metadataJson: JSON.stringify({ callback: 'https-bridge' }),
    },
  });
  res.redirect(`${config.PUBLIC_APP_URL.replace(/\/$/, '')}/?auth=success`);
});

authRouter.get('/auth/mercadolivre/callback', mercadoLivreCallback);
// Compatibilidade com o callback HTTPS já cadastrado pelo sistema anterior.
authRouter.get('/ml/callback', mercadoLivreCallback);

authRouter.post('/auth/logout', requireCsrf, asyncHandler(async (req, res) => {
  const accountId = req.appSession?.accountId;
  if (accountId) {
    await prisma.oAuthAccount.update({
      where: { id: accountId },
      data: { accessTokenCipher: null, refreshTokenCipher: null, disconnectedAt: new Date() },
    });
    await audit(req, 'oauth.disconnect', 'SUCCESS', { accountId });
  }
  await clearCurrentSession(req, res);
  res.status(204).end();
}));
