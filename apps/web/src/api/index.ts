import type {
  BulkJob,
  BulkOperation,
  BulkPreview,
  ListingDetail,
  ListingRanking,
  ListingQuery,
  ListingsPage,
  RankingParticipant,
  SelectionPayload,
  UnofficialScan,
  HistoryData,
  AiAttachment,
  AiConversation,
  AiMessage,
} from '../types';
import { listingsSearchParams } from '../utils/query';
import { apiDownload, apiGet, apiRequest, apiUrl, clearApiCache } from './client';
import {
  normalizeAccount,
  normalizeBulkJob,
  normalizeBulkPreview,
  normalizeListingDetail,
  normalizeListingsPage,
  normalizeSession,
  normalizeSync,
} from './normalizers';

export async function getSession(signal?: AbortSignal) {
  return normalizeSession(await apiGet<unknown>('/api/session', { signal, cacheTtl: 3_000 }));
}

export async function getSetup(signal?: AbortSignal): Promise<{
  mercadoLivreConfigured: boolean;
  application?: { configured: boolean; secureRedirect: boolean };
}> {
  return apiGet('/api/setup', { signal, cacheTtl: 3_000 });
}

export async function getAccount(signal?: AbortSignal) {
  return normalizeAccount(await apiGet<unknown>('/api/account', { signal, cacheTtl: 15_000 }));
}

export function authStartUrl(): string {
  return apiUrl('/api/auth/mercadolivre/start');
}

export async function logout(csrfToken: string | null): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST', csrfToken, retries: 0 });
  clearApiCache();
}

export async function getSync(signal?: AbortSignal) {
  return normalizeSync(await apiGet<unknown>('/api/sync', { signal, dedupe: false, retries: 1 }));
}

export async function startSync(csrfToken: string | null) {
  clearApiCache('/api/sync');
  return normalizeSync(
    await apiRequest<unknown>('/api/sync', { method: 'POST', csrfToken, retries: 0 }),
  );
}

export async function cancelSync(csrfToken: string | null) {
  return normalizeSync(
    await apiRequest<unknown>('/api/sync', { method: 'DELETE', csrfToken, retries: 0 }),
  );
}

export async function getListings(query: ListingQuery, signal?: AbortSignal): Promise<ListingsPage> {
  const params = listingsSearchParams(query);
  const value = await apiGet<unknown>(`/api/listings?${params}`, {
    signal,
    dedupe: false,
    retries: 2,
  });
  return normalizeListingsPage(value);
}

export async function getListing(id: string, signal?: AbortSignal): Promise<ListingDetail> {
  const value = await apiGet<unknown>(`/api/listings/${encodeURIComponent(id)}`, {
    signal,
    cacheTtl: 60_000,
    dedupe: !signal,
  });
  return normalizeListingDetail(value);
}

export async function getListingRanking(id: string, signal?: AbortSignal): Promise<ListingRanking> {
  return apiGet<ListingRanking>(`/api/listings/${encodeURIComponent(id)}/ranking`, {
    signal,
    cacheTtl: 60_000,
    dedupe: !signal,
    retries: 1,
  });
}

export async function getCatalogParticipants(catalogProductId: string, page = 1, limit = 50): Promise<{ catalogProductId: string; page: number; limit: number; participants: RankingParticipant[]; total: number }> {
  return apiGet(`/api/unofficial/catalog/${encodeURIComponent(catalogProductId)}/participants?page=${page}&limit=${limit}`, {
    cacheTtl: 30_000,
    dedupe: true,
  });
}

export async function previewBulk(
  csrfToken: string | null,
  selection: SelectionPayload,
  operation: BulkOperation,
  idempotencyKey: string,
): Promise<BulkPreview> {
  const value = await apiRequest<unknown>('/api/bulk/preview', {
    method: 'POST',
    csrfToken,
    retries: 0,
    body: { selection, operation, idempotencyKey },
  });
  return normalizeBulkPreview(value);
}

export async function executeBulk(
  csrfToken: string | null,
  preview: BulkPreview,
  idempotencyKey: string,
): Promise<BulkJob> {
  const value = await apiRequest<unknown>('/api/bulk/execute', {
    method: 'POST',
    csrfToken,
    retries: 0,
    body: {
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
      idempotencyKey,
    },
  });
  return normalizeBulkJob(value);
}

export async function getBulkJob(id: string, signal?: AbortSignal): Promise<BulkJob> {
  return normalizeBulkJob(
    await apiGet<unknown>(`/api/bulk/${encodeURIComponent(id)}`, {
      signal,
      dedupe: false,
      retries: 1,
    }),
  );
}

export async function exportListings(params: URLSearchParams, signal?: AbortSignal) {
  return apiDownload(`/api/export.xlsx?${params}`, signal);
}

export async function startUnofficialScan(
  csrfToken: string | null,
  input: {
    mode: "seller" | "product";
    url?: string;
    query?: string;
    limitMode: "limited" | "all";
    maxItems?: number;
    inspectPix: boolean;
  },
): Promise<UnofficialScan> {
  return apiRequest('/api/unofficial/scans', {
    method: 'POST', csrfToken, retries: 0, body: input,
  });
}

export async function getUnofficialScan(id: string): Promise<UnofficialScan> {
  return apiGet(`/api/unofficial/scans/${encodeURIComponent(id)}`, {
    dedupe: false, retries: 0,
  });
}

