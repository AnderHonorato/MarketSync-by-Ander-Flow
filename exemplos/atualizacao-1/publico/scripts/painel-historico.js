// ============================================================
// painel-historico.js — sessões e linha do tempo de tudo que
// aconteceu no sistema. Nada de token ou credencial aqui.
// ============================================================

import { el, icone, formatarData, formatarDuracao, formatarNumero, aguardarDigitacao } from "./utilitarios.js";
import { obterHistorico, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas } from "./componentes.js";

const nomesEventos = {
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
  "unofficial.resume": "Leitura pública retomada",
  "export.start": "Exportação solicitada",
};

let filtroAtual = "todos";
let buscaAtual = "";
let periodoAtual = "todos"; // todos | hoje | 7dias
let dadosHistorico = null;
let raiz = null;

export function iniciarPainelHistorico(contexto, secao) {
  raiz = secao;
  desenhar();
  // Sempre que a aba é reaberta, recarrego pra pegar o que aconteceu no meio tempo
  contexto.eventos.addEventListener("painel-mostrado", (evento) => {
    if (evento.detail === "historico" && dadosHistorico) carregar();
  });
}

function desenhar() {
  raiz.replaceChildren(
    el("div", { classe: "cabeca-painel" },
      el("div", { classe: "lado-esquerdo" },
        el("p", { style: "font-size:.85rem;color:var(--texto-suave)" },
          "Registro persistente do que aconteceu no sistema. Tokens e credenciais nunca entram aqui."),
      ),
      el("div", { classe: "lado-direito" },
        el("div", { classe: "caixa-busca", style: "min-width:190px" },
          icone("lupa"),
          el("input", { placeholder: "Buscar no histórico…", aoDigitar: aguardarDigitacao((evento) => {
            buscaAtual = evento.target.value.trim().toLowerCase();
            desenharLinhaTempo();
          }, 250) })),
        el("select", { "aria-label": "Período", aoMudar: (evento) => { periodoAtual = evento.target.value; desenharLinhaTempo(); } },
          [["todos", "Qualquer data"], ["hoje", "Hoje"], ["7dias", "Últimos 7 dias"]].map(([valor, rotulo]) =>
            el("option", { value: valor, selected: periodoAtual === valor }, rotulo)),
        ),
        el("select", { "aria-label": "Filtrar histórico", aoMudar: (evento) => { filtroAtual = evento.target.value; desenharLinhaTempo(); } },
          [["todos", "Todos os movimentos"], ["sessoes", "Sessões e acesso"], ["sincronizacoes", "Sincronizações"],
           ["alteracoes", "Alterações nos anúncios"], ["consultas", "Consultas públicas"], ["falhas", "Só falhas"],
           ["navegacao", "Movimentos na página"]].map(([valor, rotulo]) =>
            el("option", { value: valor, selected: filtroAtual === valor }, rotulo)),
        ),
        el("button", { classe: "botao", aoClicar: carregar }, icone("sincronizar"), "Atualizar"),
      ),
    ),
    el("div", { id: "resumo-historico" }),
    el("div", { id: "area-sessoes" }),
    el("div", { id: "area-linha-tempo" }),
  );
  carregar();
}

