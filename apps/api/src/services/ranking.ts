type UnknownRecord = Record<string, unknown>;

export type SellerSummary = {
  nickname?: string | null;
  permalink?: string | null;
  reputation?: string | null;
  powerSellerStatus?: string | null;
  sales?: number | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value) return value;
  return null;
}

function number(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function sellerSummary(value: unknown): SellerSummary {
  const user = record(value);
  const reputation = record(user.seller_reputation);
  const transactions = record(reputation.transactions);
  const eshop = record(user.eshop);
  return {
    nickname: text(user.nickname, user.first_name),
    permalink: text(eshop.permalink, user.permalink),
    reputation: text(reputation.level_id),
    powerSellerStatus: text(reputation.power_seller_status),
    sales: number(transactions.total),
  };
}

export function rankingParticipant(
  value: unknown,
  ownSellerId: string,
  winnerItemId: string | null,
  seller?: SellerSummary,
) {
  const row = record(value);
  const shipping = record(row.shipping);
  const nestedSeller = record(row.seller);
  const itemId = text(row.item_id, row.id) ?? "";
  const sellerId = text(row.seller_id, nestedSeller.id) ?? "";
  const price = number(row.price, row.current_price);
  const originalPrice = number(row.original_price);
  return {
    itemId,
    sellerId,
    sellerNickname: seller?.nickname ?? text(nestedSeller.nickname),
    sellerPermalink: seller?.permalink ?? null,
    reputation: seller?.reputation ?? text(nestedSeller.reputation_level_id),
    powerSellerStatus: seller?.powerSellerStatus ?? null,
    sellerSales: seller?.sales ?? null,
    title: text(row.title),
    price,
    originalPrice,
    discountPercent: price && originalPrice && originalPrice > price
      ? Math.round((1 - price / originalPrice) * 100)
      : null,
    currencyId: text(row.currency_id) ?? "BRL",
    availableQuantity: number(row.available_quantity),
    soldQuantity: number(row.sold_quantity),
    freeShipping: shipping.free_shipping === true,
    logisticType: text(shipping.logistic_type),
    listingTypeId: text(row.listing_type_id),
    thumbnail: text(row.thumbnail),
    permalink: text(row.permalink) ?? (itemId ? `https://produto.mercadolivre.com.br/${itemId}` : null),
    winner: Boolean(itemId && winnerItemId && itemId === winnerItemId),
    mine: Boolean(sellerId && sellerId === ownSellerId),
  };
}

export function rankingRows(value: unknown): unknown[] {
  const data = record(value);
  return Array.isArray(data.results) ? data.results : [];
}

export function asRecord(value: unknown): UnknownRecord {
  return record(value);
}

