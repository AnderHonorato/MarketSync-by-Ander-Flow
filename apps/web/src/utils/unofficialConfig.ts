export type UnofficialConfig = {
  enabled: boolean;
  mode: "seller" | "product";
  url: string;
  query: string;
  limitMode: "limited" | "all";
  maxItems: number;
  inspectPix: boolean;
  observedFilter: string;
  observedSort: string;
};

export const DEFAULT_UNOFFICIAL_CONFIG: UnofficialConfig = {
  enabled: false,
  mode: "seller",
  url: "",
  query: "",
  limitMode: "limited",
  maxItems: 30,
  inspectPix: true,
  observedFilter: "all",
  observedSort: "source",
};

export function normalizeUnofficialConfig(input: unknown): UnofficialConfig {
  const saved = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const parsedMaxItems = typeof saved.maxItems === "number" ? saved.maxItems : Number(saved.maxItems);

  return {
    enabled: saved.enabled === true,
    mode: saved.mode === "product" ? "product" : "seller",
    url: typeof saved.url === "string" ? saved.url : "",
    query: typeof saved.query === "string" ? saved.query : "",
    limitMode: saved.limitMode === "all" ? "all" : "limited",
    maxItems: Number.isFinite(parsedMaxItems)
      ? Math.min(2000, Math.max(1, Math.trunc(parsedMaxItems)))
      : DEFAULT_UNOFFICIAL_CONFIG.maxItems,
    inspectPix: saved.inspectPix !== false,
    observedFilter: typeof saved.observedFilter === "string" ? saved.observedFilter : "all",
    observedSort: typeof saved.observedSort === "string" ? saved.observedSort : "source",
  };
}