// Números gerais do que foi registrado: dão noção de atividade sem
// precisar rolar a linha do tempo inteira
function desenharResumoHistorico() {
  const area = document.getElementById("resumo-historico");
  const eventos = dadosHistorico?.events ?? [];
  const hoje = new Date().toDateString();
  const cartao = (nomeIcone, rotulo, valor, detalhe) => el("div", { classe: "cartao-resumo" },
    el("span", { classe: "rotulo" }, icone(nomeIcone), rotulo),
    el("strong", {}, valor),
    el("small", {}, detalhe),
  );
  area.replaceChildren(el("div", { classe: "grade-resumo", style: "margin-bottom:16px" },
    cartao("historico", "Eventos registrados", formatarNumero(eventos.length), "nos últimos movimentos"),
    cartao("relogio", "Hoje", formatarNumero(eventos.filter((evento) => new Date(evento.createdAt).toDateString() === hoje).length), "eventos do dia"),
    cartao("sincronizar", "Sincronizações", formatarNumero(eventos.filter((evento) => evento.action === "sync.completed").length), "concluídas no período"),
    cartao("etiqueta", "Alterações em massa", formatarNumero(eventos.filter((evento) => evento.action === "bulk.execute").length), "executadas"),
    cartao("radar", "Consultas públicas", formatarNumero(eventos.filter((evento) => evento.action === "unofficial.complete").length), "concluídas"),
    cartao("alerta", "Falhas", formatarNumero(eventos.filter((evento) => evento.outcome === "FAILURE").length), "eventos com erro"),
  ));
}

