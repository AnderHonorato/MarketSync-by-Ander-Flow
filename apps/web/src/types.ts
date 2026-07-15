export type Session = {
  authenticated: boolean;
  csrfToken: string | null;
  expiresAt?: string | null;
};

export type BulkActionType =
  | "pause"
  | "activate"
  | "close"
  | "set_price"
  | "increase_price"
  | "decrease_price"
  | "set_stock"
  | "add_stock"
  | "subtract_stock"
  | "set_sku";

export type Account = {
  sellerId: string;
  nickname: string;
  siteId?: string | null;
  email?: string | null;
  connectedAt?: string | null;
  tokenExpiresAt?: string | null;
  capabilities?: {
    bulkActions?: BulkActionType[];
  };
};

export type SyncStatus =
  | "idle"
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed";

export type SyncState = {
  status: SyncStatus;
  phase?: string | null;
  processed: number;
  total?: number | null;
  progress?: number | null;
  message?: string | null;
  lastSyncedAt?: string | null;
  startedAt?: string | null;
  canCancel?: boolean;
  error?: string | null;
  changes?: {
    added?: number;
    updated?: number;
    removed?: number;
    unchanged?: number;
    details?: Array<{ id: string; kind: "added" | "updated" | "removed"; fields: string[] }>;
  } | null;
};

export type Promotion = {
  status?: "active" | "future" | "ended" | "unknown" | null;
  type?: string | null;
  discountPercentage?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  pix?: boolean;
  campaignId?: string | null;
  name?: string | null;
  subType?: string | null;
  paymentMethod?: string | null;
};

export type Listing = {
  id: string;
  title: string;
  sku?: string | null;
  sellerCustomField?: string | null;
  status?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  currencyId?: string | null;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  thumbnail?: string | null;
  permalink?: string | null;
  categoryId?: string | null;
  condition?: string | null;
  listingTypeId?: string | null;
  catalogListing?: boolean | null;
  catalogProductId?: string | null;
  catalogEligible?: boolean | null;
  promotion?: Promotion | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  stopAt?: string | null;
  activeDays?: number | null;
  health?: number | null;
  internalScore?: number | null;
  freeShipping?: boolean | null;
  shippingMode?: string | null;
  syncChange?: {
    kind: "added" | "updated" | "removed";
    fields: string[];
    differences?: Array<{ field: string; before: unknown; after: unknown }>;
    jobId?: string;
    at?: string;
  } | null;
  missingFromSync?: boolean;
};

export type HistoryEvent = {
  id: string;
  sessionId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "SUCCESS" | "FAILURE";
  metadata: Record<string, unknown>;
  createdAt: string;
  currentSession: boolean;
};

export type HistorySession = {
  id: string;
  current: boolean;
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string | null;
  activeSeconds: number;
};

export type HistoryData = { events: HistoryEvent[]; sessions: HistorySession[] };

export type AiAttachment = { name: string; type: string; dataUrl: string };
export type AiConversation = { id: string; title: string; archived: boolean; createdAt: string; updatedAt: string; messageCount: number };
export type AiMessage = { id: string; role: "user" | "assistant"; content: string; reasoning?: string | null; attachments: AiAttachment[]; createdAt: string };

export type ListingAttribute = {
  id?: string | null;
  name?: string | null;
  valueId?: string | null;
  valueName?: string | null;
};

export type ListingVariation = {
  id: string;
  sku?: string | null;
  price?: number | null;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  attributes?: ListingAttribute[];
};

export type ListingDetail = Listing & {
  pictures?: Array<{ id?: string | null; url: string; alt?: string | null }>;
  description?: string | null;
  attributes?: ListingAttribute[];
  variations?: ListingVariation[];
  metrics?: Record<string, string | number | null> | null;
  shipping?: Record<string, unknown> | null;
  unavailableFields?: string[];
};

export type RankingParticipant = {
  itemId: string;
  sellerId: string;
  sellerNickname?: string | null;
  sellerPermalink?: string | null;
  reputation?: string | null;
  powerSellerStatus?: string | null;
  sellerSales?: number | null;
  title?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  discountPercent?: number | null;
  currencyId: string;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  freeShipping: boolean;
  logisticType?: string | null;
  listingTypeId?: string | null;
  thumbnail?: string | null;
  permalink?: string | null;
  winner: boolean;
  mine: boolean;
};

export type ListingRanking = {
  available: boolean;
  catalogProductId?: string | null;
  source: "not_catalog" | "official_product_items" | "official_competition_summary";
  message?: string | null;
  status?: string | null;
  reason?: string | null;
  priceToWin?: number | null;
  currentPrice?: number | null;
  visitShare?: string | null;
  competitorsSharingFirstPlace?: number | null;
  winnerItemId?: string | null;
  participants: RankingParticipant[];
};

