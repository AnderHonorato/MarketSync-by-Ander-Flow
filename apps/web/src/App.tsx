import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Clock3,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  History,
  FileSpreadsheet,
  Filter,
  KeyRound,
  LoaderCircle,
  Lock,
  LogOut,
  Moon,
  PackageSearch,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquareCheckBig,
  Store,
  Sun,
  Trophy,
  Truck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  authStartUrl,
  cancelSync,
  executeBulk,
  exportListings,
  getAccount,
  getBulkJob,
  getListing,
  getListingRanking,
  getListings,
  getSession,
  getSetup,
  getSync,
  logout,
  previewBulk,
  startSync,
  startUnofficialScan,
  getUnofficialScan,
  cancelUnofficialScan,
  resumeUnofficialScan,
  getCatalogParticipants,
  getHistory,
  recordActivity,
  heartbeat,
  resetAllData,
} from "./api";
import type {
  Account,
  BulkActionType,
  BulkJob,
  BulkPreview,
  Filters,
  Listing,
  ListingDetail,
  ListingRanking,
  ListingsPage,
  ListingQuery,
  SelectionPayload,
  Session,
  SyncState,
  ObservedListing,
  UnofficialScan,
  HistoryData,
  RankingParticipant,
} from "./types";
import { EMPTY_FILTERS } from "./types";
import {
  activeDays,
  discountPercentage,
  formatCurrency,
  formatDate,
  formatNumber,
  statusLabel,
  statusTone,
} from "./utils/format";
import { listingsSearchParams, queryScopeKey } from "./utils/query";
import { normalizeUnofficialConfig } from "./utils/unofficialConfig";
import { userFacingCode, userFacingError } from "./utils/errorCatalog";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { AlphaBot } from "./components/AlphaBot";
import { LockModal } from "./components/LockModal";

const DEFAULT_QUERY: ListingQuery = {
  search: "",
  filters: { ...EMPTY_FILTERS },
  sort: "created_desc",
  page: 1,
  pageSize: 30,
  scoreEnabled: true,
};
function stored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}
const actionLabels: Record<BulkActionType, string> = {
  pause: "Pausar",
  activate: "Reativar",
  close: "Encerrar",
  set_price: "Definir preço",
  increase_price: "Aumentar preço",
  decrease_price: "Reduzir preço",
  set_stock: "Definir estoque",
  add_stock: "Adicionar estoque",
  subtract_stock: "Reduzir estoque",
  set_sku: "Alterar SKU",
};

function message(error: unknown): string {
  return userFacingError(error);
}

type SetupStatus = {
  mercadoLivreConfigured: boolean;
  application?: {
    configured: boolean;
    secureRedirect: boolean;
  };
};

function LoginScreen({
  sessionError,
  setup,
  checking,
  onCheckOfficial,
  onContinue,
  theme,
}: {
  sessionError?: string;
  setup: SetupStatus | null;
  checking: boolean;
  onCheckOfficial: () => void;
  onContinue: () => void;
  theme: "light" | "dark";
}) {
  const appConfigured = Boolean(setup?.mercadoLivreConfigured);
  const secureRedirect = Boolean(setup?.application?.secureRedirect);
  const appReady = appConfigured && secureRedirect;
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand">
          <img className="brand-mark" src={`/${theme === "dark" ? "icone-escuro" : "icone-claro"}.png`} alt="MarketSync" />
          <div className="brand-text">
            <span>MarketSync</span>
            <small>by Ander Flow</small>
          </div>
        </div>
        <h1>Acessar anúncios</h1>
        <p className="lead">Confira as duas conexões e continue.</p>
        {sessionError && (
          <div className="notice danger">
            <AlertTriangle size={18} />
            {sessionError}
          </div>
        )}
        <div className="login-connections">
          <article className={appReady ? "ready" : "attention"}>
            <KeyRound />
            <div><span>Conexão do aplicativo</span><strong>{setup == null ? "Ainda não verificada" : appReady ? "Pronta" : "Configuração necessária"}</strong></div>
            <i />
          </article>
          <article className="pending">
            <Store />
            <div><span>Conta dos anúncios</span><strong>Aguardando conexão</strong></div>
            <i />
          </article>
        </div>
        {setup == null ? <button className="button primary login-button" disabled={checking} onClick={onCheckOfficial}>{checking ? <LoaderCircle className="spin" /> : <KeyRound />}{checking ? "Verificando…" : "Verificar conexão oficial"}</button>
          : appReady ? <a className="button primary login-button" href={authStartUrl()}>Conectar conta Mercado Livre <ExternalLink size={17} /></a>
            : <button className="button primary login-button" disabled>Conexão oficial indisponível</button>}
        <button className="button guest-button" onClick={onContinue}>
          Continuar sem conectar
        </button>
        <div className="trust-row"><ShieldCheck size={18} /><span>Tokens protegidos no servidor</span></div>
      </section>
    </main>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  return (
    <span className={`status ${statusTone(status)}`}>
      <i />
      {statusLabel(status)}
    </span>
  );
}

function CopyButton({ value, label = "Copiar" }: { value?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      className="copy-button"
      title={copied ? "Copiado" : label}
      aria-label={copied ? "Copiado" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop help-backdrop" onMouseDown={onClose}>
      <section className="modal help-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Guia rápido</p><h2>Como usar esta página</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar ajuda"><X /></button>
        </div>
        <div className="help-list">
          <div><strong>Conexão oficial</strong><p>Carrega somente os anúncios da conta autorizada e permite alterações seguras.</p></div>
          <div><strong>Consultas públicas</strong><p>A aba separada consulta uma loja por URL ou procura ofertas pelo nome do produto. É opcional, não altera anúncios e pode ficar incompleta se o site bloquear ou ocultar dados.</p></div>
          <div><strong>Pix oficial</strong><p>Indica participação identificada pela API em campanha de Pix do tipo BANK.</p></div>
          <div><strong>Pix observado</strong><p>Indica que a página pública exibiu texto explícito relacionado a pagamento ou desconto no Pix. É uma observação, não uma garantia do checkout.</p></div>
          <div><strong>Filtros e seleção</strong><p>Combine os filtros, selecione apenas a página ou todos os resultados e revise antes de qualquer alteração.</p></div>
          <div><strong>Visualização</strong><p>“Meu visual” organiza MLB, catálogo, vendedor, entrega, vendas, descrição, fotos e ficha encontrados. “Página oficial” pode ser bloqueada pelo próprio Mercado Livre.</p></div>
          <div><strong>Pausa de segurança</strong><p>As consultas públicas aguardam entre páginas e anúncios. O cooldown aparece no progresso e reduz a frequência das requisições, mas não garante que o site nunca bloqueará a leitura.</p></div>
          <div><strong>Histórico</strong><p>Guarda sessões, acessos, sincronizações, alterações e movimentos importantes. Tokens e credenciais nunca entram nesse registro.</p></div>
          <div><strong>Mudanças na sincronização</strong><p>As cores indicam anúncios novos, alterados ou que deixaram de retornar na consulta mais recente. Passe o mouse na etiqueta para ver os campos.</p></div>
          <div><strong>Persistência</strong><p>Tema, filtros, busca, aba e leitura pública continuam disponíveis após fechar a página. Resetar informações limpa essas preferências, mas não apaga anúncios nem o histórico de auditoria.</p></div>
        </div>
      </section>
    </div>
  );
}

const historyLabels: Record<string, string> = {
  "session.start": "Sessão iniciada",
  "oauth.connect": "Conta autenticada",
  "oauth.disconnect": "Conta desconectada",
  "sync.start": "Sincronização iniciada",
  "sync.completed": "Sincronização concluída",
  "sync.failed": "Falha na sincronização",
  "sync.cancel": "Cancelamento da sincronização solicitado",
  "bulk.execute": "Alteração em massa executada",
  "ui.open": "Página aberta",
  "ui.reset": "Informações locais resetadas",
  "ui.filters": "Filtros alterados",
  "ui.theme": "Tema alterado",
  "ui.tab": "Aba alterada",
  "listing.view": "Anúncio visualizado",
  "unofficial.start": "Leitura pública iniciada",
  "unofficial.complete": "Leitura pública concluída",
  "export.start": "Exportação solicitada",
};

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function eventSummary(action: string, metadata: Record<string, unknown>) {
  if (action === "sync.completed") {
    return `${Number(metadata.added ?? 0)} adicionados · ${Number(metadata.updated ?? 0)} alterados · ${Number(metadata.removed ?? 0)} não retornaram · ${Number(metadata.unchanged ?? 0)} sem mudanças`;
  }
  if (action === "ui.theme") return `Tema ${metadata.theme === "dark" ? "escuro" : "claro"}`;
  if (action === "ui.tab") return metadata.tab === "history" ? "Histórico aberto" : metadata.tab === "unofficial" ? "Consultas públicas abertas" : "Anúncios oficiais abertos";
  if (action === "ui.filters") return `${Number(metadata.active ?? 0)} filtros ativos`;
  if (action === "unofficial.complete") return `${Number(metadata.total ?? 0)} anúncios lidos · ${Number(metadata.pix ?? 0)} com Pix observado`;
  if (typeof metadata.action === "string") return `Ação: ${metadata.action}`;
  if (typeof metadata.message === "string") return metadata.message;
  return "Atividade registrada com sucesso.";
}

function SyncHistoryDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const details = Array.isArray(metadata.details) ? metadata.details.slice(0, 30) : [];
  if (!details.length) return null;
  const readable = (value: unknown) => value == null ? "vazio" : typeof value === "boolean" ? (value ? "sim" : "não") : String(value);
  return (
    <details className="sync-history-details">
      <summary>Ver anúncios modificados</summary>
      <div>
        {details.map((entry, index) => {
          const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
          const differences = Array.isArray(item.differences) ? item.differences : [];
          return <p key={`${String(item.id)}-${index}`}><strong>{String(item.id || "Anúncio")}</strong><span>{String(item.kind) === "added" ? "adicionado" : String(item.kind) === "removed" ? "não retornou" : differences.length ? differences.map((difference) => { const value = difference as Record<string, unknown>; return `${String(value.field)}: ${readable(value.before)} → ${readable(value.after)}`; }).join(" · ") : (Array.isArray(item.fields) ? item.fields.join(", ") : "alterado")}</span></p>;
        })}
      </div>
    </details>
  );
}