async function carregar() {
  const areaSessoes = document.getElementById("area-sessoes");
  const areaLinha = document.getElementById("area-linha-tempo");
  areaSessoes.replaceChildren(esqueletoLinhas(1, 80));
  areaLinha.replaceChildren(esqueletoLinhas(5, 56));

  try {
    dadosHistorico = await obterHistorico();
  } catch (motivo) {
    areaSessoes.replaceChildren();
    areaLinha.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  desenharResumoHistorico();
  desenharSessoes();
  desenharLinhaTempo();
}

function desenharSessoes() {
  const area = document.getElementById("area-sessoes");
  const sessoes = dadosHistorico?.sessions ?? [];
  if (!sessoes.length) {
    area.replaceChildren(estadoVazio("relogio", "Nenhuma sessão registrada"));
    return;
  }
  area.replaceChildren(el("div", { classe: "grade-sessoes" },
    sessoes.map((sessao) => el("article", { classe: `cartao-sessao ${sessao.current ? "atual" : ""}` },
      el("div", { classe: "topo-sessao" }, icone("relogio"), sessao.current ? "Sessão atual" : `Sessão ${sessao.id}`),
      el("span", {}, `Início: ${formatarData(sessao.startedAt, true)}`),
      el("span", {}, `Última atividade: ${formatarData(sessao.lastSeenAt, true)}`),
      el("b", {}, `${formatarDuracao(sessao.activeSeconds)} de atividade`),
    )),
  ));
}

function resumirEvento(acao, dados) {
  if (acao === "sync.completed") {
    return `${formatarNumero(dados.added ?? 0)} adicionados · ${formatarNumero(dados.updated ?? 0)} alterados · ${formatarNumero(dados.removed ?? 0)} não retornaram · ${formatarNumero(dados.unchanged ?? 0)} sem mudanças`;
  }
  if (acao === "ui.theme") return `Tema ${dados.theme === "dark" ? "escuro" : "claro"}`;
  if (acao === "ui.tab") return `Aba: ${String(dados.tab ?? "")}`;
  if (acao === "ui.filters") return `${formatarNumero(dados.active ?? 0)} filtros ativos`;
  if (acao === "unofficial.complete") return `${formatarNumero(dados.total ?? 0)} anúncios lidos · ${formatarNumero(dados.pix ?? 0)} com Pix observado`;
  if (typeof dados.action === "string") return `Ação: ${dados.action}`;
  if (typeof dados.message === "string") return dados.message;
  return "Atividade registrada.";
}

function montarDetalhesSync(dados) {
  const detalhes = Array.isArray(dados.details) ? dados.details.slice(0, 30) : [];
  if (!detalhes.length) return null;
  const legivel = (valor) => valor == null ? "vazio" : typeof valor === "boolean" ? (valor ? "sim" : "não") : String(valor);
  return el("details", { classe: "detalhes-sync-historico" },
    el("summary", {}, "Ver anúncios modificados"),
    el("div", {}, detalhes.map((entrada) => {
      const diferencas = Array.isArray(entrada.differences) ? entrada.differences : [];
      const texto = entrada.kind === "added" ? "adicionado"
        : entrada.kind === "removed" ? "não retornou"
        : diferencas.length
          ? diferencas.map((d) => `${d.field}: ${legivel(d.before)} → ${legivel(d.after)}`).join(" · ")
          : (Array.isArray(entrada.fields) ? entrada.fields.join(", ") : "alterado");
      return el("p", {}, el("strong", {}, String(entrada.id ?? "Anúncio")), el("span", {}, texto));
    })),
  );
}

function desenharLinhaTempo() {
  const area = document.getElementById("area-linha-tempo");
  const limitePeriodo = periodoAtual === "hoje"
    ? new Date(new Date().toDateString()).getTime()
    : periodoAtual === "7dias" ? Date.now() - 7 * 86_400_000 : 0;
  const eventos = (dadosHistorico?.events ?? []).filter((evento) => {
    const passaTipo = filtroAtual === "todos"
      || (filtroAtual === "sessoes" && ["session.start", "oauth.connect", "oauth.disconnect"].includes(evento.action))
      || (filtroAtual === "sincronizacoes" && evento.action.startsWith("sync."))
      || (filtroAtual === "alteracoes" && ["bulk.execute", "sync.completed"].includes(evento.action))
      || (filtroAtual === "consultas" && evento.action.startsWith("unofficial."))
      || (filtroAtual === "falhas" && evento.outcome === "FAILURE")
      || (filtroAtual === "navegacao" && evento.action.startsWith("ui."));
    if (!passaTipo) return false;
    if (limitePeriodo && new Date(evento.createdAt).getTime() < limitePeriodo) return false;
    if (buscaAtual) {
      const texto = `${nomesEventos[evento.action] ?? ""} ${evento.action} ${evento.targetId ?? ""} ${JSON.stringify(evento.metadata ?? {})}`.toLowerCase();
      if (!texto.includes(buscaAtual)) return false;
    }
    return true;
  });

  if (!eventos.length) {
    area.replaceChildren(estadoVazio("historico", "Nenhum movimento nesse filtro"));
    return;
  }

  area.replaceChildren(
    el("p", { style: "font-size:.8rem;color:var(--texto-suave);margin-bottom:6px" }, `${eventos.length} evento(s) exibido(s)`),
    el("div", { classe: "linha-tempo" },
      eventos.map((evento) => el("article", { classe: `evento-historico ${evento.outcome === "FAILURE" ? "falha" : ""}` },
        el("i", {}, icone(evento.action.startsWith("sync.") ? "sincronizar"
          : evento.action.startsWith("unofficial.") ? "radar"
          : evento.action === "bulk.execute" ? "etiqueta"
          : evento.action.startsWith("oauth.") ? "chave"
          : "historico")),
        el("div", { classe: "corpo-evento" },
          el("div", { classe: "linha-titulo" },
            el("strong", {}, nomesEventos[evento.action] ?? evento.action),
            evento.currentSession ? el("span", { classe: "selo-sessao-atual" }, "sessão atual") : null,
            el("time", {}, formatarData(evento.createdAt, true)),
          ),
          el("p", { classe: "resumo-evento" }, resumirEvento(evento.action, evento.metadata ?? {})),
          evento.action === "sync.completed" ? montarDetalhesSync(evento.metadata ?? {}) : null,
          evento.targetId ? el("small", {}, `${evento.targetType || "registro"}: ${evento.targetId}`) : null,
          // Detalhe técnico completo, escondido por padrão pra não poluir
          Object.keys(evento.metadata ?? {}).length
            ? el("details", { classe: "detalhes-sync-historico" },
                el("summary", {}, "Dados completos do evento"),
                el("pre", { style: "font-size:.72rem;background:var(--superficie-2);border-radius:8px;padding:8px 10px;overflow-x:auto;margin-top:4px" },
                  JSON.stringify(evento.metadata, null, 2)))
            : null,
        ),
      )),
    ),
  );
}
