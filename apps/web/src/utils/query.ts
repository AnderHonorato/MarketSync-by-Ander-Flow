import type { Filters, ListingQuery, SelectionState } from '../types';

export function appendFilters(params: URLSearchParams, filters: Filters): void {
  filters.statuses.forEach((status) => params.append('status', status));
  const mappings: Array<[keyof Omit<Filters, 'statuses'>, string]> = [
    ['stock', 'stock'],
    ['sales', 'sales'],
    ['age', 'age'],
    ['catalog', 'catalog'],
    ['promotion', 'promotion'],
    ['condition', 'condition'],
    ['listingType', 'listingType'],
    ['categoryId', 'categoryId'],
    ['minPrice', 'minPrice'],
    ['maxPrice', 'maxPrice'],
    ['minDiscount', 'minDiscount'],
    ['maxDiscount', 'maxDiscount'],
    ['createdFrom', 'createdFrom'],
    ['createdTo', 'createdTo'],
  ];
  mappings.forEach(([key, name]) => {
    const value = filters[key];
    if (value) params.set(name, value);
  });
}

export function listingsSearchParams(query: ListingQuery): URLSearchParams {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.pageSize),
    scoreEnabled: String(query.scoreEnabled),
  });
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  appendFilters(params, query.filters);
  return params;
}

export function queryScopeKey(query: Omit<ListingQuery, 'page' | 'pageSize'>): string {
  return JSON.stringify({
    search: query.search,
    filters: query.filters,
    sort: query.sort,
    scoreEnabled: query.scoreEnabled,
  });
}

export function selectionCount(selection: SelectionState): number {
  return selection.mode === 'explicit'
    ? selection.ids.size
    : Math.max(0, selection.total - selection.excludedIds.size);
}
