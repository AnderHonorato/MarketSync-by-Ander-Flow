import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({
  path: [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../backend/.env'),
    resolve(process.cwd(), '../../../backend/.env'),
  ],
  override: false,
  quiet: true,
});

const bool = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_URL: z.string().default('file:./dev.db'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5180'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5180'),
  ML_CLIENT_ID: z.string().default(''),
  ML_CLIENT_SECRET: z.string().default(''),
  ML_REDIRECT_URI: z.string().url().default('http://localhost:3100/api/auth/mercadolivre/callback'),
  ML_AUTHORIZATION_URL: z.string().url().default('https://auth.mercadolivre.com.br/authorization'),
  ML_API_BASE_URL: z.string().url().default('https://api.mercadolibre.com'),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('mlam_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  COOKIE_SECURE: bool.default(false),
  OAUTH_STATE_TTL_MINUTES: z.coerce.number().int().min(3).max(30).default(10),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  SYNC_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  BULK_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  BULK_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(500),
  REFRESH_SKEW_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
  RATE_LIMIT_MAX: z.coerce.number().int().min(20).max(10_000).default(180),
  DEEPSEEK_API_KEY: z.string().default(''),
  METRYS_AI_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  METRYS_AI_MODEL: z.string().default('deepseek-chat'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production') {
    if (!value.ML_CLIENT_ID) context.addIssue({ code: 'custom', path: ['ML_CLIENT_ID'], message: 'Obrigatório em produção.' });
    if (!value.ML_CLIENT_SECRET) context.addIssue({ code: 'custom', path: ['ML_CLIENT_SECRET'], message: 'Obrigatório em produção.' });
  }
});

const testDefaults = process.env.NODE_ENV === 'test'
  ? {
      ML_CLIENT_ID: 'test-client',
      ML_CLIENT_SECRET: 'test-secret',
      ML_REDIRECT_URI: 'http://localhost:3100/api/auth/mercadolivre/callback',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    }
  : {};

export const config = schema.parse({ ...testDefaults, ...process.env });
export type Config = z.infer<typeof schema>;

export const mercadoLivreConfigured = Boolean(config.ML_CLIENT_ID && config.ML_CLIENT_SECRET);
