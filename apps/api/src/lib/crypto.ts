import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const b64url = (value: Buffer) => value.toString('base64url');

function encryptionKey(): Buffer {
  const raw = config.TOKEN_ENCRYPTION_KEY;
  const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY deve conter exatamente 32 bytes.');
  return key;
}

export function randomOpaque(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function pkceChallenge(verifier: string): string {
  return sha256(verifier);
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return ['v1', b64url(iv), b64url(cipher.getAuthTag()), b64url(encrypted)].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) throw new Error('Segredo cifrado inválido.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function csrfForSession(rawSessionId: string): string {
  return createHmac('sha256', encryptionKey())
    .update(`csrf:v1:${rawSessionId}`, 'utf8')
    .digest('base64url');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashClientValue(value?: string): string | undefined {
  return value ? sha256(value).slice(0, 32) : undefined;
}

// ----- Senhas dos usuários do aplicativo -----
// Uso scrypt (nativo do Node) com sal por senha. Formato guardado no banco:
// scrypt$<sal_base64url>$<derivado_base64url>. Sem dependências externas.
export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const derivado = scryptSync(senha, sal, 64);
  return `scrypt$${b64url(sal)}$${b64url(derivado)}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [esquema, salRaw, derivadoRaw] = guardado.split('$');
  if (esquema !== 'scrypt' || !salRaw || !derivadoRaw) return false;
  const sal = Buffer.from(salRaw, 'base64url');
  const esperado = Buffer.from(derivadoRaw, 'base64url');
  const derivado = scryptSync(senha, sal, esperado.length);
  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
}
