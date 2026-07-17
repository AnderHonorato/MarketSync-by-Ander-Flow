// ============================================================
// api.js — conversa com o serviço local (que repassa pra API
// do Mercado Livre). Tudo passa pelo mesmo endereço da página,
// então não tem problema de CORS nem de porta bloqueada.
// ============================================================

// Antes o cliente chamava http://maquina:3100 direto e quebrava quando
// acessava pela rede ou por túnel. Agora é sempre caminho relativo:
// o servidor local (servidor.js) repassa /api pro backend na 3100.
const BASE_API = "";

export class ErroApi extends Error {
  constructor(mensagem, { status = 0, codigo, aguardar } = {}) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.aguardar = aguardar; // segundos sugeridos pelo Retry-After
  }
}

// Cache curtinho pra não repetir a mesma chamada GET várias vezes seguidas
const cacheRespostas = new Map();
const chamadasEmAndamento = new Map();

function montarUrl(caminho) {
  return `${BASE_API}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
}

async function extrairErro(resposta) {
  let detalhes = {};
  try { detalhes = await resposta.clone().json(); } catch { /* corpo não era JSON */ }
  const interno = detalhes?.error && typeof detalhes.error === "object" ? detalhes.error : {};
  const mensagem = detalhes?.message || interno?.message || detalhes?.error_description
    || (typeof detalhes?.error === "string" ? detalhes.error : "")
    || `A API respondeu com status ${resposta.status}.`;
  const codigo = detalhes?.code || interno?.code || undefined;
  const cabecalhoAguardar = resposta.headers.get("Retry-After");
  return new ErroApi(mensagem, {
    status: resposta.status,
    codigo,
    aguardar: cabecalhoAguardar && Number.isFinite(Number(cabecalhoAguardar)) ? Number(cabecalhoAguardar) : undefined,
  });
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// Chamada genérica com repetição automática em erros passageiros (429/5xx)
export async function chamarApi(caminho, opcoes = {}) {
  const metodo = (opcoes.metodo ?? "GET").toUpperCase();
  const cabecalhos = { Accept: "application/json" };
  let corpo;

  if (metodo !== "GET" && metodo !== "HEAD") {
    if (!opcoes.csrf) throw new ErroApi("A sessão não forneceu um token de segurança válido.", { status: 403, codigo: "csrf_ausente" });
    cabecalhos["X-CSRF-Token"] = opcoes.csrf;
  }
  if (opcoes.corpo !== undefined) {
    cabecalhos["Content-Type"] = "application/json";
    corpo = JSON.stringify(opcoes.corpo);
  }

  const tentativas = opcoes.tentativas ?? (metodo === "GET" ? 2 : 0);
  let ultimoErro;

  for (let tentativa = 0; tentativa <= tentativas; tentativa += 1) {
    let resposta;
    try {
      resposta = await fetch(montarUrl(caminho), {
        method: metodo,
        headers: cabecalhos,
        body: corpo,
        credentials: "include",
        signal: opcoes.sinal,
      });
    } catch (motivo) {
      if (motivo?.name === "AbortError") throw motivo;
      // Servidor local fora do ar — nem chegou a responder
      throw new ErroApi("Não consegui falar com o serviço local. Confira se o servidor está aberto.", { status: 0, codigo: "SERVIDOR_FORA" });
    }

    if (resposta.ok) {
      if (resposta.status === 204) return undefined;
      const tipo = resposta.headers.get("Content-Type") ?? "";
      return tipo.includes("json") ? resposta.json() : resposta.text();
    }

    ultimoErro = await extrairErro(resposta);
    const passageiro = [429, 500, 502, 503, 504].includes(resposta.status);
    if (!passageiro || tentativa === tentativas) throw ultimoErro;
    const atraso = ultimoErro.aguardar ? ultimoErro.aguardar * 1000 : Math.min(500 * 2 ** tentativa, 4000);
    await esperar(atraso);
  }
  throw ultimoErro ?? new ErroApi("Não foi possível concluir a requisição.");
}

// GET com cache opcional e deduplicação de chamadas simultâneas
export async function buscarApi(caminho, { validade, sinal, tentativas } = {}) {
  const chave = montarUrl(caminho);
  const guardado = cacheRespostas.get(chave);
  if (guardado && guardado.expira > Date.now()) return guardado.valor;

  const podeJuntar = !sinal;
  if (podeJuntar && chamadasEmAndamento.has(chave)) return chamadasEmAndamento.get(chave);

  const promessa = chamarApi(caminho, { sinal, tentativas }).then((valor) => {
    if (validade) cacheRespostas.set(chave, { expira: Date.now() + validade, valor });
    return valor;
  });

  if (podeJuntar) chamadasEmAndamento.set(chave, promessa);
  try {
    return await promessa;
  } finally {
    if (podeJuntar) chamadasEmAndamento.delete(chave);
  }
}

export function limparCacheApi(prefixo = "") {
  for (const chave of cacheRespostas.keys()) {
    if (!prefixo || chave.includes(prefixo)) cacheRespostas.delete(chave);
  }
}

// Mensagem amigável pra mostrar na tela quando algo dá errado
export function erroAmigavel(erro) {
  if (erro?.name === "AbortError") return "Operação cancelada.";
  if (!(erro instanceof ErroApi)) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return "Sem internet. Verifique a conexão e tente de novo.";
    return erro instanceof Error ? erro.message : "Aconteceu um erro inesperado.";
  }
  if (erro.codigo === "SERVIDOR_FORA") return erro.message;
  if (erro.status === 401) return "A sessão expirou ou foi revogada. Reconecte a conta.";
  if (erro.status === 403) return "A conta ou o aplicativo não tem permissão pra essa operação.";
  if (erro.status === 404) return "O que você procurou não está mais disponível.";
  if (erro.status === 409) return "Essa operação conflita com outra que está em andamento.";
  if (erro.status === 429) return erro.aguardar
    ? `Limite temporário atingido. Tente de novo em ${erro.aguardar} s.`
    : "Limite temporário atingido. Aguarde um pouco antes de tentar de novo.";
  if (erro.status >= 500) return "O serviço está indisponível agora. Tente mais tarde.";
  return erro.message;
}

// ============================================================
// Funções específicas de cada área da API
// ============================================================

// --- Sessão e conexão ---
export const obterSessao = (sinal) => buscarApi("/api/session", { sinal, validade: 3000 });
export const obterConfiguracao = (sinal) => buscarApi("/api/setup", { sinal, validade: 3000 });
export const obterConta = (sinal) => buscarApi("/api/account", { sinal, validade: 15000 });
export const enderecoConexaoOficial = () => montarUrl("/api/auth/mercadolivre/start");
// Versão em JSON do início da conexão: devolve o link de autorização pra abrir
// em outro aparelho (celular) — útil quando o Mercado Livre pede
// reconhecimento facial e o computador não tem câmera
export const obterLinkConexao = () => buscarApi("/api/auth/mercadolivre/start?formato=json", { tentativas: 0 });
export const encerrarSessao = (csrf) => chamarApi("/api/auth/logout", { metodo: "POST", csrf }).then(() => limparCacheApi());
export const verificarSaude = () => buscarApi("/saude", { tentativas: 0 });

// --- Autenticação local (login do aplicativo) ---
export const estadoAutenticacao = () => buscarApi("/api/auth/estado", { tentativas: 0 });
export const cadastrar = (csrf, dados) => chamarApi("/api/auth/cadastro", { metodo: "POST", csrf, corpo: dados });
export const entrar = (csrf, usuario, senha) => chamarApi("/api/auth/login", { metodo: "POST", csrf, corpo: { usuario, senha } });
export const sairDaConta = (csrf) => chamarApi("/api/auth/sair", { metodo: "POST", csrf });
export const perguntaRecuperacao = (csrf, usuario) => chamarApi("/api/auth/recuperar/pergunta", { metodo: "POST", csrf, corpo: { usuario } });
export const redefinirSenha = (csrf, usuario, resposta, novaSenha) => chamarApi("/api/auth/recuperar/redefinir", { metodo: "POST", csrf, corpo: { usuario, resposta, novaSenha } });
export const trocarSenha = (csrf, senhaAtual, novaSenha) => chamarApi("/api/auth/trocar-senha", { metodo: "POST", csrf, corpo: { senhaAtual, novaSenha } });
export const excluirPropriaConta = (csrf, confirmacao) => chamarApi("/api/auth/excluir-conta", { metodo: "POST", csrf, corpo: { confirmacao } });

// --- Gestão de usuários (Owner/Admin) ---
export const listarUsuarios = () => buscarApi("/api/usuarios", { tentativas: 0 });
export const usuariosPendentes = () => buscarApi("/api/usuarios/pendentes", { tentativas: 0 });
export const decidirAdmin = (csrf, id, decisao) => chamarApi(`/api/usuarios/${encodeURIComponent(id)}/aprovacao`, { metodo: "POST", csrf, corpo: { decisao } });
export const criarUsuario = (csrf, dados) => chamarApi("/api/usuarios", { metodo: "POST", csrf, corpo: dados });
export const editarUsuario = (csrf, id, dados) => chamarApi(`/api/usuarios/${encodeURIComponent(id)}`, { metodo: "PATCH", csrf, corpo: dados });
export const excluirUsuario = (csrf, id) => chamarApi(`/api/usuarios/${encodeURIComponent(id)}`, { metodo: "DELETE", csrf });

// --- Anúncios oficiais ---
export function parametrosConsulta(consulta) {
  const parametros = new URLSearchParams();
  parametros.set("page", String(consulta.pagina ?? 1));
  parametros.set("limit", String(consulta.tamanhoPagina ?? 30));
  parametros.set("scoreEnabled", String(consulta.pontuacao !== false));
  if (consulta.busca) parametros.set("search", consulta.busca);
  if (consulta.ordenacao) parametros.set("sort", consulta.ordenacao);
  const filtros = consulta.filtros ?? {};
  for (const status of filtros.status ?? []) parametros.append("status", status);
  const mapaSimples = {
    estoque: "stock", vendas: "sales", idade: "age", catalogo: "catalog",
    promocao: "promotion", condicao: "condition", tipoAnuncio: "listingType",
    categoria: "categoryId", precoMinimo: "minPrice", precoMaximo: "maxPrice",
    descontoMinimo: "minDiscount", descontoMaximo: "maxDiscount",
    criadoDe: "createdFrom", criadoAte: "createdTo",
  };
  for (const [nosso, deles] of Object.entries(mapaSimples)) {
    if (filtros[nosso]) parametros.set(deles, String(filtros[nosso]));
  }
  return parametros;
}

export const buscarAnuncios = (consulta, sinal) =>
  buscarApi(`/api/listings?${parametrosConsulta(consulta)}`, { sinal, tentativas: 2 });
export const buscarAnuncio = (id, sinal) =>
  buscarApi(`/api/listings/${encodeURIComponent(id)}`, { sinal, validade: 60000 });
export const buscarRanking = (id, sinal) =>
  buscarApi(`/api/listings/${encodeURIComponent(id)}/ranking`, { sinal, validade: 60000, tentativas: 1 });
export const buscarParticipantesCatalogo = (idProduto, pagina = 1, limite = 50) =>
  buscarApi(`/api/unofficial/catalog/${encodeURIComponent(idProduto)}/participants?page=${pagina}&limit=${limite}`, { validade: 30000 });

// --- Sincronização ---
export const obterSincronizacao = (sinal) => chamarApi("/api/sync", { sinal, tentativas: 1 });
export const iniciarSincronizacao = (csrf) => { limparCacheApi("/api/sync"); return chamarApi("/api/sync", { metodo: "POST", csrf }); };
export const cancelarSincronizacao = (csrf) => chamarApi("/api/sync", { metodo: "DELETE", csrf });

// --- Alterações em massa ---
export const preverAlteracaoMassa = (csrf, selecao, operacao, chaveUnica) =>
  chamarApi("/api/bulk/preview", { metodo: "POST", csrf, corpo: { selection: selecao, operation: operacao, idempotencyKey: chaveUnica } });
export const executarAlteracaoMassa = (csrf, previa, chaveUnica) =>
  chamarApi("/api/bulk/execute", { metodo: "POST", csrf, corpo: { previewId: previa.previewId, confirmationToken: previa.confirmationToken, idempotencyKey: chaveUnica } });
export const acompanharAlteracaoMassa = (id, sinal) =>
  chamarApi(`/api/bulk/${encodeURIComponent(id)}`, { sinal, tentativas: 1 });

// --- Exportação (planilha gerada pelo backend) ---
export async function exportarAnuncios(parametros, sinal) {
  const resposta = await fetch(montarUrl(`/api/export.xlsx?${parametros}`), {
    method: "GET",
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    credentials: "include",
    signal: sinal,
  });
  if (!resposta.ok) throw await extrairErro(resposta);
  const disposicao = resposta.headers.get("Content-Disposition") ?? "";
  const utf8 = disposicao.match(/filename\*=UTF-8''([^;]+)/i);
  const simples = disposicao.match(/filename="?([^";]+)"?/i);
  let nome = utf8?.[1] ?? simples?.[1];
  if (nome) { try { nome = decodeURIComponent(nome); } catch { /* deixa como veio */ } }
  return { blob: await resposta.blob(), nome };
}

// --- Consultas públicas (não oficial) ---
export const iniciarLeituraPublica = (csrf, entrada) =>
  chamarApi("/api/unofficial/scans", { metodo: "POST", csrf, corpo: entrada });
export const acompanharLeituraPublica = (id) =>
  chamarApi(`/api/unofficial/scans/${encodeURIComponent(id)}`, { tentativas: 0 });
export const cancelarLeituraPublica = (csrf, id) =>
  chamarApi(`/api/unofficial/scans/${encodeURIComponent(id)}`, { metodo: "DELETE", csrf });
export const retomarLeituraPublica = (csrf, id) =>
  chamarApi(`/api/unofficial/scans/${encodeURIComponent(id)}/resume`, { metodo: "POST", csrf: csrf || "session" });
// Resposta da pausa programada: continuar a busca ou finalizar com o que já tem
export const decidirLeituraPublica = (csrf, id, continuar) =>
  chamarApi(`/api/unofficial/scans/${encodeURIComponent(id)}/decisao`, { metodo: "POST", csrf, corpo: { continuar } });

// Senha de ativação da área não oficial
export const situacaoAcessoPublico = () => buscarApi("/api/unofficial/access", { tentativas: 0 });
export const cadastrarSenhaPublica = (csrf, senha, pergunta, resposta) =>
  chamarApi("/api/unofficial/access/setup", { metodo: "POST", csrf: csrf || "session", corpo: { password: senha, recoveryQuestion: pergunta, recoveryAnswer: resposta } });
export const conferirSenhaPublica = (csrf, senha) =>
  chamarApi("/api/unofficial/access/verify", { metodo: "POST", csrf: csrf || "session", corpo: { password: senha } });
export const recuperarSenhaPublica = (csrf, resposta) =>
  chamarApi("/api/unofficial/access/recover", { metodo: "POST", csrf: csrf || "session", corpo: { recoveryAnswer: resposta } });
export const redefinirSenhaPublica = (csrf, resposta, novaSenha) =>
  chamarApi("/api/unofficial/access/reset", { metodo: "POST", csrf: csrf || "session", corpo: { recoveryAnswer: resposta, newPassword: novaSenha } });

// --- Chat interno da equipe ---
export const chatContatos = () => chamarApi("/api/chat/contatos", { tentativas: 0 });
export const chatConversas = () => chamarApi("/api/chat/conversas", { tentativas: 0 });
export const chatNaoLidas = () => chamarApi("/api/chat/nao-lidas", { tentativas: 0 });
export const chatMensagens = (contatoId) => chamarApi(`/api/chat/mensagens/${encodeURIComponent(contatoId)}`, { tentativas: 0 });
export const chatEnviar = (csrf, paraId, texto) => chamarApi("/api/chat/mensagens", { metodo: "POST", csrf, corpo: { paraId, texto } });
export const chatApagarMensagem = (csrf, id) => chamarApi(`/api/chat/mensagens/${encodeURIComponent(id)}`, { metodo: "DELETE", csrf });
export const chatPreferencias = (csrf, contatoId, prefs) => chamarApi(`/api/chat/conversas/${encodeURIComponent(contatoId)}/preferencias`, { metodo: "POST", csrf, corpo: prefs });
export const chatApagarConversa = (csrf, contatoId) => chamarApi(`/api/chat/conversas/${encodeURIComponent(contatoId)}`, { metodo: "DELETE", csrf });
export const salvarFotoPerfil = (csrf, fotoPerfil) => chamarApi("/api/auth/foto-perfil", { metodo: "POST", csrf, corpo: { fotoPerfil } });

// --- Rotas oficiais novas (pedidos, perguntas, visitas, tendências, reputação) ---
export function buscarPedidos({ pagina = 1, limite = 50, status = "all", de = "", ate = "" } = {}) {
  const parametros = new URLSearchParams({ page: String(pagina), limit: String(limite) });
  if (status && status !== "all") parametros.set("status", status);
  if (de) parametros.set("de", de);
  if (ate) parametros.set("ate", ate);
  return buscarApi(`/api/pedidos?${parametros}`, { tentativas: 1 });
}

export function buscarPerguntas({ pagina = 1, limite = 30, status = "all" } = {}) {
  const parametros = new URLSearchParams({ page: String(pagina), limit: String(limite), status });
  return buscarApi(`/api/perguntas?${parametros}`, { tentativas: 1 });
}

export const responderPergunta = (csrf, id, texto) =>
  chamarApi(`/api/perguntas/${encodeURIComponent(id)}/resposta`, { metodo: "POST", csrf, corpo: { texto } });

export const buscarVisitas = (ids, dias = 30) =>
  buscarApi(`/api/visitas?ids=${encodeURIComponent(ids.join(","))}&dias=${dias}`, { validade: 300000 });

export const buscarTendencias = (categoria) =>
  buscarApi(`/api/tendencias${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ""}`, { validade: 3600000, tentativas: 1 });

export const buscarReputacao = () => buscarApi("/api/reputacao", { validade: 600000, tentativas: 1 });

// --- Histórico ---
export const obterHistorico = () => buscarApi("/api/history?limit=150", { tentativas: 1 });
export const registrarAtividade = (csrf, atividade) =>
  chamarApi("/api/history/activity", { metodo: "POST", csrf, corpo: atividade });
export const baterCoracao = (csrf) => chamarApi("/api/history/heartbeat", { metodo: "POST", csrf });
export const resetarTudo = (csrf, confirmacao) =>
  chamarApi("/api/system/reset", { metodo: "POST", csrf, corpo: { confirmation: confirmacao } });

// --- Assistente (IA) ---
export const listarConversas = (arquivadas = false) =>
  buscarApi(`/api/ai/conversations?archived=${arquivadas}`, { tentativas: 0 });
export const criarConversa = (csrf, titulo) =>
  chamarApi("/api/ai/conversations", { metodo: "POST", csrf, corpo: titulo ? { title: titulo } : {} });
export const buscarMensagens = (id) =>
  buscarApi(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, { tentativas: 0 });
export const atualizarConversa = (csrf, id, dados) =>
  chamarApi(`/api/ai/conversations/${encodeURIComponent(id)}`, { metodo: "PATCH", csrf, corpo: dados });
export const excluirConversa = (csrf, id) =>
  chamarApi(`/api/ai/conversations/${encodeURIComponent(id)}`, { metodo: "DELETE", csrf });

// Envio com streaming: o texto chega aos pedaços por SSE, e vou repassando
// pros callbacks conforme os eventos aparecem (raciocínio, conteúdo, fim, erro)
export async function enviarMensagemIa(csrf, idConversa, entrada, retornos) {
  const resposta = await fetch(montarUrl(`/api/ai/conversations/${encodeURIComponent(idConversa)}/messages/stream`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify(entrada),
    credentials: "include",
  });

  if (!resposta.ok) {
    try {
      const erro = await resposta.json();
      retornos.aoErrar(erro?.error?.message ?? erro?.message ?? "Erro ao iniciar a conversa.");
    } catch {
      retornos.aoErrar("Erro ao iniciar a conversa.");
    }
    return;
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let acumulado = "";

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      acumulado += decodificador.decode(value, { stream: true });
      const eventos = acumulado.split("\n\n");
      acumulado = eventos.pop() ?? "";

      for (const evento of eventos) {
        if (!evento.trim()) continue;
        let tipo = "";
        let dados = "";
        for (const linha of evento.split("\n")) {
          if (linha.startsWith("event: ")) tipo = linha.slice(7).trim();
          else if (linha.startsWith("data: ")) dados = linha.slice(6).trim();
        }
        if (!tipo || !dados) continue;
        try {
          const conteudo = JSON.parse(dados);
          if (tipo === "reasoning") retornos.aoRaciocinar?.(conteudo.text);
          else if (tipo === "content") retornos.aoResponder?.(conteudo.text);
          else if (tipo === "done") retornos.aoTerminar?.(conteudo);
          else if (tipo === "error") retornos.aoErrar?.(conteudo.message ?? "Erro desconhecido.");
          else if (tipo === "status") retornos.aoStatus?.(conteudo);
        } catch {
          // evento veio quebrado; ignoro e sigo lendo
        }
      }
    }
  } catch (motivo) {
    retornos.aoErrar?.(motivo instanceof Error ? motivo.message : "A conexão com o assistente caiu.");
  }
}
