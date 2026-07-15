import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '../types';
import { listingsSearchParams, selectionCount } from './query';

describe('query de anúncios', () => {
  it('combina busca, status e intervalos sem perder valores repetidos', () => {
    const params = listingsSearchParams({ search: 'MLB123', page: 2, pageSize: 50, sort: 'price_desc', scoreEnabled: true, filters: { ...EMPTY_FILTERS, statuses: ['active', 'paused'], minPrice: '20' } });
    expect(params.getAll('status')).toEqual(['active', 'paused']);
    expect(params.get('search')).toBe('MLB123');
    expect(params.get('minPrice')).toBe('20');
  });

  it('conta seleção explícita e seleção de todos com exceções', () => {
    expect(selectionCount({ mode: 'explicit', ids: new Set(['1', '2']) })).toBe(2);
    expect(selectionCount({ mode: 'allFiltered', total: 10, excludedIds: new Set(['2']), scopeKey: 'x' })).toBe(9);
  });
});
