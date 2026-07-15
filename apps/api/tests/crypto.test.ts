import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, pkceChallenge, safeEqual } from '../src/lib/crypto.js';

describe('proteção de credenciais', () => {
  it('cifra com payload autenticado e recupera o valor', () => {
    const encrypted = encryptSecret('APP_USR-segredo');
    expect(encrypted).not.toContain('APP_USR-segredo');
    expect(decryptSecret(encrypted)).toBe('APP_USR-segredo');
  });

  it('gera challenge PKCE e comparação segura', () => {
    expect(pkceChallenge('verifier')).toHaveLength(43);
    expect(safeEqual('state', 'state')).toBe(true);
    expect(safeEqual('state', 'outro')).toBe(false);
  });
});
