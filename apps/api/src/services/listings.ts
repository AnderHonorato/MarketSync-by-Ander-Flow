import type { ListingSnapshot, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type ListingFilters = {
  search?: string;
  status?: string[];
  stock?: string;
  sales?: string;
  age?: string;
  catalog?: string;
  promotion?: string;
  condition?: string;
  listingType?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  maxDiscount?: number;
  createdFrom?: Date;
  createdTo?: Date;
  sort?: string;
};

const json = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export function listingView(row: ListingSnapshot) {
  const raw = json<Record<string, unknown>>(row.rawJson, {});
  return {
    id: row.mlItemId,
    title: row.title,
    sku: row.sku,
    sellerCustomField: row.sellerCustomField,
    status: row.status,
    price: row.price,
    originalPrice: row.originalPrice,
    currencyId: row.currencyId,
    availableQuantity: row.availableQuantity,
    soldQuantity: row.soldQuantity,
    categoryId: row.categoryId,
    condition: row.condition,
    listingTypeId: row.listingTypeId,
    permalink: row.permalink,
    thumbnail: row.thumbnail,
    catalogListing: row.catalogListing,
    catalogProductId: row.catalogProductId,
    promotion: raw._promotion ?? null,
    syncChange: raw._syncChange ?? null,
    missingFromSync: raw._missingFromSync === true,
    createdAt: row.startTime?.toISOString() ?? null,
    updatedAt: row.lastUpdated?.toISOString() ?? null,
    stopAt: row.stopTime?.toISOString() ?? null,
    activeDays: row.startTime
      ? Math.max(
          0,
          Math.floor(
            ((row.stopTime ?? new Date()).getTime() - row.startTime.getTime()) /
              86_400_000,
          ),
        )
      : null,
    internalScore: row.internalScore,
    freeShipping: row.freeShipping,
    shippingMode:
      (json<Record<string, unknown>>(row.shippingJson, {}).mode as
        | string
        | undefined) ?? null,
  };
}

export function parseFilters(query: Record<string, unknown>): ListingFilters {
  const values = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const number = (value: unknown): number | undefined =>
    value !== undefined && value !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
  const date = (value: unknown): Date | undefined =>
    value && !Number.isNaN(new Date(String(value)).getTime())
      ? new Date(String(value))
      : undefined;
  return {
    search: query.search ? String(query.search).trim() : undefined,
    status: values(query.status),
    stock: query.stock ? String(query.stock) : undefined,
    sales: query.sales ? String(query.sales) : undefined,
    age: query.age ? String(query.age) : undefined,
    catalog: query.catalog ? String(query.catalog) : undefined,
    promotion: query.promotion ? String(query.promotion) : undefined,
    condition: query.condition ? String(query.condition) : undefined,
    listingType: query.listingType ? String(query.listingType) : undefined,
    categoryId: query.categoryId ? String(query.categoryId) : undefined,
    minPrice: number(query.minPrice),
    maxPrice: number(query.maxPrice),
    minDiscount: number(query.minDiscount),
    maxDiscount: number(query.maxDiscount),
    createdFrom: date(query.createdFrom),
    createdTo: date(query.createdTo),
    sort: query.sort ? String(query.sort) : undefined,
  };
}

function ageDays(row: ListingSnapshot): number {
  return row.startTime
    ? Math.floor((Date.now() - row.startTime.getTime()) / 86_400_000)
    : 0;
}

function matches(row: ListingSnapshot, f: ListingFilters): boolean {
  const q = f.search?.toLocaleLowerCase("pt-BR");
  if (
    q &&
    ![
      row.mlItemId,
      row.title,
      row.sku,
      row.sellerCustomField,
      row.categoryId,
    ].some((v) => v?.toLocaleLowerCase("pt-BR").includes(q))
  )
    return false;
  if (f.status?.length && !f.status.includes(row.status)) return false;
  if (f.stock === "with" && row.availableQuantity <= 0) return false;
  if (f.stock === "without" && row.availableQuantity > 0) return false;
  if (f.sales === "with" && row.soldQuantity <= 0) return false;
  if (f.sales === "zero" && row.soldQuantity !== 0) return false;
  const noSaleDays = f.sales?.match(/^none_(7|15|30|60|90)$/)?.[1];
  if (
    noSaleDays &&
    row.lastSaleDetectedAt &&
    row.lastSaleDetectedAt >
      new Date(Date.now() - Number(noSaleDays) * 86_400_000)
  )
    return false;
  if (f.catalog === "catalog" && !row.catalogListing) return false;
  if (f.catalog === "traditional" && row.catalogListing) return false;
  if (f.catalog === "associated" && !row.catalogProductId) return false;
  if (f.condition && row.condition !== f.condition) return false;
  if (f.listingType && row.listingTypeId !== f.listingType) return false;
  if (f.categoryId && row.categoryId !== f.categoryId) return false;
  if (f.minPrice !== undefined && row.price < f.minPrice) return false;
  if (f.maxPrice !== undefined && row.price > f.maxPrice) return false;
  if (f.minDiscount !== undefined && row.discountPercent < f.minDiscount)
    return false;
  if (f.maxDiscount !== undefined && row.discountPercent > f.maxDiscount)
    return false;
  if (f.createdFrom && (!row.startTime || row.startTime < f.createdFrom))
    return false;
  if (
    f.createdTo &&
    (!row.startTime ||
      row.startTime > new Date(f.createdTo.getTime() + 86_399_999))
  )
    return false;
  const days = ageDays(row);
  if (f.age === "lt7" && days >= 7) return false;
  if (f.age === "7_30" && (days < 7 || days > 30)) return false;
  if (f.age === "31_60" && (days < 31 || days > 60)) return false;
  if (f.age === "61_90" && (days < 61 || days > 90)) return false;
  if (f.age === "gt90" && days <= 90) return false;
  if (f.age === "gt180" && days <= 180) return false;
  if (f.age === "gt365" && days <= 365) return false;
  const promotion = json<Record<string, unknown>>(row.rawJson, {})
    ._promotion as Record<string, unknown> | undefined;
  if (f.promotion === "active" && promotion?.status !== "active") return false;
  if (f.promotion === "none" && promotion) return false;
  if (f.promotion === "future" && promotion?.status !== "future") return false;
  if (f.promotion === "ended" && promotion?.status !== "ended") return false;
  if (f.promotion === "pix" && promotion?.pix !== true) return false;
  if (
    f.promotion === "pix_active" &&
    !(promotion?.pix === true && promotion.status === "active")
  )
    return false;
  if (
    f.promotion === "pix_future" &&
    !(promotion?.pix === true && promotion.status === "future")
  )
    return false;
  if (f.promotion === "no_pix" && promotion?.pix === true) return false;
  return true;
}

function compare(sort = "created_desc") {
  const direction = sort.endsWith("_asc") ? 1 : -1;
  return (a: ListingSnapshot, b: ListingSnapshot): number => {
    if (sort.startsWith("title_"))
      return direction * a.title.localeCompare(b.title, "pt-BR");
    const value = (row: ListingSnapshot): number => {
      if (sort.startsWith("price_")) return row.price;
      if (sort.startsWith("stock_")) return row.availableQuantity;
      if (sort.startsWith("sold_")) return row.soldQuantity;
      if (sort.startsWith("discount_")) return row.discountPercent;
      if (sort.startsWith("score_")) return row.internalScore;
      if (sort.startsWith("age_")) return ageDays(row);
      return row.startTime?.getTime() ?? 0;
    };
    return direction * (value(a) - value(b));
  };
}

export async function filteredRows(
  accountId: string,
  filters: ListingFilters,
): Promise<ListingSnapshot[]> {
  const where: Prisma.ListingSnapshotWhereInput = { accountId };
  return (await prisma.listingSnapshot.findMany({ where }))
    .filter((row) => matches(row, filters))
    .sort(compare(filters.sort));
}
