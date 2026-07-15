import { ApiError } from "../api/client";

type ErrorEntry = { reference: string; message: string };

const ERROR_CATALOG: Record<string, ErrorEntry> = {
  AUTH_REQUIRED: { reference: "MLAM-AUT-001", message: "Conecte a conta de anúncios para usar esta função." },
  SETUP_REQUIRED: { reference: "MLAM-AUT-002", message: "A conexão do aplicativo ainda precisa ser concluída." },
  OAUTH_SESSION_LOST: { reference: "MLAM-AUT-003", message: "A tentativa de conexão expirou. Inicie novamente." },
  OAUTH_STATE_INVALID: { reference: "MLAM-AUT-004", message: "A confirmação de acesso expirou. Inicie novamente." },
  OAUTH_IDENTITY_MISMATCH: { reference: "MLAM-AUT-005", message: "A conta confirmada não corresponde à tentativa de conexão." },
  CSRF_INVALID: { reference: "MLAM-SEG-001", message: "A sessão de segurança expirou. Atualize a página e tente novamente." },
  PUBLIC_PAGE_BLOCKED: { reference: "MLAM-PUB-001", message: "O Mercado Livre pediu uma verificação de acesso. Aguarde alguns minutos antes de tentar novamente." },
  PUBLIC_BROWSER_BLOCKED: { reference: "MLAM-PUB-001", message: "O Mercado Livre pediu uma verificação de acesso. Aguarde alguns minutos antes de tentar novamente." },
  PUBLIC_SEARCH_TEMPORARILY_BLOCKED: { reference: "MLAM-PUB-002", message: "A busca pública foi limitada temporariamente. Aguarde antes de repetir." },
  PUBLIC_PAGE_UNAVAILABLE: { reference: "MLAM-PUB-003", message: "A página pública não está disponível para leitura neste momento." },
  PUBLIC_BROWSER_UNAVAILABLE: { reference: "MLAM-PUB-004", message: "O leitor de páginas públicas não pôde ser iniciado." },
  NO_PUBLIC_LISTINGS: { reference: "MLAM-PUB-005", message: "Nenhum anúncio público foi encontrado nessa página." },
  SCAN_ALREADY_RUNNING: { reference: "MLAM-PUB-006", message: "Já existe uma consulta pública em andamento." },
  SCAN_NOT_FOUND: { reference: "MLAM-PUB-009", message: "A consulta anterior foi encerrada quando o serviço local reiniciou. Inicie uma nova consulta." },
  RATE_LIMITED: { reference: "MLAM-LIM-001", message: "Muitas solicitações foram feitas. Aguarde um momento." },
  INTERNAL_ERROR: { reference: "MLAM-SRV-001", message: "O serviço encontrou um problema inesperado." },
  AI_NOT_CONFIGURED: { reference: "MLAM-IA-001", message: "O AlphaBot ainda não está configurado." },
  AI_UNAVAILABLE: { reference: "MLAM-IA-002", message: "O AlphaBot não está disponível neste momento." },
  AI_RATE_LIMITED: { reference: "MLAM-IA-003", message: "A assistente atingiu um limite temporário. Aguarde um pouco." },
  AI_ACCESS_DENIED: { reference: "MLAM-IA-004", message: "A configuração da assistente precisa ser revisada." },
  AI_CONVERSATION_NOT_FOUND: { reference: "MLAM-IA-005", message: "A conversa não foi encontrada." },
  AI_CONVERSATION_ARCHIVED: { reference: "MLAM-IA-006", message: "Reabra a conversa antes de enviar mensagens." },
};

function identified(entry: ErrorEntry): string {
  return `${entry.message} Código: ${entry.reference}.`;
}

export function userFacingError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "A operação foi cancelada. Código: MLAM-OPR-001.";
  }
  if (error instanceof TypeError) {
    return "O serviço local não está disponível. Reinicie o aplicativo e tente novamente. Código: MLAM-LOC-001.";
  }
  if (error instanceof ApiError) {
    const known = error.code ? ERROR_CATALOG[error.code] : undefined;
    if (known) return identified(known);
    if (error.status === 401) return "A sessão expirou. Reconecte a conta. Código: MLAM-AUT-006.";
    if (error.status === 403) return "A operação não foi autorizada. Código: MLAM-AUT-007.";
    if (error.status === 404) return "A informação solicitada não foi encontrada. Código: MLAM-DAD-001.";
    if (error.status === 429) return "O limite temporário foi atingido. Aguarde antes de tentar novamente. Código: MLAM-LIM-001.";
    if (error.status >= 500) return "O serviço está temporariamente indisponível. Código: MLAM-SRV-002.";
    return `${error.message} Código: ${error.code || `MLAM-HTTP-${error.status}`}.`;
  }
  return error instanceof Error
    ? `${error.message} Código: MLAM-APP-001.`
    : "Não foi possível concluir a operação. Código: MLAM-APP-002.";
}

export function userFacingCode(code: string | null | undefined, fallback = "Não foi possível concluir a operação."): string {
  const known = code ? ERROR_CATALOG[code] : undefined;
  return known ? identified(known) : `${fallback} Código: ${code || "MLAM-APP-002"}.`;
}
