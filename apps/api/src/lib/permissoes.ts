// ============================================================
// permissoes.ts — catálogo central das áreas do sistema e as
// regras de quem enxerga o quê.
//
// Cada "página" tem uma chave. O USER só acessa as chaves que o
// Administrador liberou. OWNER e ADMIN acessam tudo. Deixo aqui
// TODAS as abas (inclusive as funcionalidades novas que ainda
// vão ganhar backend), pra a censura já funcionar quando cada
// uma for ligada, sem precisar mexer nas permissões depois.
// ============================================================

export type Papel = "OWNER" | "ADMIN" | "USER";

export type AreaSistema = {
  chave: string;
  nome: string;
  grupo: "oficial" | "nao-oficial" | "geral" | "gestao";
  // Áreas marcadas como "sempre" ficam liberadas pra qualquer usuário
  // (não dá pra bloquear o Início nem o próprio perfil, por exemplo)
  sempre?: boolean;
};

export const AREAS: AreaSistema[] = [
  { chave: "inicio", nome: "Início", grupo: "geral", sempre: true },
  // Conta oficial (API do Mercado Livre)
  { chave: "anuncios", nome: "Anúncios", grupo: "oficial" },
  { chave: "vendas", nome: "Vendas", grupo: "oficial" },
  { chave: "perguntas", nome: "Perguntas · SAC", grupo: "oficial" },
  { chave: "mensagens", nome: "Mensagens pós-venda", grupo: "oficial" },
  { chave: "reclamacoes", nome: "Reclamações", grupo: "oficial" },
  { chave: "envios", nome: "Envios e etiquetas", grupo: "oficial" },
  { chave: "financeiro", nome: "Financeiro", grupo: "oficial" },
  { chave: "notas", nome: "Notas fiscais", grupo: "oficial" },
  { chave: "precos", nome: "Preços", grupo: "oficial" },
  { chave: "promocoes", nome: "Promoções e cupons", grupo: "oficial" },
  { chave: "repricing", nome: "Automação de preços", grupo: "oficial" },
  { chave: "concorrentes", nome: "Concorrentes", grupo: "oficial" },
  { chave: "tendencias", nome: "Tendências", grupo: "oficial" },
  { chave: "qualidade", nome: "Qualidade dos anúncios", grupo: "oficial" },
  { chave: "ads", nome: "Publicidade (Ads)", grupo: "oficial" },
  // Não oficial
  { chave: "publico", nome: "Consultas públicas", grupo: "nao-oficial" },
  // Geral
  { chave: "assistente", nome: "AlphaBot IA", grupo: "geral" },
  { chave: "chat", nome: "Chat da equipe", grupo: "geral", sempre: true },
  { chave: "historico", nome: "Histórico", grupo: "geral" },
];

export const CHAVES_AREAS = AREAS.map((area) => area.chave);
const CHAVES_SEMPRE = AREAS.filter((area) => area.sempre).map((area) => area.chave);

// Retorna a lista de chaves que o usuário pode acessar, já considerando
// o papel. OWNER/ADMIN => tudo. USER => o que foi liberado + as "sempre".
export function permissoesEfetivas(papel: Papel, permissoesSalvas: string[]): string[] {
  if (papel === "OWNER" || papel === "ADMIN") return [...CHAVES_AREAS];
  const liberadas = new Set([...CHAVES_SEMPRE, ...permissoesSalvas.filter((chave) => CHAVES_AREAS.includes(chave))]);
  return CHAVES_AREAS.filter((chave) => liberadas.has(chave));
}

export function podeAcessar(papel: Papel, permissoesSalvas: string[], chave: string): boolean {
  if (papel === "OWNER" || papel === "ADMIN") return true;
  if (CHAVES_SEMPRE.includes(chave)) return true;
  return permissoesSalvas.includes(chave);
}

// Papéis que podem gerenciar usuários (criar, editar permissões, excluir).
// OWNER manda em todos; ADMIN manda nos próprios USERs.
export function podeGerenciarUsuarios(papel: Papel): boolean {
  return papel === "OWNER" || papel === "ADMIN";
}
