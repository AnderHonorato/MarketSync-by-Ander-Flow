import { describe, expect, it } from 'vitest';
import { normalizeListing, normalizeSession } from './normalizers';

describe('normalização defensiva', () => {
  it('normaliza campos oficiais snake_case', () => {
    const item = normalizeListing({ id: 'MLB1', title: 'Produto', price: 19.9, available_quantity: 4, sold_quantity: 2, catalog_listing: true, date_created: '2026-01-01T00:00:00Z' });
    expect(item).toMatchObject({ id: 'MLB1', availableQuantity: 4, soldQuantity: 2, catalogListing: true });
  });

  it('não considera uma resposta vazia como autenticada', () => {
    expect(normalizeSession({})).toEqual({ authenticated: false, csrfToken: null, expiresAt: null });
  });
});