export async function cancelUnofficialScan(csrfToken: string | null, id: string): Promise<UnofficialScan> {
  return apiRequest(`/api/unofficial/scans/${encodeURIComponent(id)}`, {
    method: 'DELETE', csrfToken, retries: 0,
  });
}

export async function resumeUnofficialScan(csrfToken: string | null, id: string): Promise<UnofficialScan> {
  return apiRequest(`/api/unofficial/scans/${encodeURIComponent(id)}/resume`, {
    method: 'POST', csrfToken: csrfToken || "session", retries: 0,
  });
}

export async function getHistory(): Promise<HistoryData> {
  return apiGet('/api/history?limit=150', { dedupe: false, retries: 1 });
}

export async function recordActivity(
  csrfToken: string | null,
  activity: { action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await apiRequest('/api/history/activity', { method: 'POST', csrfToken, retries: 0, body: activity });
}

export async function heartbeat(csrfToken: string | null): Promise<void> {
  await apiRequest('/api/history/heartbeat', { method: 'POST', csrfToken, retries: 0 });
}

export async function getAiConversations(archived = false): Promise<{ items: AiConversation[] }> {
  return apiGet(`/api/ai/conversations?archived=${archived}`, { dedupe: false, retries: 0 });
}
export async function createAiConversation(csrfToken: string, title?: string): Promise<AiConversation> {
  return apiRequest('/api/ai/conversations', { method: 'POST', csrfToken, retries: 0, body: title ? { title } : {} });
}
export async function getAiMessages(id: string): Promise<{ conversation: AiConversation; items: AiMessage[] }> {
  return apiGet(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, { dedupe: false, retries: 0 });
}
export async function updateAiConversation(csrfToken: string, id: string, input: { title?: string; archived?: boolean }): Promise<AiConversation> {
  return apiRequest(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', csrfToken, retries: 0, body: input });
}
export async function deleteAiConversation(csrfToken: string, id: string): Promise<void> {
  return apiRequest(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', csrfToken, retries: 0 });
}
export async function sendAiMessage(csrfToken: string, id: string, input: { content: string; attachments: AiAttachment[] }): Promise<{ user: AiMessage; assistant: AiMessage; title: string }> {
  return apiRequest(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', csrfToken, retries: 0, body: input });
}

export async function sendAiMessageStream(
  csrfToken: string,
  conversationId: string,
  input: { content: string; attachments: AiAttachment[] },
  callbacks: {
    onReasoning: (text: string) => void;
    onContent: (text: string) => void;
    onDone: (result: { user: AiMessage; assistant: AiMessage; title: string }) => void;
    onError: (error: string) => void;
  },
): Promise<void> {
  const response = await fetch(apiUrl(`/api/ai/conversations/${encodeURIComponent(conversationId)}/messages/stream`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(input),
    credentials: "include",
  });

  if (!response.ok) {
    try {
      const err = await response.json();
      callbacks.onError((err as { error?: { message?: string } })?.error?.message ?? (err as { message?: string })?.message ?? "Erro ao iniciar o stream.");
    } catch {
      callbacks.onError("Erro ao iniciar o stream.");
    }
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        if (!event.trim()) continue;

        let eventType = "";
        let data = "";

        for (const line of event.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data = line.slice(6).trim();
          }
        }

        if (!eventType || !data) continue;

        try {
          const parsed = JSON.parse(data);

          switch (eventType) {
            case "reasoning":
              callbacks.onReasoning(parsed.text);
              break;
            case "content":
              callbacks.onContent(parsed.text);
              break;
            case "done":
              callbacks.onDone(parsed);
              break;
            case "error":
              callbacks.onError(parsed.message ?? "Erro desconhecido.");
              break;
          }
        } catch {
          // ignora eventos malformados
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : "Erro de conexão com o stream.");
  }
}

export async function resetAllData(csrfToken: string, confirmation: string): Promise<void> {
  return apiRequest('/api/system/reset', { method: 'POST', csrfToken, retries: 0, body: { confirmation } });
}

export async function getUnofficialAccess(): Promise<{ configured: boolean }> {
  return apiGet('/api/unofficial/access', { retries: 0 });
}

export async function setupUnofficialAccess(csrfToken: string | null, password: string, recoveryQuestion: string, recoveryAnswer: string): Promise<{ ok: boolean }> {
  return apiRequest('/api/unofficial/access/setup', { method: 'POST', csrfToken: csrfToken || "session", retries: 0, body: { password, recoveryQuestion, recoveryAnswer } });
}

export async function verifyUnofficialAccess(csrfToken: string | null, password: string): Promise<{ ok: boolean }> {
  return apiRequest('/api/unofficial/access/verify', { method: 'POST', csrfToken: csrfToken || "session", retries: 0, body: { password } });
}

export async function recoverUnofficialAccess(csrfToken: string | null, recoveryAnswer: string): Promise<{ ok: boolean; recoveryQuestion: string }> {
  return apiRequest('/api/unofficial/access/recover', { method: 'POST', csrfToken: csrfToken || "session", retries: 0, body: { recoveryAnswer } });
}

export async function resetUnofficialAccess(csrfToken: string | null, recoveryAnswer: string, newPassword: string): Promise<{ ok: boolean }> {
  return apiRequest('/api/unofficial/access/reset', { method: 'POST', csrfToken: csrfToken || "session", retries: 0, body: { recoveryAnswer, newPassword } });
}