function HistoryPanel() {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [errorHistory, setErrorHistory] = useState("");
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    setLoadingHistory(true);
    try { setHistory(await getHistory()); setErrorHistory(""); }
    catch (reason) { setErrorHistory(message(reason)); }
    finally { setLoadingHistory(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const events = (history?.events ?? []).filter((event) =>
    filter === "all" ||
    (filter === "sessions" && ["session.start", "oauth.connect", "oauth.disconnect"].includes(event.action)) ||
    (filter === "sync" && event.action.startsWith("sync.")) ||
    (filter === "changes" && ["bulk.execute", "sync.completed"].includes(event.action)) ||
    (filter === "navigation" && event.action.startsWith("ui.")),
  );
  return (
    <section className="history-page">
      <div className="history-heading">
        <div><h2>Histórico e sessões</h2><p>Registro persistente do que aconteceu no sistema, sem guardar tokens ou credenciais.</p></div>
        <button className="button" onClick={() => void load()} disabled={loadingHistory}>{loadingHistory ? <LoaderCircle className="spin" /> : <RefreshCw />}Atualizar</button>
      </div>
      {errorHistory && <div className="notice danger"><AlertTriangle />{errorHistory}</div>}
      <div className="session-grid">
        {(history?.sessions ?? []).map((session) => (
          <article key={`${session.id}-${session.startedAt}`} className={session.current ? "current" : ""}>
            <div><Clock3 /><strong>{session.current ? "Sessão atual" : `Sessão ${session.id}`}</strong></div>
            <span>Início: {formatDate(session.startedAt, true)}</span>
            <span>Última atividade: {formatDate(session.lastSeenAt, true)}</span>
            <b>{durationLabel(session.activeSeconds)} de atividade</b>
          </article>
        ))}
        {!loadingHistory && !history?.sessions.length && <div className="observed-empty">Nenhuma sessão registrada.</div>}
      </div>
      <div className="timeline-head">
        <div><h3>Movimentos registrados</h3><span>{events.length} eventos exibidos</span></div>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar histórico">
          <option value="all">Todos os movimentos</option><option value="sessions">Sessões e acesso</option><option value="sync">Sincronizações</option><option value="changes">Alterações nos anúncios</option><option value="navigation">Movimentos na página</option>
        </select>
      </div>
      <div className="history-timeline">
        {loadingHistory ? <div className="history-loading"><LoaderCircle className="spin" />Carregando histórico…</div> : events.map((event) => (
          <article key={event.id} className={event.outcome === "FAILURE" ? "failure" : ""}>
            <i><History /></i>
            <div className="history-event-body">
              <div><strong>{historyLabels[event.action] || event.action}</strong>{event.currentSession && <span className="current-session-badge">sessão atual</span>}<time>{formatDate(event.createdAt, true)}</time></div>
              <p>{eventSummary(event.action, event.metadata)}</p>
              {event.action === "sync.completed" && <SyncHistoryDetails metadata={event.metadata} />}
              {event.targetId && <small>{event.targetType || "registro"}: {event.targetId}</small>}
            </div>
          </article>
        ))}
        {!loadingHistory && !events.length && <div className="observed-empty">Nenhum movimento corresponde a este filtro.</div>}
      </div>
    </section>
  );
}

function ObservedListingModal({ item, onClose }: { item: ObservedListing; onClose: () => void }) {
  const [tab, setTab] = useState<"custom" | "official">("custom");
  const [detailTab, setDetailTab] = useState<"summary" | "description" | "pictures" | "specs">("summary");
  const discount = item.originalPrice && item.price && item.originalPrice > item.price
    ? Math.round((1 - item.price / item.originalPrice) * 100)
    : 0;
  const infoGroups = [
    { title: "Anúncio", rows: [["MLB", item.id], ["Condição", item.condition === "new" ? "Novo" : item.condition === "used" ? "Usado" : item.condition], ["Tipo", item.listingTypeId], ["Categoria", item.categoryId]] },
    { title: "Catálogo", rows: [["Participa do catálogo", item.catalogListing ? "Sim" : "Não"], ["Produto de catálogo", item.catalogProductId]] },
    { title: "Vendedor", rows: [["Nome", item.seller?.nickname], ["ID", item.seller?.id]] },
    { title: "Entrega", rows: [["Frete grátis", item.shipping?.freeShipping == null ? null : item.shipping.freeShipping ? "Sim" : "Não"], ["Modo", item.shipping?.mode], ["Logística", item.shipping?.logisticType], ["Garantia", item.warranty]] },
  ];
  return (
    <div className="modal-backdrop listing-modal-backdrop" onMouseDown={onClose}>
      <section className="listing-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Anúncio observado</p><h2>{item.id}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button>
        </div>
        <div className="view-tabs">
          <button className={tab === "custom" ? "active" : ""} onClick={() => setTab("custom")}>Meu visual</button>
          <button className={tab === "official" ? "active" : ""} onClick={() => setTab("official")}>Página oficial</button>
        </div>
        {tab === "official" ? (
          <div className="official-frame-wrap">
            <div className="external-page-placeholder"><ExternalLink /><h3>A página oficial abre em uma nova guia</h3><p>O Mercado Livre protege suas páginas contra exibição dentro de outros sistemas.</p></div>
            <a className="button" href={item.permalink} target="_blank" rel="noreferrer">Abrir em nova guia <ExternalLink /></a>
          </div>
        ) : (
          <div className="observed-detail rich">
            <aside className="observed-detail-media">
              {item.thumbnail ? <img src={item.thumbnail} alt={item.title} /> : <div className="observed-image-placeholder"><PackageSearch /></div>}
              <div className="observed-price-block">
                <strong>{formatCurrency(item.price, item.currencyId)}</strong>
                {discount > 0 && <><del>{formatCurrency(item.originalPrice, item.currencyId)}</del><b>{discount}% OFF</b></>}
              </div>
              <div className={`pix-observation ${item.pixObserved ? "yes" : item.pixObserved === false ? "no" : "unknown"}`}>
                {item.pixObserved ? <CheckCircle2 /> : <CircleHelp />}
                <div><strong>{item.pixObserved ? "Pix explícito observado" : item.pixObserved === false ? "Pix explícito não encontrado" : "Pix não verificado"}</strong>{item.pixEvidence && <p>{item.pixEvidence}</p>}</div>
              </div>
            </aside>
            <div className="observed-detail-content">
              <div className="copy-line"><h3>{item.title}</h3><CopyButton value={item.title} label="Copiar título" /></div>
              <div className="detail-identifiers">
                <span><code>{item.id}</code><CopyButton value={item.id} label="Copiar MLB" /></span>
                {item.catalogListing && <b><Trophy />Catálogo</b>}
                {item.shipping?.freeShipping && <b><Truck />Frete grátis</b>}
              </div>
              <div className="observed-stats">
                <article><strong>{formatNumber(item.availableQuantity)}</strong><span>estoque observado</span></article>
                <article><strong>{formatNumber(item.soldQuantity)}</strong><span>vendidos</span></article>
                <article><strong>{item.rating ? item.rating.toFixed(1) : "—"}</strong><span>{item.reviewCount ? `${formatNumber(item.reviewCount)} avaliações` : "avaliação"}</span></article>
              </div>
              <nav className="observed-detail-tabs">
                <button className={detailTab === "summary" ? "active" : ""} onClick={() => setDetailTab("summary")}>Informações</button>
                <button className={detailTab === "description" ? "active" : ""} onClick={() => setDetailTab("description")}>Descrição</button>
                <button className={detailTab === "pictures" ? "active" : ""} onClick={() => setDetailTab("pictures")}>Fotos ({item.pictures?.length ?? 0})</button>
                <button className={detailTab === "specs" ? "active" : ""} onClick={() => setDetailTab("specs")}>Ficha ({item.attributes?.length ?? 0})</button>
              </nav>
              {detailTab === "summary" && <div className="observed-info-grid">
                {infoGroups.map((group) => <section key={group.title}><h4>{group.title}</h4>{group.rows.filter(([, value]) => value != null && value !== "").map(([label, value]) => <div key={label}><span>{label}</span><strong>{String(value)}</strong></div>)}</section>)}
              </div>}
              {detailTab === "description" && <div className="observed-description">{item.description || "A descrição não apareceu na página pública deste anúncio."}</div>}
              {detailTab === "pictures" && <div className="observed-gallery">{(item.pictures ?? []).map((picture, index) => <a href={picture} target="_blank" rel="noreferrer" key={`${picture}-${index}`}><img src={picture} alt={`${item.title} ${index + 1}`} /><CopyButton value={picture} label="Copiar link da imagem" /></a>)}{!item.pictures?.length && <div className="observed-empty">Nenhuma foto adicional foi encontrada.</div>}</div>}
              {detailTab === "specs" && <div className="observed-specs">{(item.attributes ?? []).map((attribute, index) => <div key={`${attribute.name}-${index}`}><span>{attribute.name}</span><strong>{attribute.value}</strong></div>)}{!item.attributes?.length && <div className="observed-empty">A ficha técnica não apareceu na leitura pública.</div>}</div>}
              <div className="observed-links">
                <div className="copy-line link-line"><span>{item.permalink}</span><CopyButton value={item.permalink} label="Copiar link" /></div>
                {item.checkedAt && <small>Dados observados em {formatDate(item.checkedAt, true)}</small>}
                {item.error && <small className="error-text">{userFacingCode(item.errorCode, "Os detalhes deste anúncio ficaram incompletos.")}</small>}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function UnofficialPanel({ csrf, requestLocalSession, onActivity, onTrack, lockOpen, onOpenLock }: { csrf: string | null; requestLocalSession: () => Promise<string>; onActivity: (text: string) => void; onTrack: (activity: { action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> }) => void; lockOpen?: boolean; onOpenLock?: () => void }) {
  const savedConfig = useMemo(
    () => normalizeUnofficialConfig(stored<unknown>("mlam_unofficial_config", null)),
    [],
  );
  const [enabled, setEnabled] = useState(savedConfig.enabled);
  const [locked, setLocked] = useState(true);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [mode, setMode] = useState<"seller" | "product">(savedConfig.mode as "seller" | "product");
  const [url, setUrl] = useState(savedConfig.url);
  const [productQuery, setProductQuery] = useState(savedConfig.query);
  const [limitMode, setLimitMode] = useState<"limited" | "all">(savedConfig.limitMode as "limited" | "all");
  const [maxItems, setMaxItems] = useState(savedConfig.maxItems);
  const [inspectPix, setInspectPix] = useState(savedConfig.inspectPix);
  const [scan, setScan] = useState<UnofficialScan | null>(() => stored<UnofficialScan | null>("mlam_unofficial_scan", null));
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"seller" | "product" | "archived">("seller");
  const [selectedItem, setSelectedItem] = useState<ObservedListing | null>(null);
  const [observedFilter, setObservedFilter] = useState(savedConfig.observedFilter);
  const [observedSort, setObservedSort] = useState(savedConfig.observedSort);
  const [observedSearch, setObservedSearch] = useState("");
  const [observedSeller, setObservedSeller] = useState("");
  const [observedMinPrice, setObservedMinPrice] = useState("");
  const [observedMaxPrice, setObservedMaxPrice] = useState("");
  const [observedMinSales, setObservedMinSales] = useState("");
  const [observedPage, setObservedPage] = useState(1);
  const [observedPageSize, setObservedPageSize] = useState(30);
  const [selectedObserved, setSelectedObserved] = useState<Set<string>>(() => new Set(stored<string[]>("mlam_unofficial_selection", [])));
  const [terminalView, setTerminalView] = useState<"closed" | "process" | "errors">("closed");
  const [catalogParticipants, setCatalogParticipants] = useState<{ catalogProductId: string; participants: RankingParticipant[] } | null>(null);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ previousScan: UnofficialScan } | null>(null);
  const [sameDataNotice, setSameDataNotice] = useState<string | null>(null);
  const [archivedScans, setArchivedScans] = useState<Array<{ id: string; date: string; mode: string; query: string; items: ObservedListing[]; pagesRead: number; pixCount: number }>>(
    () => stored<Array<{ id: string; date: string; mode: string; query: string; items: ObservedListing[]; pagesRead: number; pixCount: number }>>("mlam_unofficial_archive", []),
  );
  const archivedRef = useRef(archivedScans);
  useEffect(() => { archivedRef.current = archivedScans; }, [archivedScans]);
  const visibleItems = useMemo(() => {
    const normalizedSearch = observedSearch.trim().toLocaleLowerCase("pt-BR");
    const normalizedSeller = observedSeller.trim().toLocaleLowerCase("pt-BR");
    const minPrice = Number(observedMinPrice);
    const maxPrice = Number(observedMaxPrice);
    const minSales = Number(observedMinSales);
    const filtered = (scan?.items ?? []).filter((item) =>
      (!normalizedSearch || [item.id, item.title, item.categoryId, item.catalogProductId].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalizedSearch))) &&
      (!normalizedSeller || [item.seller?.nickname, item.seller?.id].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalizedSeller))) &&
      (!observedMinPrice || (item.price != null && item.price >= minPrice)) &&
      (!observedMaxPrice || (item.price != null && item.price <= maxPrice)) &&
      (!observedMinSales || (item.soldQuantity != null && item.soldQuantity >= minSales)) &&
      (observedFilter === "all" ||
      (observedFilter === "pix" && item.pixObserved === true) ||
      (observedFilter === "no_pix" && item.pixObserved === false) ||
      (observedFilter === "catalog" && item.catalogListing) ||
      (observedFilter === "non_catalog" && !item.catalogListing) ||
      (observedFilter === "new" && item.condition === "new") ||
      (observedFilter === "used" && item.condition === "used") ||
      (observedFilter === "free_shipping" && item.shipping?.freeShipping === true) ||
      (observedFilter === "with_stock" && (item.availableQuantity ?? 0) > 0) ||
      (observedFilter === "with_rating" && (item.rating ?? 0) > 0) ||
      (observedFilter === "with_error" && Boolean(item.error))),
    );
    return filtered.sort((a, b) => {
      if (observedSort === "sold_desc") return (b.soldQuantity ?? -1) - (a.soldQuantity ?? -1);
      if (observedSort === "price_asc") return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
      if (observedSort === "price_desc") return (b.price ?? -1) - (a.price ?? -1);
      if (observedSort === "newest") return new Date(b.dateCreated ?? 0).getTime() - new Date(a.dateCreated ?? 0).getTime();
      if (observedSort === "discount_desc") {
        const discount = (item: ObservedListing) => item.originalPrice && item.price ? 1 - item.price / item.originalPrice : 0;
        return discount(b) - discount(a);
      }
      return a.sourceRank - b.sourceRank;
    });
  }, [scan?.items, observedFilter, observedSort, observedSearch, observedSeller, observedMinPrice, observedMaxPrice, observedMinSales]);
  const observedTotalPages = Math.max(1, Math.ceil(visibleItems.length / observedPageSize));
  const pagedObservedItems = visibleItems.slice((observedPage - 1) * observedPageSize, observedPage * observedPageSize);
  const scanLogs = scan?.logs ?? [];
  const scanErrors = scanLogs.filter((entry) => entry.level === "error");

  useEffect(() => {
    if (!csrf || !scan || !["queued", "running"].includes(scan.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getUnofficialScan(scan.id);
        setScan(next);
        onActivity(["queued", "running"].includes(next.status) ? next.phase : "");
        if (next.status === "completed") {
          onTrack({ action: "unofficial.complete", targetType: "public-page", targetId: next.id, metadata: { total: next.items.length, pix: next.items.filter((item) => item.pixObserved).length } });
          // Compare with archived scans
          const queryKey = next.mode === "product" ? next.query ?? "" : next.sourceUrl;
          const recentArchive = archivedRef.current.find((a) => a.query === queryKey);
          if (recentArchive && next.items.length > 0) {
            const oldIds = new Set(recentArchive.items.map((i) => i.id));
            const newIds = new Set(next.items.map((i) => i.id));
            const overlap = [...newIds].filter((id) => oldIds.has(id)).length;
            const added = [...newIds].filter((id) => !oldIds.has(id)).length;
            const removed = [...oldIds].filter((id) => !newIds.has(id)).length;
            const changedPrices = next.items.filter((item) => {
              const old = recentArchive.items.find((i) => i.id === item.id);
              return old && old.price !== item.price;
            }).length;
            if (overlap / Math.max(newIds.size, 1) >= 0.8) {
              const parts = [`${next.items.length} itens (${Math.round((overlap / newIds.size) * 100)}% iguais à consulta anterior)`];
              if (added > 0) parts.push(`${added} novos`);
              if (removed > 0) parts.push(`${removed} removidos`);
              if (changedPrices > 0) parts.push(`${changedPrices} com preço alterado`);
              if (added === 0 && removed === 0 && changedPrices === 0) {
                setSameDataNotice("Nenhuma alteração detectada. Os dados permanecem iguais à consulta anterior.");
              } else {
                setSameDataNotice(parts.join(" · "));
              }
            } else {
              setSameDataNotice(null);
            }
          }
        }
      } catch (reason) {
        setError(message(reason));
        const code = reason && typeof reason === "object" && "code" in reason
          ? String((reason as { code?: unknown }).code ?? "")
          : "";
        if (code === "SCAN_NOT_FOUND") {
          setScan((current) => current ? {
            ...current,
            status: "failed",
            waiting: false,
            phase: "A consulta anterior foi encerrada.",
            errorCode: "SCAN_NOT_FOUND",
          } : null);
          onActivity("");
        }
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [csrf, scan?.id, scan?.status]);
  useEffect(() => {
    localStorage.setItem("mlam_unofficial_config", JSON.stringify({ enabled, mode, url, query: productQuery, limitMode, maxItems, inspectPix, observedFilter, observedSort }));
  }, [enabled, mode, url, productQuery, limitMode, maxItems, inspectPix, observedFilter, observedSort]);
  useEffect(() => {
    if (scan) localStorage.setItem("mlam_unofficial_scan", JSON.stringify(scan));
    else localStorage.removeItem("mlam_unofficial_scan");
  }, [scan]);
  useEffect(() => {
    setObservedPage(1);
  }, [observedFilter, observedSort, observedSearch, observedSeller, observedMinPrice, observedMaxPrice, observedMinSales, observedPageSize, scan?.id]);
  useEffect(() => {
    localStorage.setItem("mlam_unofficial_selection", JSON.stringify([...selectedObserved]));
  }, [selectedObserved]);
  useEffect(() => {
    localStorage.setItem("mlam_unofficial_archive", JSON.stringify(archivedScans));
  }, [archivedScans]);
  useEffect(() => {
    const clear = () => { setEnabled(false); setMode("seller"); setUrl(""); setProductQuery(""); setLimitMode("limited"); setMaxItems(30); setInspectPix(true); setObservedFilter("all"); setObservedSort("source"); setObservedSearch(""); setObservedSeller(""); setObservedMinPrice(""); setObservedMaxPrice(""); setObservedMinSales(""); setSelectedObserved(new Set()); setTerminalView("closed"); setScan(null); };
    window.addEventListener("mlam-reset", clear);
    return () => window.removeEventListener("mlam-reset", clear);
  }, []);

  const submit = async () => {
    setError("");
    if (scan?.items.length) {
      setArchiveConfirm({ previousScan: scan });
      return;
    }
    await doSubmit();
  };

  const doSubmit = async (archivePrevious = true) => {
    setError("");
    onActivity("Preparando a leitura pública…");
    const previousScan = archiveConfirm?.previousScan ?? null;
    setArchiveConfirm(null);
    setScan(null);
    setCatalogParticipants(null);
    setSameDataNotice(null);
    if (previousScan && archivePrevious) {
      setArchivedScans((prev) => [{
        id: previousScan.id,
        date: new Date().toISOString(),
        mode: previousScan.mode,
        query: previousScan.mode === "product" ? previousScan.query ?? "" : previousScan.sourceUrl,
        items: previousScan.items,
        pagesRead: previousScan.pagesRead,
        pixCount: previousScan.items.filter((item) => item.pixObserved).length,
      }, ...prev].slice(0, 20));
    }
    try {
      const localCsrf = csrf ?? await requestLocalSession();
      const input = { mode, url: mode === "seller" ? url : undefined, query: mode === "product" ? productQuery : undefined, limitMode, maxItems: limitMode === "limited" ? maxItems : undefined, inspectPix } as const;
      setSelectedObserved(new Set());
      setObservedPage(1);
      setScan(await startUnofficialScan(localCsrf, input));
      setViewMode(mode);
      onTrack({ action: "unofficial.start", targetType: mode === "seller" ? "public-page" : "public-search", targetId: mode === "seller" ? url : productQuery, metadata: { mode, limitMode, maxItems: limitMode === "limited" ? maxItems : "all", inspectPix } });
    } catch (reason) {
      setError(message(reason));
      onActivity("");
    }
  };
  return (
    <section className={`unofficial-panel ${enabled ? "enabled" : ""}`}>
      <div className="unofficial-head">
        <div><span className="source-badge unofficial"><Radio />Opcional · não oficial</span></div>
        <button className={`toggle-switch ${enabled ? "on" : ""}`} onClick={() => { if (!enabled && locked) { setLockModalOpen(true); return; } if (enabled) { setEnabled(false); setLocked(true); return; } setEnabled(true); }} aria-pressed={enabled}><i />{enabled ? "Ativado" : locked ? "Ativar" : "Ativar"}</button>
      </div>
      {enabled ? (
        <>
          <div className="unofficial-mode-tabs">
            <button className={viewMode === "seller" ? "active" : ""} onClick={() => { setViewMode("seller"); setMode("seller"); }}><Store />URL do anunciante</button>
            <button className={viewMode === "product" ? "active" : ""} onClick={() => { setViewMode("product"); setMode("product"); }}><Search />Nome do produto</button>
            <button className={viewMode === "archived" ? "active" : ""} onClick={() => setViewMode("archived")}>{archivedScans.length > 0 && <><Archive /> Arquivados <span className="archive-count">{archivedScans.length}</span></> || <><Archive /> Arquivados</>}</button>
          </div>
          {viewMode !== "archived" && (
          <>
          <div className="unofficial-form expanded">
            {mode === "seller"
              ? <label className="field url-field"><span>URL da página ou loja</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.mercadolivre.com.br/loja/..." /></label>
              : <label className="field url-field"><span>Nome do produto</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Ex.: Furadeira Bosch GSB 13 RE" /></label>}
            <label className="field compact-field"><span>Quantidade</span><select value={limitMode} onChange={(event) => setLimitMode(event.target.value as "limited" | "all")}><option value="limited">Definir limite</option><option value="all">Buscar todos</option></select></label>
            {limitMode === "limited" && <label className="field quantity-field"><span>Máximo</span><input type="number" min="1" max="2000" value={maxItems} onChange={(event) => setMaxItems(Math.max(1, Number(event.target.value) || 1))} /></label>}
            <button className="button primary" disabled={(mode === "seller" ? !url.trim() : productQuery.trim().length < 2) || scan?.status === "running" || scan?.status === "queued"} onClick={submit}>{mode === "seller" ? <Store /> : <Search />}{mode === "seller" ? "Ler loja" : "Buscar ofertas"}</button>
          </div>
          <div className="unofficial-options">
            <label className="check pix-check"><input type="checkbox" checked={inspectPix} onChange={(event) => setInspectPix(event.target.checked)} /><span className="fake-check">{inspectPix && <Check size={13} />}</span>Verificar Pix explícito</label>
            <div className="cooldown-notice"><ShieldCheck /><div><strong>Pausas de segurança sempre ativas</strong><span>Intervalos variáveis: 4,5–8 s entre páginas e 2,8–5 s entre anúncios.</span></div></div>
          </div>
          <p className="unofficial-warning">"Buscar todos" percorre até 100 páginas e pode levar bastante tempo. É possível cancelar sem perder os itens já observados.</p>
          {error && <div className="notice danger"><AlertTriangle />{error}</div>}
          {scan && ["queued", "running"].includes(scan.status) && (
            <div className="scan-progress">
              <div>{scan.waiting ? <Clock3 /> : <LoaderCircle className="spin" />}<span><strong>{scan.phase}</strong><small>{scan.waiting ? `Cooldown ativo · ${((scan.cooldownMs || 0) / 1000).toFixed(1)} s programados` : `Aguarde um momento… ${scan.processed} de ${scan.total || "—"} · ${scan.pagesRead || 0} página(s)`}</small></span><b>{scan.progress}%</b></div>
              <div className="progress"><i style={{ width: `${scan.progress}%` }} /></div>
              <button className="text-button" onClick={async () => { const token = csrf ?? await requestLocalSession(); setScan(await cancelUnofficialScan(token, scan.id)); }}>Cancelar</button>
            </div>
          )}
          {scan?.status === "auth_required" && (
            <div className="notice warning">
              <AlertTriangle />
              <div>
                <strong>O Mercado Livre solicitou autenticação.</strong>
                <span>Faça login na sua conta oficial e depois clique em "Retomar consulta".</span>
              </div>
              {!connected && applicationReady && (
                <a className="auth-connect" href={authStartUrl()}>Fazer login</a>
              )}
              <button className="button" onClick={async () => { const token = csrf ?? await requestLocalSession(); setScan(await resumeUnofficialScan(token, scan.id)); onTrack({ action: "unofficial.resume", targetType: "scan", targetId: scan.id }); }}>
                <RefreshCw /> Retomar consulta
              </button>
            </div>
          )}
          {scan?.status === "failed" && <div className="notice danger"><AlertTriangle />{userFacingCode(scan.errorCode, "A leitura não foi concluída.")}</div>}
          {scan?.partial && <div className="notice"><AlertTriangle />A consulta chegou ao limite técnico de 100 páginas. Os resultados obtidos continuam disponíveis.</div>}
          {scan?.status === "completed" && sameDataNotice && (
            <div className="notice" style={{ borderColor: "#cfe0d6", background: "#f3faf6", color: "#286044" }}>
              <ShieldCheck size={14} />
              <span>{sameDataNotice}</span>
              <button className="text-button" onClick={() => setSameDataNotice(null)} style={{ marginLeft: "auto" }}><X size={12} /></button>
            </div>
          )}
          {scan && <div className="scan-console-wrap">
            <div className="scan-console-actions">
              <button className={terminalView === "process" ? "active" : ""} onClick={() => setTerminalView((value) => value === "process" ? "closed" : "process")}>Terminal <span>{scanLogs.length}</span></button>
              <button className={terminalView === "errors" ? "active error" : ""} onClick={() => setTerminalView((value) => value === "errors" ? "closed" : "errors")}>Erros <span>{scanErrors.length}</span></button>
            </div>
            {terminalView !== "closed" && <div className="scan-console" role="log" aria-live="polite">
              <div className="scan-console-head"><strong>{terminalView === "errors" ? "Erros da consulta" : "Processo da consulta"}</strong><button onClick={() => setTerminalView("closed")} aria-label="Fechar terminal"><X /></button></div>
              <div>{(terminalView === "errors" ? scanErrors : scanLogs).map((entry, index) => <p className={entry.level} key={`${entry.at}-${index}`}><time>{new Date(entry.at).toLocaleTimeString("pt-BR")}</time><span>{entry.message}</span>{entry.code && <code>{entry.code}</code>}</p>)}</div>
              {terminalView === "process" && !scanLogs.length && <p className="info"><time>agora</time><span>{scan.phase}</span></p>}
              {terminalView === "errors" && !scanErrors.length && <div className="scan-console-empty">Nenhum erro registrado nesta consulta.</div>}
            </div>}
          </div>}
          {!!scan?.items.length && (
            <div className="observed-results">
              <div className="observed-results-head"><div><strong>{scan.items.length} anúncios observados</strong><span>{scan.mode === "product" ? `Ofertas públicas para “${scan.query}”` : `${scan.pagesRead || 1} página(s) da loja`} · {scan.items.filter((item) => item.pixObserved).length} com Pix explícito · {selectedObserved.size} selecionados</span></div><div><select value={observedFilter} onChange={(event) => setObservedFilter(event.target.value)} aria-label="Filtrar leitura pública"><option value="all">Todos</option><option value="pix">Pix observado</option><option value="no_pix">Sem Pix explícito</option><option value="catalog">Somente catálogo</option><option value="non_catalog">Fora do catálogo</option><option value="new">Produtos novos</option><option value="used">Produtos usados</option><option value="free_shipping">Frete grátis</option><option value="with_stock">Com estoque</option><option value="with_rating">Com avaliação</option><option value="with_error">Com erro de leitura</option></select><select value={observedSort} onChange={(event) => setObservedSort(event.target.value)} aria-label="Ordenar leitura pública"><option value="source">Ordem encontrada</option><option value="sold_desc">Mais vendidos</option><option value="newest">Anúncios mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="discount_desc">Maior desconto</option></select></div></div>
              <div className="observed-filter-grid">
                <label><span>Buscar</span><input value={observedSearch} onChange={(event) => setObservedSearch(event.target.value)} placeholder="Título, MLB ou categoria" /></label>
                <label><span>Vendedor</span><input value={observedSeller} onChange={(event) => setObservedSeller(event.target.value)} placeholder="Nome ou ID" /></label>
                <label><span>Preço mínimo</span><input inputMode="decimal" value={observedMinPrice} onChange={(event) => setObservedMinPrice(event.target.value)} placeholder="R$ 0" /></label>
                <label><span>Preço máximo</span><input inputMode="decimal" value={observedMaxPrice} onChange={(event) => setObservedMaxPrice(event.target.value)} placeholder="Sem limite" /></label>
                <label><span>Vendas mínimas</span><input inputMode="numeric" value={observedMinSales} onChange={(event) => setObservedMinSales(event.target.value)} placeholder="0" /></label>
                <button className="text-button" onClick={() => { setObservedSearch(""); setObservedSeller(""); setObservedMinPrice(""); setObservedMaxPrice(""); setObservedMinSales(""); setObservedFilter("all"); }}>Limpar filtros</button>
              </div>
              <div className="observed-selection-bar"><button className="text-button" onClick={() => setSelectedObserved(new Set(visibleItems.map((item) => item.id)))}>Selecionar resultados filtrados</button><button className="text-button" onClick={() => setSelectedObserved(new Set())}>Limpar seleção</button></div>
              <div className="observed-grid">
                {pagedObservedItems.map((item) => (
                  <article key={item.id} className={selectedObserved.has(item.id) ? "selected" : ""}>
                    <label className="observed-select"><input type="checkbox" checked={selectedObserved.has(item.id)} onChange={() => setSelectedObserved((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><span>{selectedObserved.has(item.id) ? <SquareCheckBig /> : <Square />}</span></label>
                    <div className="observed-image">{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <PackageSearch />}</div>
                    <div className="observed-card-body"><div className="copy-line"><small>{item.id}</small><CopyButton value={item.id} label="Copiar ID" /></div><h3>{item.title}</h3><strong>{formatCurrency(item.price, item.currencyId)}</strong><div className="observed-card-meta"><span>{item.seller?.nickname || (item.seller?.id ? `Vendedor ${item.seller.id}` : "Vendedor não identificado")}</span><span>{item.soldQuantity != null ? `${formatNumber(item.soldQuantity)} vendidos` : "Vendas não exibidas"}</span></div><div className="observed-card-tags">{item.catalogListing && <b>Catálogo</b>}{item.condition && <b>{item.condition === "new" ? "Novo" : "Usado"}</b>}{item.shipping?.freeShipping && <b>Frete grátis</b>}<span className={`pix-state ${item.pixObserved ? "yes" : item.pixObserved === false ? "no" : "unknown"}`}>{item.pixObserved ? "Pix observado" : item.pixObserved === false ? "Sem Pix explícito" : "Não verificado"}</span></div></div>
                    <div className="observed-actions"><button className="button small" onClick={() => setSelectedItem(item)}><Eye />Visualizar</button>{item.catalogListing && item.catalogProductId && <button className="button small" onClick={async () => { setLoadingParticipants(true); try { const result = await getCatalogParticipants(item.catalogProductId!); setCatalogParticipants({ catalogProductId: item.catalogProductId!, participants: result.participants }); } catch { setError("Não foi possível carregar os concorrentes."); } finally { setLoadingParticipants(false); } }}>{loadingParticipants ? <LoaderCircle className="spin" /> : <Users />}Concorrentes</button>}<a className="icon-button" href={item.permalink} target="_blank" rel="noreferrer" title="Abrir no Mercado Livre"><ExternalLink /></a><CopyButton value={item.permalink} label="Copiar link" /></div>
                  </article>
                ))}
              </div>
              {!visibleItems.length && <div className="observed-empty">Nenhum anúncio corresponde a este filtro.</div>}
              {!!visibleItems.length && <div className="observed-pagination"><label>Exibir <select value={observedPageSize} onChange={(event) => setObservedPageSize(Number(event.target.value))}><option value="30">30</option><option value="60">60</option><option value="100">100</option><option value="200">200</option></select></label><span>{(observedPage - 1) * observedPageSize + 1}–{Math.min(observedPage * observedPageSize, visibleItems.length)} de {visibleItems.length}</span><div><button disabled={observedPage <= 1} onClick={() => setObservedPage((page) => Math.max(1, page - 1))}><ChevronLeft /></button><b>Página {observedPage} de {observedTotalPages}</b><button disabled={observedPage >= observedTotalPages} onClick={() => setObservedPage((page) => Math.min(observedTotalPages, page + 1))}><ChevronRight /></button></div></div>}
              {catalogParticipants && (
                <div className="observed-ranking">
                  <div className="observed-ranking-head">
                    <strong>Concorrentes no catálogo</strong>
                    <small>{catalogParticipants.participants.length} participantes</small>
                    <button className="text-button" onClick={() => setCatalogParticipants(null)}><X size={14} />Fechar</button>
                  </div>
                  <div className="observed-ranking-list">
                    {catalogParticipants.participants.map((p, i) => (
                      <div key={p.itemId} className="observed-ranking-row">
                        <b className="rank-pos">{i + 1}º</b>
                        <span className="rank-seller">{p.sellerNickname || p.sellerId}</span>
                        <span className="rank-price">{formatCurrency(p.price, p.currencyId)}</span>
                        {p.freeShipping && <b className="rank-tag">Frete grátis</b>}
                        {p.powerSellerStatus && <b className="rank-tag">{p.powerSellerStatus === "platinum" ? "Platinum" : p.powerSellerStatus === "gold" ? "Gold" : "Líder"}</b>}
                        <a href={p.permalink ?? "#"} target="_blank" rel="noreferrer" className="rank-link"><ExternalLink size={12} /></a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
          {viewMode === "archived" && (
            <div className="observed-results">
              <div className="observed-results-head">
                <div><strong>{archivedScans.length} consultas arquivadas</strong><span>Resultados de buscas anteriores preservados para consulta</span></div>
                <button className="text-button" onClick={() => { if (window.confirm("Apagar todo o arquivo?")) setArchivedScans([]); }}><Trash2 size={14} />Limpar arquivo</button>
              </div>
              {archivedScans.length === 0 && <div className="observed-empty">Nenhuma consulta arquivada. Faça uma nova busca para começar.</div>}
              {archivedScans.map((archive) => (
                <details key={archive.id} className="archive-group" open>
                  <summary className="archive-summary">
                    <strong>{archive.mode === "product" ? archive.query : "Loja"}</strong>
                    <span>{new Date(archive.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <small>{archive.items.length} itens · {archive.pagesRead} pág. · {archive.pixCount} Pix</small>
                    <button className="text-button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setArchivedScans((prev) => prev.filter((a) => a.id !== archive.id)); }} title="Remover"><X size={12} /></button>
                  </summary>
                  <div className="observed-grid">
                    {archive.items.slice(0, 30).map((item) => (
                      <article key={item.id} className={selectedObserved.has(item.id) ? "selected" : ""}>
                        <div className="observed-image">{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <PackageSearch />}</div>
                        <div className="observed-card-body">
                          <div className="copy-line"><small>{item.id}</small><CopyButton value={item.id} label="Copiar ID" /></div>
                          <h3>{item.title}</h3>
                          <strong>{formatCurrency(item.price, item.currencyId)}</strong>
                          <div className="observed-card-meta">
                            <span>{item.seller?.nickname || "Vendedor não identificado"}</span>
                            <span>{item.soldQuantity != null ? `${formatNumber(item.soldQuantity)} vendidos` : "Vendas não exibidas"}</span>
                          </div>
                          <div className="observed-card-tags">
                            {item.catalogListing && <b>Catálogo</b>}
                            {item.condition && <b>{item.condition === "new" ? "Novo" : "Usado"}</b>}
                            {item.shipping?.freeShipping && <b>Frete grátis</b>}
                            <span className={`pix-state ${item.pixObserved ? "yes" : item.pixObserved === false ? "no" : "unknown"}`}>{item.pixObserved ? "Pix" : item.pixObserved === false ? "Sem Pix" : "N/A"}</span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {archive.items.length > 30 && <p className="archive-more">+{archive.items.length - 30} itens adicionais não exibidos</p>}
                </details>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="unofficial-placeholder">
          <Lock />
          <div>
            <strong>Consultas desativadas</strong>
            <span>Ative o recurso e defina um código de liberação para acessar as consultas públicas.</span>
          </div>
        </div>
      )}
      {selectedItem && <ObservedListingModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {archiveConfirm && (
        <div className="modal-backdrop" onMouseDown={() => setArchiveConfirm(null)}>
          <section className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><p className="eyebrow">Arquivar consulta</p><h2>Deseja arquivar?</h2></div>
              <button className="icon-button" onClick={() => setArchiveConfirm(null)}><X /></button>
            </div>
            <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
              A consulta atual tem <strong>{archiveConfirm.previousScan.items.length} itens</strong> e será movida para os arquivados. Iniciar uma nova consulta limpará os resultados atuais.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={async () => { const scan = archiveConfirm.previousScan; setArchiveConfirm(null); setScan(scan); setError(""); onActivity(""); }}>
                Cancelar
              </button>
              <button className="button" onClick={() => { setArchiveConfirm(null); void doSubmit(false); }}>
                Iniciar sem arquivar
              </button>
              <button className="button primary" onClick={() => void doSubmit(true)}>
                <Archive size={14} />
                Arquivar e iniciar
              </button>
            </div>
          </section>
        </div>
      )}
      {(lockModalOpen || lockOpen) && <LockModal csrfToken={csrf} onUnlock={() => { setLocked(false); setEnabled(true); setLockModalOpen(false); onOpenLock?.(); }} onClose={() => { setLockModalOpen(false); onOpenLock?.(); }} />}
    </section>
  );
}

function FilterPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onClose?: () => void;
}) {
  const set = (key: keyof Filters, value: string | string[]) =>
    onChange({ ...filters, [key]: value });
  const toggleStatus = (status: string) =>
    set(
      "statuses",
      filters.statuses.includes(status)
        ? filters.statuses.filter((v) => v !== status)
        : [...filters.statuses, status],
    );
  return (
    <aside className="filter-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Refinar resultados</p>
          <h2>Filtros</h2>
        </div>
        {onClose && (
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar filtros"
          >
            <X />
          </button>
        )}
      </div>
      <fieldset>
        <legend>Status</legend>
        {[
          ["active", "Ativos"],
          ["paused", "Pausados"],
          ["closed", "Encerrados"],
          ["under_review", "Em revisão"],
        ].map(([value, label]) => (
          <label className="check" key={value}>
            <input
              type="checkbox"
              checked={filters.statuses.includes(value)}
              onChange={() => toggleStatus(value)}
            />
            <span className="fake-check">
              {filters.statuses.includes(value) && <Check size={13} />}
            </span>
            {label}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Estoque</span>
        <select
          value={filters.stock}
          onChange={(e) => set("stock", e.target.value)}
        >
          <option value="">Qualquer estoque</option>
          <option value="with">Com estoque</option>
          <option value="without">Sem estoque</option>
        </select>
      </label>
      <label className="field">
        <span>Vendas</span>
        <select
          value={filters.sales}
          onChange={(e) => set("sales", e.target.value)}
        >
          <option value="">Qualquer volume</option>
          <option value="with">Com vendas</option>
          <option value="zero">Zero vendas acumuladas</option>
          <option value="none_7">Sem venda detectada em 7 dias</option>
          <option value="none_15">Sem venda detectada em 15 dias</option>
          <option value="none_30">Sem venda detectada em 30 dias</option>
          <option value="none_60">Sem venda detectada em 60 dias</option>
          <option value="none_90">Sem venda detectada em 90 dias</option>
        </select>
      </label>
      <label className="field">
        <span>Tempo ativo</span>
        <select
          value={filters.age}
          onChange={(e) => set("age", e.target.value)}
        >
          <option value="">Qualquer idade</option>
          <option value="lt7">Menos de 7 dias</option>
          <option value="7_30">7 a 30 dias</option>
          <option value="31_60">31 a 60 dias</option>
          <option value="61_90">61 a 90 dias</option>
          <option value="gt90">Mais de 90 dias</option>
          <option value="gt180">Mais de 180 dias</option>
          <option value="gt365">Mais de 365 dias</option>
        </select>
      </label>
      <label className="field">
        <span>Catálogo</span>
        <select
          value={filters.catalog}
          onChange={(e) => set("catalog", e.target.value)}
        >
          <option value="">Todos</option>
          <option value="catalog">Anúncios de catálogo</option>
          <option value="traditional">Anúncios tradicionais</option>
          <option value="associated">Associados a produto</option>
        </select>
      </label>
      <label className="field">
        <span>Promoção e Pix</span>
        <select
          value={filters.promotion}
          onChange={(e) => set("promotion", e.target.value)}
        >
          <option value="">Todas</option>
          <option value="active">Ativa</option>
          <option value="future">Futura</option>
          <option value="ended">Encerrada</option>
          <option value="none">Sem promoção identificada</option>
          <option value="pix">Com campanha Pix</option>
          <option value="pix_active">Campanha Pix ativa</option>
          <option value="pix_future">Campanha Pix programada</option>
          <option value="no_pix">Sem campanha Pix</option>
        </select>
        <small>Campanhas identificadas na última atualização.</small>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Condição</span>
          <select value={filters.condition} onChange={(e) => set("condition", e.target.value)}>
            <option value="">Todas</option><option value="new">Novo</option><option value="used">Usado</option>
          </select>
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={filters.listingType} onChange={(e) => set("listingType", e.target.value)}>
            <option value="">Todos</option><option value="gold_pro">Premium</option><option value="gold_special">Clássico</option><option value="free">Grátis</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>ID da categoria</span>
        <input value={filters.categoryId} onChange={(e) => set("categoryId", e.target.value)} placeholder="Ex.: MLB33447" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Preço mínimo</span>
          <input
            inputMode="decimal"
            value={filters.minPrice}
            onChange={(e) => set("minPrice", e.target.value)}
            placeholder="R$ 0"
          />
        </label>
        <label className="field">
          <span>Preço máximo</span>
          <input
            inputMode="decimal"
            value={filters.maxPrice}
            onChange={(e) => set("maxPrice", e.target.value)}
            placeholder="Sem limite"
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>Desconto mín.</span><input inputMode="numeric" value={filters.minDiscount} onChange={(e) => set("minDiscount", e.target.value)} placeholder="0%" /></label>
        <label className="field"><span>Desconto máx.</span><input inputMode="numeric" value={filters.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} placeholder="100%" /></label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Criado de</span>
          <input
            type="date"
            value={filters.createdFrom}
            onChange={(e) => set("createdFrom", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Até</span>
          <input
            type="date"
            value={filters.createdTo}
            onChange={(e) => set("createdTo", e.target.value)}
          />
        </label>
      </div>
    </aside>
  );
}

function competitionStatus(value?: string | null) {
  if (value === "winning") return "Ganhando";
  if (value === "sharing_first_place") return "1º lugar compartilhado";
  if (value === "competing") return "Competindo";
  if (value === "listed") return "Listado";
  return "Sem status";
}

function RankingPanel({ itemId, currencyId }: { itemId: string; currencyId: string }) {
  const [ranking, setRanking] = useState<ListingRanking | null>(null);
  const [loadingRanking, setLoadingRanking] = useState(true);
  const [rankingError, setRankingError] = useState("");
  const [sort, setSort] = useState<"position" | "price" | "sales">("position");
  const [filter, setFilter] = useState<"all" | "mine" | "winner" | "free_shipping" | "full">("all");

  useEffect(() => {
    const controller = new AbortController();
    setLoadingRanking(true);
    setRankingError("");
    getListingRanking(itemId, controller.signal)
      .then(setRanking)
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setRankingError(message(reason)); })
      .finally(() => setLoadingRanking(false));
    return () => controller.abort();
  }, [itemId]);

  const visible = useMemo(() => {
    const values = [...(ranking?.participants ?? [])].filter((participant) =>
      filter === "all" ||
      (filter === "mine" && participant.mine) ||
      (filter === "winner" && participant.winner) ||
      (filter === "free_shipping" && participant.freeShipping) ||
      (filter === "full" && participant.logisticType === "fulfillment"),
    );
    if (sort === "price") values.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
    if (sort === "sales") values.sort((a, b) => (b.sellerSales ?? b.soldQuantity ?? 0) - (a.sellerSales ?? a.soldQuantity ?? 0));
    return values;
  }, [ranking, sort, filter]);

  if (loadingRanking) return <div className="ranking-loading"><LoaderCircle className="spin" /><div><strong>Montando o ranking</strong><span>Aguarde um momento enquanto consultamos a competição.</span></div></div>;
  if (rankingError) return <div className="notice danger"><AlertTriangle />{rankingError}</div>;
  if (!ranking?.available) return <div className="ranking-empty"><Trophy /><strong>Ranking indisponível</strong><p>{ranking?.message}</p></div>;

  return <section className="ranking-panel">
    <div className="ranking-summary">
      <article><span>Sua posição</span><strong>{competitionStatus(ranking.status)}</strong></article>
      <article><span>Preço competitivo</span><strong>{formatCurrency(ranking.priceToWin, currencyId)}</strong></article>
      <article><span>Participantes visíveis</span><strong>{ranking.participants.length}</strong></article>
      <article><span>Visibilidade</span><strong>{ranking.visitShare ?? "—"}</strong></article>
    </div>
    {ranking.message && <div className="ranking-note"><CircleHelp />{ranking.message}</div>}
    <div className="ranking-toolbar">
      <div><Trophy /><div><strong>Ranking da página de produto</strong><span>Ordenação local com dados retornados pela API.</span></div></div>
      <div>
        <label><span>Mostrar</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Todos</option><option value="mine">Minha conta</option><option value="winner">Vencedor</option><option value="free_shipping">Frete grátis</option><option value="full">Envio Full</option></select></label>
        <label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="position">Posição retornada</option><option value="price">Menor preço</option><option value="sales">Mais vendas</option></select></label>
      </div>
    </div>
    <div className="ranking-list">
      {visible.map((participant, index) => <article className={`${participant.winner ? "winner" : ""} ${participant.mine ? "mine" : ""}`} key={participant.itemId}>
        <div className="ranking-position">{participant.winner ? <Trophy /> : <strong>{index + 1}</strong>}</div>
        {participant.thumbnail ? <img src={participant.thumbnail} alt="" /> : <div className="ranking-image-placeholder"><Store /></div>}
        <div className="ranking-seller">
          <div><strong>{participant.sellerNickname || `Seller ${participant.sellerId}`}</strong>{participant.mine && <span className="mine-badge"><BadgeCheck />Sua conta</span>}{participant.winner && <span className="winner-badge">Vencedor</span>}</div>
          <span>{participant.itemId}</span>
          <div className="ranking-tags">
            {participant.powerSellerStatus && <b>{participant.powerSellerStatus.replaceAll("_", " ")}</b>}
            {participant.freeShipping && <b><Truck />Frete grátis</b>}
            {participant.logisticType === "fulfillment" && <b>Full</b>}
            {participant.sellerSales != null && <b><Users />{formatNumber(participant.sellerSales)} vendas</b>}
          </div>
        </div>
        <div className="ranking-price">
          {participant.originalPrice && participant.price && participant.originalPrice > participant.price && <del>{formatCurrency(participant.originalPrice, participant.currencyId)}</del>}
          <strong>{formatCurrency(participant.price, participant.currencyId)}</strong>
          {participant.discountPercent ? <span>{participant.discountPercent}% OFF</span> : null}
          {participant.permalink && <a href={participant.permalink} target="_blank" rel="noreferrer">Ver anúncio <ExternalLink /></a>}
        </div>
      </article>)}
      {!visible.length && <div className="ranking-empty compact"><Filter /><strong>Nenhum participante neste filtro</strong></div>}
    </div>
    <small className="ranking-source">Fonte: {ranking.source === "official_product_items" ? "participantes da competição retornados pela API" : "resumo oficial da competição"}.</small>
  </section>;
}

function DetailDrawer({
  item,
  loading,
  onClose,
}: {
  item: ListingDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"custom" | "ranking" | "official">("custom");
  useEffect(() => setTab("custom"), [item?.id]);
  const attributeValue = (ids: string[]) => item?.attributes?.find((attribute) =>
    ids.includes(String(attribute.id ?? "").toUpperCase()) ||
    ids.includes(String(attribute.name ?? "").toUpperCase()),
  )?.valueName ?? null;
  const usefulIdentifiers = item ? [
    ["GTIN / EAN", attributeValue(["GTIN", "EAN", "CÓDIGO UNIVERSAL DE PRODUTO"])],
    ["SKU", attributeValue(["SELLER_SKU", "SKU"])],
    ["Marca", attributeValue(["BRAND", "MARCA"])],
    ["Modelo", attributeValue(["MODEL", "MODELO"])],
    ["MPN", attributeValue(["MPN"])],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])) : [];
  const shipping = item?.shipping ?? {};
  const shippingMode = typeof shipping.mode === "string" ? shipping.mode : item?.shippingMode;
  const logisticType = typeof shipping.logistic_type === "string" ? shipping.logistic_type : null;
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="drawer detail-modal"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Detalhes do anúncio"
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Detalhes do anúncio</p>
            <h2>{loading ? "Carregando…" : item?.id}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        {!loading && item?.permalink && (
          <div className="view-tabs">
            <button className={tab === "custom" ? "active" : ""} onClick={() => setTab("custom")}>Meu visual</button>
            {item.catalogProductId && <button className={tab === "ranking" ? "active" : ""} onClick={() => setTab("ranking")}><Trophy />Ranking</button>}
            <button className={tab === "official" ? "active" : ""} onClick={() => setTab("official")}>Página oficial</button>
          </div>
        )}
        {!loading && item && tab === "ranking" ? <RankingPanel itemId={item.id} currencyId={item.currencyId ?? "BRL"} /> : !loading && item?.permalink && tab === "official" ? (
          <div className="official-frame-wrap drawer-frame">
            <div className="external-page-placeholder"><ExternalLink /><h3>A página oficial abre em uma nova guia</h3><p>O Mercado Livre não permite incorporar esta página dentro do painel.</p></div>
            <a className="button" href={item.permalink} target="_blank" rel="noreferrer">Abrir em nova guia <ExternalLink /></a>
          </div>
        ) : loading ? (
          <div className="drawer-loading">
            <LoaderCircle className="spin" />
            <span>Buscando dados pesados sob demanda</span>
          </div>
        ) : (
          item && (
            <div className="drawer-body">
              <div className="gallery">
                {item.pictures?.slice(0, 5).map((picture, index) => (
                  <img
                    src={picture.url}
                    alt={`${item.title} — foto ${index + 1}`}
                    key={picture.url}
                  />
                ))}
              </div>
              <div className="copy-line"><h3>{item.title}</h3><CopyButton value={item.title} label="Copiar título" /></div>
              <div className="copy-line detail-id"><code>{item.id}</code><CopyButton value={item.id} label="Copiar ID" /></div>
              <div className="detail-grid">
                <div>
                  <span>Status</span>
                  <StatusPill status={item.status} />
                </div>
                <div>
                  <span>Preço</span>
                  <strong>
                    {formatCurrency(item.price, item.currencyId ?? "BRL")}
                  </strong>
                </div>
                <div>
                  <span>Estoque</span>
                  <strong>{formatNumber(item.availableQuantity)}</strong>
                </div>
                <div>
                  <span>Vendidos</span>
                  <strong>{formatNumber(item.soldQuantity)}</strong>
                </div>
              </div>
              <div className="detail-grid detail-commercial">
                <div><span>Condição</span><strong>{item.condition === "new" ? "Novo" : item.condition === "used" ? "Usado" : item.condition || "—"}</strong></div>
                <div><span>Tipo de anúncio</span><strong>{item.listingTypeId || "—"}</strong></div>
                <div><span>Categoria</span><strong>{item.categoryId || "—"}</strong></div>
                <div><span>Catálogo</span><strong>{item.catalogListing ? "Anúncio de catálogo" : item.catalogProductId ? "Associado a produto" : "Tradicional"}</strong></div>
                <div><span>Produto de catálogo</span><strong>{item.catalogProductId || "—"}</strong></div>
                <div><span>Frete</span><strong>{item.freeShipping ? "Grátis" : "Padrão"}{shippingMode ? ` · ${shippingMode}` : ""}{logisticType ? ` · ${logisticType}` : ""}</strong></div>
                <div><span>Criado em</span><strong>{formatDate(item.createdAt, true)}</strong></div>
                <div><span>Atualizado em</span><strong>{formatDate(item.updatedAt, true)}</strong></div>
              </div>
              {!!usefulIdentifiers.length && <section className="commercial-identifiers">
                <h4>Identificação comercial</h4>
                <div>{usefulIdentifiers.map(([label, value]) => <div className="copy-line" key={label}><span><small>{label}</small><strong>{value}</strong></span><CopyButton value={value} label={`Copiar ${label}`} /></div>)}</div>
              </section>}
              {item.permalink && <div className="copy-line link-line"><span>{item.permalink}</span><CopyButton value={item.permalink} label="Copiar link" /></div>}
              {!!item.pictures?.length && <div className="copy-line link-line"><span>Links das {item.pictures.length} imagens</span><CopyButton value={item.pictures.map((picture) => picture.url).join("\n")} label="Copiar links das imagens" /></div>}
              <section>
                <h4>Descrição</h4>
                <p className="description">
                  {item.description || "Descrição não disponibilizada."}
                </p>
              </section>
              <section>
                <h4>Atributos</h4>
                <dl className="attribute-list">
                  {item.attributes?.map((a, i) => (
                    <div key={`${a.id}-${i}`}>
                      <dt>{a.name || a.id}</dt>
                      <dd>{a.valueName || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {!!item.variations?.length && (
                <section>
                  <h4>Variações</h4>
                  {item.variations.map((v) => (
                    <div className="variation" key={v.id}>
                      <strong>{v.sku || v.id}</strong>
                      <span>
                        {formatNumber(v.availableQuantity)} em estoque
                      </span>
                    </div>
                  ))}
                </section>
              )}
              {!!item.unavailableFields?.length && (
                <div className="notice">
                  <CircleHelp size={18} />
                  <div>
                    <strong>Limitações oficiais</strong>
                    <p>{item.unavailableFields.join(" · ")}</p>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </aside>
    </div>
  );
}

function BulkDialog({
  selected,
  csrf,
  payload,
  onClose,
  onFinished,
}: {
  selected: number;
  csrf: string | null;
  payload: SelectionPayload;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [type, setType] = useState<BulkActionType>("pause");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<"fixed" | "percentage">("fixed");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [job, setJob] = useState<BulkJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const needsValue = !["pause", "activate", "close"].includes(type);
  const makePreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await previewBulk(
          csrf,
          payload,
          {
            type,
            value: needsValue
              ? type === "set_sku"
                ? value
                : Number(value)
              : undefined,
            unit,
          },
          key.current,
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const first = await executeBulk(csrf, preview, key.current);
      setJob(first);
      const timer = window.setInterval(async () => {
        const next = await getBulkJob(first.id).catch(() => null);
        if (!next) return;
        setJob(next);
        if (["completed", "failed", "cancelled"].includes(next.status)) {
          window.clearInterval(timer);
          setBusy(false);
          onFinished();
        }
      }, 800);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Operação protegida</p>
            <h2>Alteração em massa</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy}>
            <X />
          </button>
        </div>
        {!preview && !job && (
          <>
            <p className="modal-intro">
              Revise uma ação para{" "}
              <strong>{formatNumber(selected)} anúncio(s)</strong>. Nada será
              enviado antes da confirmação.
            </p>
            <label className="field">
              <span>Ação</span>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as BulkActionType);
                  key.current = crypto.randomUUID();
                }}
              >
                {Object.entries(actionLabels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {needsValue && (
              <div className="field-row">
                <label className="field">
                  <span>Novo valor</span>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={type === "set_sku" ? "SKU" : "0"}
                  />
                </label>
                {["increase_price", "decrease_price"].includes(type) && (
                  <label className="field">
                    <span>Tipo</span>
                    <select
                      value={unit}
                      onChange={(e) =>
                        setUnit(e.target.value as "fixed" | "percentage")
                      }
                    >
                      <option value="fixed">Valor</option>
                      <option value="percentage">Percentual</option>
                    </select>
                  </label>
                )}
              </div>
            )}
            <button
              className="button primary full"
              disabled={busy || (needsValue && !value)}
              onClick={makePreview}
            >
              {busy ? <LoaderCircle className="spin" /> : <SlidersHorizontal />}
              Gerar prévia segura
            </button>
          </>
        )}
        {preview && !job && (
          <>
            <div className="preview-summary">
              <div>
                <span>Válidos</span>
                <strong>{preview.valid}</strong>
              </div>
              <div>
                <span>Com impedimento</span>
                <strong>{preview.invalid}</strong>
              </div>
            </div>
            {preview.warnings.map((w) => (
              <div className="notice danger" key={w}>
                <AlertTriangle size={18} />
                {w}
              </div>
            ))}
            <div className="preview-list">
              {preview.items.slice(0, 12).map((i) => (
                <div key={i.id}>
                  <span>
                    <strong>{i.id}</strong>
                    {i.title}
                  </span>
                  <span>
                    {String(i.currentValue ?? "—")} →{" "}
                    <b>{String(i.newValue ?? "—")}</b>
                    {i.message && <small>{i.message}</small>}
                  </span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="button"
                onClick={() => {
                  setPreview(null);
                  key.current = crypto.randomUUID();
                }}
              >
                Voltar
              </button>
              <button
                className="button danger-button"
                disabled={busy || preview.valid === 0}
                onClick={execute}
              >
                {busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}
                Confirmar e executar
              </button>
            </div>
          </>
        )}
        {job && (
          <div className="job-state">
            <LoaderCircle className={busy ? "spin" : ""} />
            <h3>{busy ? "Processando em lotes" : "Operação concluída"}</h3>
            <p>
              {job.processed} de {job.total} · {job.successes} sucessos ·{" "}
              {job.failures} falhas
            </p>
            <div className="progress">
              <i
                style={{
                  width: `${job.total ? (job.processed / job.total) * 100 : 0}%`,
                }}
              />
            </div>
            {!busy && (
              <button className="button primary" onClick={onClose}>
                Fechar relatório
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="notice danger">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const online = useOnlineStatus();
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [officialChecking, setOfficialChecking] = useState(false);
  const [guestMode, setGuestMode] = useState(
    () => localStorage.getItem("mlam_guest") === "true",
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("mlam_theme") === "dark" ? "dark" : "light");
  const [activeTab, setActiveTab] = useState<"listings" | "unofficial" | "history">(() => {
    const saved = localStorage.getItem("mlam_tab");
    return saved === "history" || saved === "unofficial" ? saved : "listings";
  });
  const [account, setAccount] = useState<Account | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [query, setQuery] = useState<ListingQuery>(() => {
    try {
      const saved = localStorage.getItem("mlam_filters");
      return saved
        ? { ...DEFAULT_QUERY, ...JSON.parse(saved), page: 1 }
        : DEFAULT_QUERY;
    } catch {
      return DEFAULT_QUERY;
    }
  });
  const [searchInput, setSearchInput] = useState(query.search);
  const search = useDebouncedValue(searchInput);
  const [data, setData] = useState<ListingsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const [allFiltered, setAllFiltered] = useState(false);
  const [excluded, setExcluded] = useState(new Set<string>());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [lockSettingsOpen, setLockSettingsOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [alphaBotOpen, setAlphaBotOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const [activityMessage, setActivityMessage] = useState("");
  const [messageIndex, setMessageIndex] = useState(0);
  const [importantMsg, setImportantMsg] = useState<{ text: string; id: number } | null>(null);
  const prevOnlineRef = useRef(online);
  const prevSyncStatusRef = useRef(sync?.status);
  const prevActivityRef = useRef(activityMessage);
  const pollRef = useRef<number>();

  useEffect(() => {
    if (!importantMsg) return;
    const timer = setTimeout(() => setImportantMsg(null), 12000);
    return () => clearTimeout(timer);
  }, [importantMsg?.id]);
  const track = useCallback((activity: { action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> }) => {
    if (session?.csrfToken) void recordActivity(session.csrfToken, activity).catch(() => undefined);
  }, [session?.csrfToken]);

  const loadListings = useCallback(
    async (next = query) => {
      const controller = new AbortController();
      setLoading(true);
      setError("");
      try {
        setData(await getListings(next, controller.signal));
      } catch (e) {
        if (!(e instanceof DOMException)) setError(message(e));
      } finally {
        setLoading(false);
      }
      return () => controller.abort();
    },
    [query],
  );
  const bootstrapOfficial = useCallback(async () => {
    setOfficialChecking(true);
    setError("");
    try {
      const s = await getSession();
        const setupStatus = await getSetup();
        setSession(s);
        setSetup(setupStatus);
        void recordActivity(s.csrfToken, { action: "ui.open", metadata: { path: location.pathname } }).catch(() => undefined);
        if (s.authenticated) {
          localStorage.setItem("mlam_official_session", "true");
          localStorage.removeItem("mlam_guest");
          setGuestMode(false);
          const [a, sy] = await Promise.all([getAccount(), getSync()]);
          setAccount(a);
          setSync(sy);
        }
        return setupStatus;
    } catch (reason) {
      setError(message(reason));
      return null;
    } finally {
      setOfficialChecking(false);
      setLoading(false);
    }
  }, []);
  const connectOfficial = useCallback(async () => {
    const status = setup ?? await bootstrapOfficial();
    if (status?.mercadoLivreConfigured && status.application?.secureRedirect) {
      location.href = authStartUrl();
      return;
    }
    if (status) setError("A conexão oficial exige uma URL HTTPS cadastrada no aplicativo. Código: MLAM-AUT-002.");
  }, [setup, bootstrapOfficial]);
  useEffect(() => {
    const returnedFromAuthorization = new URLSearchParams(location.search).get("auth") === "success";
    if (!guestMode && (returnedFromAuthorization || localStorage.getItem("mlam_official_session") === "true")) {
      void bootstrapOfficial();
      return;
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    const restoreAfterExternalPage = () => setOfficialChecking(false);
    window.addEventListener("pageshow", restoreAfterExternalPage);
    return () => window.removeEventListener("pageshow", restoreAfterExternalPage);
  }, []);

  const requestLocalSession = useCallback(async (): Promise<string> => {
    const [localSession, setupStatus] = await Promise.all([getSession(), getSetup()]);
    if (!localSession.csrfToken) {
      throw new Error("O serviço local não iniciou uma sessão válida.");
    }
    setSession(localSession);
    setSetup(setupStatus);
    return localSession.csrfToken;
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mlam_theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("mlam_tab", activeTab);
  }, [activeTab]);
  useEffect(() => {
    if (!session?.csrfToken) return;
    const beat = () => void heartbeat(session.csrfToken).catch(() => undefined);
    const timer = window.setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", beat); };
  }, [session?.csrfToken]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const next = {
      ...query,
      search,
      page: query.search === search ? query.page : 1,
    };
    setQuery((current) => (current.search === search ? current : next));
    void loadListings(next);
  }, [
    session?.authenticated,
    query.page,
    query.pageSize,
    query.filters,
    query.sort,
    query.scoreEnabled,
    search,
  ]);
  useEffect(() => {
    localStorage.setItem(
      "mlam_filters",
      JSON.stringify({ ...query, page: 1 }),
    );
  }, [query.search, query.filters, query.sort, query.pageSize, query.scoreEnabled]);
  useEffect(() => {
    if (!sync || !["queued", "running", "cancelling"].includes(sync.status))
      return;
    pollRef.current = window.setInterval(async () => {
      const next = await getSync().catch(() => null);
      if (next) {
        setSync(next);
        if (!["queued", "running", "cancelling"].includes(next.status)) {
          window.clearInterval(pollRef.current);
          void loadListings();
        }
      }
    }, 900);
    return () => window.clearInterval(pollRef.current);
  }, [sync?.status]);

  useEffect(() => {
    const prev = prevSyncStatusRef.current;
    prevSyncStatusRef.current = sync?.status;
    if (prev === "running" && sync?.status === "completed") {
      setImportantMsg({ text: `Sincronização concluída. ${formatNumber(data?.total ?? 0)} anúncios atualizados.`, id: Date.now() });
    }
    if (prev === "running" && sync?.status === "failed") {
      setImportantMsg({ text: "Falha na sincronização. Verifique a conexão da conta.", id: Date.now() });
    }
  }, [sync?.status, data?.total]);

  useEffect(() => {
    const prev = prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (prev && !online) setImportantMsg({ text: "Sem conexão com a internet. Os dados podem estar desatualizados.", id: Date.now() });
    if (!prev && online) setImportantMsg({ text: "Conexão restaurada. Os dados estão disponíveis novamente.", id: Date.now() });
  }, [online]);

  useEffect(() => {
    const prev = prevActivityRef.current;
    prevActivityRef.current = activityMessage;
    if (prev && !activityMessage) {
      setImportantMsg({ text: "Leitura pública concluída.", id: Date.now() });
    }
  }, [activityMessage]);

  const updateFilters = (filters: Filters) => {
    setQuery((q) => ({ ...q, filters, page: 1 }));
    setSelected(new Set());
    setAllFiltered(false);
    track({ action: "ui.filters", metadata: { active: filters.statuses.length + Object.entries(filters).filter(([key, value]) => key !== "statuses" && Boolean(value)).length } });
  };
  const reset = () => {
    setSearchInput("");
    setQuery({ ...DEFAULT_QUERY, filters: { ...EMPTY_FILTERS } });
    setSelected(new Set());
    setExcluded(new Set());
    setAllFiltered(false);
    track({ action: "ui.reset" });
    for (const key of Object.keys(localStorage)) if (key.startsWith("mlam_")) localStorage.removeItem(key);
    setTheme("light");
    setActiveTab("listings");
    window.dispatchEvent(new Event("mlam-reset"));
  };
  const pageIds = data?.items.map((i) => i.id) ?? [];
  const pageSelected =
    pageIds.length > 0 &&
    pageIds.every((id) => (allFiltered ? !excluded.has(id) : selected.has(id)));
  const count = allFiltered
    ? Math.max(0, (data?.total ?? 0) - excluded.size)
    : selected.size;
  const toggle = (id: string) => {
    if (allFiltered) {
      setExcluded((old) => {
        const n = new Set(old);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
    } else {
      setSelected((old) => {
        const n = new Set(old);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
    }
  };
  const togglePage = () => {
    if (allFiltered) {
      setExcluded((old) => {
        const n = new Set(old);
        pageIds.forEach((id) => (pageSelected ? n.add(id) : n.delete(id)));
        return n;
      });
    } else {
      setSelected((old) => {
        const n = new Set(old);
        pageIds.forEach((id) => (pageSelected ? n.delete(id) : n.add(id)));
        return n;
      });
    }
  };
  const selectionPayload: SelectionPayload = allFiltered
    ? {
        mode: "allFiltered",
        excludedIds: [...excluded],
        filters: {
          search: query.search,
          filters: query.filters,
          sort: query.sort,
          scoreEnabled: query.scoreEnabled,
        },
      }
    : { mode: "explicit", ids: [...selected] };
  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    track({ action: "listing.view", targetType: "listing", targetId: id });
    try {
      setDetail(await getListing(id));
    } catch (e) {
      setError(message(e));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };
  const doSync = async () => {
    if (!session?.authenticated) return;
    try {
      setSync(await startSync(session?.csrfToken ?? null));
    } catch (e) {
      setError(message(e));
    }
  };
  const doExport = async () => {
    if (!session?.authenticated) return;
    try {
      track({ action: "export.start", targetType: "listings", metadata: { selected: selected.size, allFiltered } });
      const params = listingsSearchParams({ ...query, page: 1, pageSize: 200 });
      if (!allFiltered && selected.size)
        params.set("ids", [...selected].join(","));
      const { blob, filename } = await exportListings(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "anuncios.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(message(e));
    }
  };
  const activeFilterCount =
    query.filters.statuses.length +
    Object.entries(query.filters).filter(
      ([k, v]) => k !== "statuses" && Boolean(v),
    ).length;

  const connected = Boolean(session?.authenticated);
  const applicationReady = Boolean(setup?.mercadoLivreConfigured && setup?.application?.secureRedirect);
  const publicModeWithoutOfficialApi = guestMode && !session;

  const highlightMsg = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|\d[\d.,]*(?:\s*(?:anúncios|filtros|selecionados|processados|páginas|pontos|itens|min|h|d|[km]?bytes?))\b|conectad[oa]|desconectad[oa]|ativo|ativo|desativado|sincronizad[oa]|sincronização|atualizado|concluído|concluída|erro|falha|atenção|importante|obrigatório|opcional|seguro|oficial|não oficial)/gi);
    if (parts.length === 1) return <>{text}</>;
    return <>{parts.map((part, i) => {
      if (/^(\*\*[^*]+\*\*|\d[\d.,]*(?:\s*(?:anúncios|filtros|selecionados|processados|páginas|pontos|itens|min|h|d|[km]?bytes?))\b|conectad[oa]|desconectad[oa]|ativo|desativado|sincronizad[oa]|sincronização|atualizado|concluído|concluída|erro|falha|atenção|importante|obrigatório|opcional|seguro|oficial|não oficial)$/i.test(part)) {
        const clean = part.replace(/^\*\*|\*\*$/g, "");
        return <strong key={i} className="msg-highlight">{clean}</strong>;
      }
      if (/^(\*\*[^*]+\*\*|\d+)$/.test(part)) {
        const clean = part.replace(/^\*\*|\*\*$/g, "");
        return <strong key={i}>{clean}</strong>;
      }
      return <Fragment key={i}>{part}</Fragment>;
    })}</>;
  };

  const liveMessages = useMemo(() => {
    if (activityMessage) return [
      activityMessage,
      "A leitura continua em segundo plano. Aguarde um momento…",
      "Os resultados aparecem conforme cada etapa termina.",
    ];
    if (sync && ["queued", "running", "cancelling"].includes(sync.status)) return [
      sync.phase || "Atualizando anúncios…",
      `${sync.processed || 0} de ${sync.total ?? "—"} processados`,
      "Mantendo as consultas em ritmo seguro.",
    ];
    if (sync?.status === "completed") return [
      `Sincronização concluída. **${formatNumber(data?.total ?? 0)}** anúncios atualizados.`,
      `Última sincronização: ${formatDate(sync.lastSyncedAt!, true)}.`,
      "Os dados estão prontos para consulta e alterações.",
    ];
    if (sync?.status === "failed") return [
      "A sincronização encontrou um erro.",
      "Verifique a conexão da conta e tente novamente.",
      "Dados anteriores continuam disponíveis para consulta.",
    ];
    if (loading) return [
      "Organizando os anúncios…",
      "Aplicando filtros e ordenação…",
      "Aguarde um momento enquanto os dados são carregados.",
    ];
    if (!connected) return [
      "Modo de consulta: nenhuma alteração será enviada.",
      "Você pode testar uma página pública sem conectar a conta.",
      "Conecte a conta quando quiser usar dados e ações oficiais.",
      "O modo por URL é opcional e não altera anúncios.",
    ];

    const msgs: string[] = [];
    msgs.push(`${formatNumber(data?.total ?? 0)} anúncios na visualização atual.`);
    if (activeFilterCount) msgs.push(`${activeFilterCount} filtros estão ativos.`);
    else msgs.push("Todos os filtros estão disponíveis para combinar.");
    if (count) msgs.push(`${formatNumber(count)} anúncios selecionados para revisão.`);
    else msgs.push("Selecione anúncios para aplicar alterações em massa.");
    msgs.push(online ? "Conexão ativa. Os dados estão prontos para consulta." : "Sem conexão com a internet no momento.");
    msgs.push(query.scoreEnabled ? "Pontuação interna ativa nos resultados." : "Pontuação interna desativada.");
    msgs.push("Use os ícones de cópia para guardar títulos, IDs e links.");
    msgs.push("O Pix oficial e o Pix observado são fontes diferentes.");
    if (sync?.lastSyncedAt) msgs.push(`Última sincronização: ${formatDate(sync.lastSyncedAt, true)}.`);
    else msgs.push("Faça a primeira sincronização quando a conta estiver conectada.");
    return msgs;
  }, [activityMessage, sync, loading, connected, data?.total, activeFilterCount, count, online, query.scoreEnabled]);

  useEffect(() => {
    setMessageIndex(0);
    const timer = window.setInterval(() => setMessageIndex((value) => value + 1), 8000);
    return () => window.clearInterval(timer);
  }, [liveMessages.join("|")]);
  const enterGuest = () => {
    localStorage.setItem("mlam_guest", "true");
    localStorage.setItem("mlam_tab", "unofficial");
    setGuestMode(true);
    setActiveTab("unofficial");
    setError("");
    setData({
      items: [],
      page: 1,
      pageSize: 30,
      total: 0,
      totalPages: 1,
      hasNext: false,
    });
  };
  const performFullReset = async () => {
    if (resetConfirmation !== "CONFIRMAR") return;
    setResetting(true); setResetError("");
    try {
      const token = session?.csrfToken ?? await requestLocalSession();
      await resetAllData(token, resetConfirmation);
      localStorage.clear();
      location.href = "/";
    } catch (reason) {
      setResetError(message(reason));
      setResetting(false);
    }
  };

  function Skeleton({ width, height, radius = 6, style }: { width?: string | number; height?: string | number; radius?: number; style?: React.CSSProperties }) {
    const bg = theme === "dark" ? "#2a2e33" : "#e8ece8";
    const sk = theme === "dark" ? "#333840" : "#f2f5f2";
    return (
      <div
        style={{
          width: width ?? "100%",
          height: height ?? 16,
          borderRadius: radius,
          background: `linear-gradient(90deg, ${bg} 25%, ${sk} 50%, ${bg} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.4s ease-in-out infinite",
          ...style,
        }}
      />
    );
  }

  if (!connected && !guestMode)
    return (
      <LoginScreen
        sessionError={error || undefined}
        setup={setup}
        checking={officialChecking}
        onCheckOfficial={() => void bootstrapOfficial()}
        onContinue={enterGuest}
        theme={theme}
      />
    );
  return (
    <div className={`app-shell ${activeTab}`}>
      <header className="topbar">
        <div className="brand compact">
          <img className="brand-mark" src={`/${theme === "dark" ? "icone-escuro" : "icone-claro"}.png`} alt="MarketSync" />
          <span>MarketSync</span>
        </div>
        <div className="topbar-message" aria-live="polite">
          <Radio size={12} />
          {importantMsg ? (
            <span className="topbar-msg-important" onClick={() => setImportantMsg(null)}>
              <span className="msg-badge">Importante</span>
              {highlightMsg(importantMsg.text)}
            </span>
          ) : (
            <span className="topbar-msg-text" key={messageIndex}>{highlightMsg(liveMessages[messageIndex % liveMessages.length])}</span>
          )}
        </div>
        <div className="auth-center" aria-label="Conexões do sistema">
          <div className={`auth-chip ${applicationReady ? "connected" : publicModeWithoutOfficialApi ? "" : "attention"}`}>
            <KeyRound />
            <div><span>Aplicativo</span><strong>{publicModeWithoutOfficialApi ? "Opcional neste modo" : applicationReady ? "Pronto" : "Não conectado"}</strong></div>
            <a href="https://developers.mercadolivre.com.br/devcenter" target="_blank" rel="noreferrer" title="Abrir DevCenter"><ExternalLink /></a>
          </div>
          <div className={`auth-chip ${connected ? "connected" : "disconnected"}`}>
            <Store />
            <div><span>Conta dos anúncios</span><strong>{connected ? `${account?.nickname || "Conectada"} · ${account?.sellerId || ""}` : "Não conectada"}</strong></div>
            {connected ? <button title="Desconectar conta" onClick={async () => { await logout(session?.csrfToken ?? null); localStorage.removeItem("mlam_official_session"); location.href = "/"; }}><LogOut /></button>
              : applicationReady ? <a className="auth-connect" href={authStartUrl()}>Conectar</a>
                : <button className="auth-connect-button" disabled={officialChecking} onClick={() => void connectOfficial()}>{officialChecking ? "Verificando…" : "Conectar"}</button>}
          </div>
        </div>
        <div className="header-tools">
          <span className={`online-dot ${online ? "on" : ""}`} title={online ? "Internet disponível" : "Sem internet"} />
          <button className={`icon-button alpha-bot-btn ${alphaBotOpen ? "active" : ""}`} title="AlphaBot" onClick={() => setAlphaBotOpen((value) => !value)}>
            <img src="/alphabot.png" alt="AlphaBot" style={{ width: 22, height: 22, borderRadius: 5 }} />
          </button>
          <div className="settings-wrap">
            <button className={`icon-button ${settingsOpen ? "active" : ""}`} title="Configurações" onClick={() => setSettingsOpen((value) => !value)}><Settings /></button>
            {settingsOpen && <div className="settings-popover">
              <strong>Configurações</strong>
              <button onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); track({ action: "ui.theme", metadata: { theme: next } }); }}>{theme === "dark" ? <Sun /> : <Moon />}<span>{theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}</span></button>
              <button onClick={() => { setLockSettingsOpen(true); setSettingsOpen(false); }}><Lock /><span>Código de liberação</span></button>
              {!connected && <button onClick={() => { localStorage.removeItem("mlam_guest"); setGuestMode(false); setSettingsOpen(false); }}><LogOut /><span>Sair do modo sem conta</span></button>}
              <button className="danger" onClick={() => { setResetOpen(true); setSettingsOpen(false); }}><Trash2 /><span>Apagar todos os dados</span></button>
            </div>}
          </div>
        </div>
      </header>
      <nav className="page-tabs" aria-label="Áreas do sistema">
        <button className={activeTab === "listings" ? "active" : ""} onClick={() => { setActiveTab("listings"); track({ action: "ui.tab", metadata: { tab: "listings" } }); }}><PackageSearch />Anúncios oficiais</button>
        <button className={activeTab === "unofficial" ? "active" : ""} onClick={() => { setActiveTab("unofficial"); track({ action: "ui.tab", metadata: { tab: "unofficial" } }); }}><Radio />Consultas públicas</button>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => { setActiveTab("history"); track({ action: "ui.tab", metadata: { tab: "history" } }); }}><History />Histórico</button>
      </nav>
      <div className="workspace">
        {activeTab === "listings" && <>
          <div className={`mobile-filter ${filtersOpen ? "open" : ""}`}>
            {filtersOpen && (
              <FilterPanel filters={query.filters} onChange={updateFilters} onClose={() => setFiltersOpen(false)} />
            )}
          </div>
          {loading ? (
            <aside className="filter-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Refinar resultados</p><h2>Filtros</h2></div>
              </div>
              <fieldset><legend>Status</legend>
                <Skeleton height={18} style={{ marginBottom: 6 }} />
                <Skeleton height={18} style={{ marginBottom: 6 }} />
                <Skeleton height={18} style={{ marginBottom: 6 }} />
                <Skeleton height={18} />
              </fieldset>
              <Skeleton height={34} style={{ marginBottom: 14 }} />
              <Skeleton height={34} style={{ marginBottom: 14 }} />
              <Skeleton height={34} style={{ marginBottom: 14 }} />
              <Skeleton height={34} />
            </aside>
          ) : (
            <FilterPanel filters={query.filters} onChange={updateFilters} />
          )}
        </>}
        <main className="content">
          <section className="page-head">
            <div>
              <h1>{activeTab === "history" ? "Histórico" : activeTab === "unofficial" ? "Consultas públicas" : "Meus anúncios"}</h1>
              <p className="subtitle">
                {activeTab === "history" ? "Sessões, sincronizações e movimentos registrados." : activeTab === "unofficial" ? "Buscas opcionais por loja ou produto, separadas da conta oficial." : "Encontre, selecione e altere somente o que precisar."}
              </p>
            </div>
            {activeTab === "listings" && <div className="head-actions">
              <button
                className="button"
                onClick={doExport}
                disabled={!connected}
              >
                <FileSpreadsheet />
                Baixar Excel
              </button>
              <button
                className="button primary"
                onClick={doSync}
                disabled={!connected || sync?.status === "running"}
              >
                {sync?.status === "running" ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <RefreshCw />
                )}
                Sincronizar
              </button>
            </div>}
          </section>
          {activeTab === "history" ? <HistoryPanel /> : activeTab === "unofficial" ? <UnofficialPanel csrf={session?.csrfToken ?? null} requestLocalSession={requestLocalSession} onActivity={setActivityMessage} onTrack={track} lockOpen={lockSettingsOpen} onOpenLock={() => setLockSettingsOpen(false)} /> : <>
          {sync && sync.status !== "idle" && (
            <section className={`sync-strip ${sync.status}`}>
              <div>
                <RefreshCw
                  className={sync.status === "running" ? "spin" : ""}
                />
                <span>
                  <strong>
                    {sync.status === "completed"
                      ? "Sincronização concluída"
                      : sync.status === "failed"
                        ? "Falha na sincronização"
                        : "Sincronizando anúncios"}
                  </strong>
                  <small>
                    {sync.lastSyncedAt
                      ? `Última atualização ${formatDate(sync.lastSyncedAt, true)}`
                      : `${sync.processed} de ${sync.total ?? "—"}`}
                  </small>
                </span>
              </div>
              <div className="sync-progress">
                <i style={{ width: `${sync.progress ?? 0}%` }} />
              </div>
              {sync.canCancel && (
                <button
                  onClick={async () =>
                    setSync(await cancelSync(session?.csrfToken ?? null))
                  }
                >
                  Cancelar
                </button>
              )}
            </section>
          )}
          {sync?.status === "completed" && sync.changes && (
            <section className="change-summary-strip">
              <strong>O que mudou nesta sincronização</strong>
              <span className="change added">{sync.changes.added ?? 0} adicionados</span>
              <span className="change updated">{sync.changes.updated ?? 0} alterados</span>
              <span className="change removed">{sync.changes.removed ?? 0} não retornaram</span>
              <span className="change unchanged">{sync.changes.unchanged ?? 0} sem mudanças</span>
            </section>
          )}
          {error && (
            <div className="notice danger global">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X />
              </button>
            </div>
          )}
          <section className="toolbar">
            <div className="searchbox">
              <Search />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por título, ID, SKU ou categoria"
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="button filter-button"
              onClick={() => setFiltersOpen(true)}
            >
              <Filter />
              Filtros {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </button>
            <label className="sort">
              <ArrowDownUp />
              <select
                value={query.sort}
                onChange={(e) =>
                  setQuery((q) => ({
                    ...q,
                    sort: e.target.value as ListingQuery["sort"],
                    page: 1,
                  }))
                }
              >
                <option value="created_desc">Mais recentes</option>
                <option value="created_asc">Mais antigos</option>
                <option value="price_desc">Maior preço</option>
                <option value="price_asc">Menor preço</option>
                <option value="stock_desc">Maior estoque</option>
                <option value="stock_asc">Menor estoque</option>
                <option value="sold_desc">Mais vendidos</option>
                <option value="sold_asc">Menos vendidos</option>
                <option value="age_desc">Maior tempo ativo</option>
                <option value="age_asc">Menor tempo ativo</option>
                <option value="discount_desc">Maior desconto</option>
                <option value="discount_asc">Menor desconto</option>
                <option value="title_asc">Título A–Z</option>
                <option value="title_desc">Título Z–A</option>
                {query.scoreEnabled && (
                  <option value="score_desc">Pontuação interna</option>
                )}
              </select>
            </label>
            <button
              className={`toggle-switch ${query.scoreEnabled ? "on" : ""}`}
              title="Métrica interna: vendas até 35 pontos, estoque 15, status ativo 20, catálogo 10 e qualidade oficial até 20."
              onClick={() =>
                setQuery((q) => ({
                  ...q,
                  scoreEnabled: !q.scoreEnabled,
                  sort: q.sort.startsWith("score_") ? "created_desc" : q.sort,
                  page: 1,
                }))
              }
            >
              <i />
              Pontuação {query.scoreEnabled ? "ativa" : "desativada"}
            </button>
            <button className="text-button" onClick={reset}>
              Resetar informações
            </button>
          </section>
          {(activeFilterCount > 0 || query.search) && (
            <div className="chips">
              {query.search && (
                <button onClick={() => setSearchInput("")}>
                  Busca: {query.search}
                  <X />
                </button>
              )}
              {query.filters.statuses.map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    updateFilters({
                      ...query.filters,
                      statuses: query.filters.statuses.filter((v) => v !== s),
                    })
                  }
                >
                  {statusLabel(s)}
                  <X />
                </button>
              ))}
              {activeFilterCount > query.filters.statuses.length && (
                <button onClick={() => updateFilters({ ...EMPTY_FILTERS })}>
                  Outros filtros:{" "}
                  {activeFilterCount - query.filters.statuses.length}
                  <X />
                </button>
              )}
            </div>
          )}
          <section className="results-head">
            <div>
              <strong>
                {loading
                  ? "Consultando…"
                  : `${formatNumber(data?.total ?? 0)} anúncios encontrados`}
              </strong>
              {loading && <span className="inline-wait"><LoaderCircle className="spin" /> Aguarde um momento…</span>}
              <small>
                {count > 0 && `${formatNumber(count)} selecionado(s)`}
              </small>
            </div>
            {count > 0 && (
              <div className="selection-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(new Set());
                    setAllFiltered(false);
                    setExcluded(new Set());
                  }}
                >
                  Desmarcar
                </button>
                <button
                  className="button primary small"
                  onClick={() => setBulkOpen(true)}
                >
                  <SlidersHorizontal />
                  Alterar em massa
                </button>
              </div>
            )}
          </section>
          {pageSelected &&
            !allFiltered &&
            (data?.total ?? 0) > pageIds.length && (
              <div className="select-all-banner">
                Os {pageIds.length} anúncios desta página estão selecionados.{" "}
                <button
                  onClick={() => {
                    setAllFiltered(true);
                    setSelected(new Set());
                  }}
                >
                  Selecionar todos os {data?.total} resultados
                </button>
              </div>
            )}
          {loading && !data?.items.length && (
            <div style={{ padding: "0 24px" }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 10, padding: "8px 14px", borderRadius: 6, background: "var(--surface-soft)" }}>
                <Skeleton width={28} height={28} />
                <Skeleton width="18%" height={14} />
                <Skeleton width="35%" height={14} />
                <Skeleton width="10%" height={14} />
                <Skeleton width="8%" height={14} />
                <Skeleton width="8%" height={14} />
                <Skeleton width="6%" height={14} />
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
                  <Skeleton width={18} height={18} radius={3} />
                  <Skeleton width="18%" height={13} />
                  <Skeleton width="35%" height={13} />
                  <Skeleton width="10%" height={13} />
                  <Skeleton width="8%" height={13} />
                  <Skeleton width="8%" height={13} />
                  <Skeleton width="6%" height={13} />
                </div>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="select-cell">
                    <button className="check-button" onClick={togglePage}>
                      {pageSelected ? <SquareCheckBig /> : <Square />}
                    </button>
                  </th>
                  <th>Anúncio</th>
                  <th>Status</th>
                  <th>Preço</th>
                  <th>Estoque</th>
                  <th>Vendidos</th>
                  <th>Catálogo</th>
                  <th>Tempo ativo</th>
                  <th>Atualização</th>
                  <th>Pontuação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item) => (
                      <tr
                        key={item.id}
                        className={[
                          (
                            allFiltered
                              ? !excluded.has(item.id)
                              : selected.has(item.id)
                          )
                            ? "selected"
                            : "",
                          item.syncChange ? `sync-${item.syncChange.kind}` : "",
                        ].filter(Boolean).join(" ")}
                      >
                        <td className="select-cell">
                          <button
                            className="check-button"
                            onClick={() => toggle(item.id)}
                          >
                            {(
                              allFiltered
                                ? !excluded.has(item.id)
                                : selected.has(item.id)
                            ) ? (
                              <SquareCheckBig />
                            ) : (
                              <Square />
                            )}
                          </button>
                        </td>
                        <td>
                          <div className="listing-cell">
                            <img src={item.thumbnail || ""} alt="" />
                            <span>
                              <button onClick={() => openDetail(item.id)}>
                                {item.title}
                              </button>
                              <CopyButton value={item.title} label="Copiar título" />
                              <small>
                                {item.id} · {item.sku || "sem SKU"}
                                <CopyButton value={item.id} label="Copiar ID" />
                              </small>
                              {item.syncChange && (
                                <span className={`row-change ${item.syncChange.kind}`} title={item.syncChange.differences?.length ? item.syncChange.differences.map((difference) => `${difference.field}: ${String(difference.before ?? "vazio")} → ${String(difference.after ?? "vazio")}`).join(" · ") : item.syncChange.fields.join(", ")}>
                                  {item.syncChange.kind === "added" ? "Novo" : item.syncChange.kind === "removed" ? "Não retornou" : `Alterado: ${item.syncChange.fields.slice(0, 2).join(", ")}`}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td>
                          <StatusPill status={item.status} />
                        </td>
                        <td>
                          <strong>
                            {formatCurrency(
                              item.price,
                              item.currencyId ?? "BRL",
                            )}
                          </strong>
                          {discountPercentage(
                            item.price,
                            item.originalPrice,
                            item.promotion?.discountPercentage,
                          ) != null && (
                            <small className="discount">
                              -
                              {discountPercentage(
                                item.price,
                                item.originalPrice,
                                item.promotion?.discountPercentage,
                              )}
                              %
                            </small>
                          )}
                        </td>
                        <td>{formatNumber(item.availableQuantity)}</td>
                        <td>{formatNumber(item.soldQuantity)}</td>
                        <td>
                          <div className="listing-flags">
                            {item.catalogListing ? (
                              <span className="catalog">Catálogo</span>
                            ) : (
                              <span className="muted">Tradicional</span>
                            )}
                            {item.promotion?.pix && (
                              <span className="pix-badge">Pix</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {activeDays(item) != null
                            ? `${activeDays(item)} dias`
                            : "—"}
                        </td>
                        <td>{formatDate(item.updatedAt)}</td>
                        <td>
                          {query.scoreEnabled
                            ? formatNumber(item.internalScore)
                            : "—"}
                        </td>
                        <td>
                          {item.permalink && (
                            <a
                              className="icon-button mini"
                              href={item.permalink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && data?.items.length === 0 && (
              <div className="empty">
                <PackageSearch />
                <h3>Nenhum anúncio encontrado</h3>
                <p>
                  Ajuste os filtros ou sincronize novamente os dados da conta.
                </p>
                <button className="button" onClick={reset}>
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
          <footer className="pagination">
            <label>
              Exibir{" "}
              <select
                value={query.pageSize}
                onChange={(e) =>
                  setQuery((q) => ({
                    ...q,
                    pageSize: Number(e.target.value),
                    page: 1,
                  }))
                }
              >
                <option>30</option>
                <option>50</option>
                <option>100</option>
                <option>200</option>
              </select>{" "}
              por página
            </label>
            <span>
              Página {data?.page ?? 1} de {data?.totalPages ?? 1}
            </span>
            <div>
              <button
                className="icon-button"
                disabled={query.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: 1 }))}
                title="Primeira"
              >
                <ChevronLeft />
                <ChevronLeft />
              </button>
              <button
                className="icon-button"
                disabled={query.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
              >
                <ChevronLeft />
              </button>
              <button className="page-current">{query.page}</button>
              <button
                className="icon-button"
                disabled={!data?.hasNext}
                onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
              >
                <ChevronRight />
              </button>
              <button
                className="icon-button"
                disabled={!data?.hasNext}
                onClick={() =>
                  setQuery((q) => ({ ...q, page: data?.totalPages ?? q.page }))
                }
                title="Última"
              >
                <ChevronRight />
                <ChevronRight />
              </button>
            </div>
          </footer>
          </>}
        </main>
      </div>
      <footer className="creator-footer"><span>Desenvolvido por</span><a href="https://anderhonorato.github.io/meu-portfolio/index.html" target="_blank" rel="noreferrer">Anderson Honorato</a></footer>
      {detailOpen && (
        <DetailDrawer
          item={detail}
          loading={detailLoading}
          onClose={() => setDetailOpen(false)}
        />
      )}{" "}
      {bulkOpen && (
        <BulkDialog
          selected={count}
          csrf={session?.csrfToken ?? null}
          payload={selectionPayload}
          onClose={() => setBulkOpen(false)}
          onFinished={() => void loadListings()}
        />
      )}
      <button className="help-fab" onClick={() => setHelpOpen(true)} aria-label="Abrir ajuda" title="Ajuda"><CircleHelp /></button>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {resetOpen && <div className="modal-backdrop reset-backdrop" onMouseDown={() => !resetting && setResetOpen(false)}><section className="modal reset-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Ação irreversível</p><h2>Apagar todos os dados?</h2></div><button className="icon-button" onClick={() => setResetOpen(false)} disabled={resetting}><X /></button></div><div className="reset-body"><div className="notice danger"><AlertTriangle /><span>Serão apagados anúncios salvos, histórico, conversas, sessões e conexões. Essa ação não pode ser desfeita.</span></div><label className="field"><span>Digite CONFIRMAR para continuar</span><input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} autoComplete="off" /></label>{resetError && <div className="notice danger">{resetError}</div>}<div className="modal-actions"><button className="button" onClick={() => setResetOpen(false)} disabled={resetting}>Cancelar</button><button className="button danger-button" disabled={resetConfirmation !== "CONFIRMAR" || resetting} onClick={() => void performFullReset()}>{resetting ? <LoaderCircle className="spin" /> : <Trash2 />}Apagar definitivamente</button></div></div></section></div>}
      {alphaBotOpen && <AlphaBot requestLocalSession={requestLocalSession} onClose={() => setAlphaBotOpen(false)} theme={theme} />}
    </div>
  );
}