export type ListingsPage = {
  items: Listing[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
};

export type ObservedListing = {
  id: string;
  title: string;
  permalink: string;
  thumbnail?: string | null;
  pictures: string[];
  price?: number | null;
  originalPrice?: number | null;
  currencyId: "BRL";
  description?: string | null;
  condition?: string | null;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  listingTypeId?: string | null;
  categoryId?: string | null;
  catalogListing: boolean;
  catalogProductId?: string | null;
  warranty?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  dateCreated?: string | null;
  seller: { id?: string | null; nickname?: string | null; profileUrl?: string | null };
  shipping: { freeShipping?: boolean | null; mode?: string | null; logisticType?: string | null };
  attributes: Array<{ id?: string | null; name: string; value: string }>;
  pixObserved: boolean | null;
  pixEvidence?: string | null;
  checkedAt?: string | null;
  error?: string | null;
  errorCode?: string | null;
  sourceRank: number;
};

export type UnofficialScan = {
  id: string;
  mode: "seller" | "product";
  sourceUrl: string;
  query?: string | null;
  limitMode: "limited" | "all";
  requestedLimit?: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "auth_required";
  phase: string;
  progress: number;
  processed: number;
  total: number;
  pagesRead: number;
  inspectPix: boolean;
  waiting: boolean;
  waitReason?: string | null;
  cooldownMs: number;
  partial: boolean;
  items: ObservedListing[];
  logs?: Array<{ at: string; level: "info" | "warning" | "error"; message: string; code?: string | null }>;
  error?: string | null;
  errorCode?: string | null;
};

export type PageSize = 30 | 50 | 100 | 200 | "all";

export type SortOption =
  | ""
  | "created_desc"
  | "created_asc"
  | "price_desc"
  | "price_asc"
  | "stock_desc"
  | "stock_asc"
  | "sold_desc"
  | "sold_asc"
  | "age_desc"
  | "age_asc"
  | "discount_desc"
  | "discount_asc"
  | "title_asc"
  | "title_desc"
  | "score_desc"
  | "score_asc";

export type Filters = {
  statuses: string[];
  stock: string;
  sales: string;
  age: string;
  catalog: string;
  promotion: string;
  condition: string;
  listingType: string;
  categoryId: string;
  minPrice: string;
  maxPrice: string;
  minDiscount: string;
  maxDiscount: string;
  createdFrom: string;
  createdTo: string;
};

export type ListingQuery = {
  search: string;
  filters: Filters;
  sort: SortOption;
  page: number;
  pageSize: number;
  scoreEnabled: boolean;
};

export type SelectionState =
  | { mode: "explicit"; ids: Set<string> }
  | {
      mode: "allFiltered";
      excludedIds: Set<string>;
      total: number;
      scopeKey: string;
    };

export type SelectionPayload =
  | { mode: "explicit"; ids: string[] }
  | {
      mode: "allFiltered";
      excludedIds: string[];
      filters: Omit<ListingQuery, "page" | "pageSize">;
    };

export type BulkOperation = {
  type: BulkActionType;
  value?: number | string;
  unit?: "fixed" | "percentage";
  rounding?: "none" | "integer" | "ending_90" | "ending_99";
  minPrice?: number;
  maxPrice?: number;
};

export type BulkPreviewItem = {
  id: string;
  title?: string | null;
  currentValue?: string | number | null;
  newValue?: string | number | null;
  valid?: boolean;
  message?: string | null;
};

export type BulkPreview = {
  previewId: string;
  confirmationToken?: string | null;
  affected: number;
  valid: number;
  invalid: number;
  estimatedBatches?: number | null;
  warnings: string[];
  items: BulkPreviewItem[];
  expiresAt?: string | null;
};

export type BulkResultItem = {
  id: string;
  success: boolean;
  message?: string | null;
  code?: string | null;
};

export type BulkJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  processed: number;
  total: number;
  successes: number;
  failures: number;
  progress?: number | null;
  items?: BulkResultItem[];
  error?: string | null;
};

export const EMPTY_FILTERS: Filters = {
  statuses: [],
  stock: "",
  sales: "",
  age: "",
  catalog: "",
  promotion: "",
  condition: "",
  listingType: "",
  categoryId: "",
  minPrice: "",
  maxPrice: "",
  minDiscount: "",
  maxDiscount: "",
  createdFrom: "",
  createdTo: "",
};
