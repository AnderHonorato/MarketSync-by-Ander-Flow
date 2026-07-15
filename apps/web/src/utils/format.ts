export function formatCurrency(
  value: number | null | undefined,
  currency = 'BRL',
): string {
  if (value == null || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR')}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  return value == null || Number.isNaN(value)
    ? '—'
    : new Intl.NumberFormat('pt-BR').format(value);
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function discountPercentage(
  price: number | null | undefined,
  originalPrice: number | null | undefined,
  officialDiscount?: number | null,
): number | null {
  if (officialDiscount != null) return officialDiscount;
  if (!price || !originalPrice || originalPrice <= price) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function activeDays(listing: {
  activeDays?: number | null;
  createdAt?: string | null;
  stopAt?: string | null;
}): number | null {
  if (listing.activeDays != null) return listing.activeDays;
  if (!listing.createdAt) return null;
  const start = new Date(listing.createdAt).getTime();
  const stop = listing.stopAt ? new Date(listing.stopAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(stop)) return null;
  return Math.max(0, Math.floor((Math.min(stop, Date.now()) - start) / 86_400_000));
}

export function statusLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    active: 'Ativo',
    paused: 'Pausado',
    closed: 'Encerrado',
    under_review: 'Em revisão',
    pending: 'Pendente',
    inactive: 'Inativo',
  };
  return value ? labels[value] ?? value.replaceAll('_', ' ') : 'Sem status';
}

export function statusTone(value: string | null | undefined): string {
  if (value === 'active') return 'positive';
  if (value === 'paused' || value === 'pending') return 'warning';
  if (value === 'closed' || value === 'inactive') return 'neutral';
  if (value === 'under_review') return 'danger';
  return 'neutral';
}

export function safeFileNameDate(date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
