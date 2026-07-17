// ============================================================
// painel-concorrentes.js — disputa de catálogo, inspirado na
// "Análise de Concorrência" do metrys-hub antigo. Lista os
// anúncios que participam de catálogo e, pra cada um, busca o
// ranking (quem ganha, preço pra ganhar e participantes).
// As buscas são feitas uma a uma, só quando você pede, pra não
// estourar o limite da API.
// ============================================================

import { el, icone, formatarMoeda, formatarNumero, aguardarDigitacao } from "./utilitarios.js";
import { buscarRanking, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas, avisar } from "./componentes.js";
import { carregarTodosAnuncios, limparCacheAnuncios } from "./dados-anuncios.js";
import { montarRanking } from "./painel-anuncios.js";

let raiz = null;
let contextoGlobal = null;
const rankingsCarregados = new Map(); // id do anúncio -> resposta do ranking
const visao = { busca: "", situacao: "todos" };

export function iniciarPainelConcorrentes(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("trofeu", "Conecte a conta pra ver a concorrência",
      "Aqui aparecem os anúncios que disputam páginas de catálogo, com posição, vencedor e preço pra ganhar."));
    return;
  }

  desenhar();
  contexto.eventos.addEventListener("sincronizacao-concluida", () => {
    limparCacheAnuncios();
    rankingsCarregados.clear();
    desenhar();
  });
}

async function desenhar() {
  raiz.replaceChildren(esqueletoLinhas(6, 64));

  let itens;
  try { itens = await carregarTodosAnuncios(); }
  catch (motivo) {
    raiz.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const deCatalogo = itens.filter((item) => item.catalogProductId);
  raiz.replaceChildren();

  if (!deCatalogo.length) {
    raiz.append(estadoVazio("trofeu", "Nenhum anúncio de catálogo",
      "Nenhum dos seus anúncios sincronizados participa de página de catálogo. Sem catálogo não existe disputa de Buy Box."));
    return;
  }

  raiz.append(el("div", { classe: "aviso info" }, icone("info"),
    el("span", {}, `${formatarNumero(deCatalogo.length)} anúncio(s) participam de catálogo. Clique em “Ver disputa” pra consultar a posição atual — a consulta é feita na hora, direto na API oficial.`)));

  const campoBusca = el("input", {
    placeholder: "Filtrar por título ou MLB…",
    aoDigitar: aguardarDigitacao((evento) => { visao.busca = evento.target.value.trim().toLowerCase(); desenharLista(deCatalogo); }),
  });

  raiz.append(el("div", { classe: "barra-ferramentas" },
    el("div", { classe: "caixa-busca" }, icone("lupa"), campoBusca),
    el("select", { aoMudar: (evento) => { visao.situacao = evento.target.value; desenharLista(deCatalogo); } },
      [["todos", "Todos"], ["consultados", "Já consultados"], ["ganhando", "Ganhando"], ["perdendo", "Concorrendo"]].map(([valor, rotulo]) =>
        el("option", { value: valor }, rotulo)),
    ),
    el("div", { classe: "espaco" }),
    el("button", { classe: "botao", aoClicar: () => consultarVarios(deCatalogo) }, icone("sincronizar"), "Consultar os 10 primeiros"),
  ));

  const area = el("div", { classe: "lista-disputas", id: "lista-disputas" });
  raiz.append(area);
  desenharLista(deCatalogo);
}

function desenharLista(anuncios) {
  const area = document.getElementById("lista-disputas");
  if (!area) return;

  const lista = anuncios.filter((item) => {
    if (visao.busca && ![item.title, item.id].some((valor) => valor?.toLowerCase().includes(visao.busca))) return false;
    const ranking = rankingsCarregados.get(item.id);
    if (visao.situacao === "consultados") return Boolean(ranking);
    if (visao.situacao === "ganhando") return ranking?.participants?.some((p) => p.mine && p.winner);
    if (visao.situacao === "perdendo") return ranking && !ranking.participants?.some((p) => p.mine && p.winner);
    return true;
  });

  if (!lista.length) {
    area.replaceChildren(estadoVazio("lupa", "Nada encontrado", "Nenhum anúncio bate com esse filtro."));
    return;
  }

  area.replaceChildren(lista.slice(0, 200).map((item) => montarCartaoDisputa(item)));
}

function montarCartaoDisputa(item) {
  const ranking = rankingsCarregados.get(item.id);
  const areaDetalhe = el("div");
  const areaSituacao = el("div", { classe: "situacao" });

  const cartao = el("div", { classe: "cartao-disputa" },
    el("div", { classe: "linha-topo" },
      item.thumbnail ? el("img", { src: item.thumbnail, alt: "", style: "width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--borda)" })
        : el("div", { classe: "miniatura-vazia" }, icone("caixa")),
      el("div", { style: "flex:1;min-width:200px" },
        el("div", { style: "font-weight:600;font-size:.88rem" }, item.title),
        el("div", { style: "font-size:.74rem;color:var(--texto-fraco)" }, `${item.id} · seu preço: ${formatarMoeda(item.price)}`),
      ),
      areaSituacao,
    ),
    areaDetalhe,
  );

  pintarSituacao(areaSituacao, areaDetalhe, item, ranking);
  return cartao;
}

function pintarSituacao(areaSituacao, areaDetalhe, item, ranking) {
  areaSituacao.replaceChildren();

  if (!ranking) {
    areaSituacao.append(el("button", { classe: "botao pequeno", aoClicar: async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      botao.replaceChildren(icone("sincronizar"), "Consultando…");
      botao.querySelector("svg").classList.add("girando");
      try {
        const resposta = await buscarRanking(item.id);
        rankingsCarregados.set(item.id, resposta);
        pintarSituacao(areaSituacao, areaDetalhe, item, resposta);
      } catch (motivo) {
        avisar(erroAmigavel(motivo), "perigo");
        botao.disabled = false;
        botao.replaceChildren(icone("trofeu"), "Ver disputa");
      }
    } }, icone("trofeu"), "Ver disputa"));
    return;
  }

  const meuGanhando = ranking.participants?.some((p) => p.mine && p.winner);
  const totalConcorrentes = Math.max((ranking.participants?.length ?? 1) - 1, 0);

  if (ranking.available) {
    areaSituacao.append(
      el("span", { classe: `selo ${meuGanhando ? "verde" : "laranja"}` },
        icone(meuGanhando ? "trofeu" : "usuarios"),
        meuGanhando ? "Ganhando" : "Concorrendo"),
      el("span", { classe: "selo" }, `${formatarNumero(totalConcorrentes)} concorrente(s)`),
      ranking.priceToWin != null && !meuGanhando
        ? el("span", { classe: "selo azul" }, `ganha com ${formatarMoeda(ranking.priceToWin)}`)
        : null,
    );
  } else {
    areaSituacao.append(el("span", { classe: "selo" }, "sem ranking"));
  }

  const botaoAbrir = el("button", { classe: "botao pequeno discreto", aoClicar: () => {
    const aberto = areaDetalhe.childElementCount > 0;
    if (aberto) {
      areaDetalhe.replaceChildren();
      botaoAbrir.replaceChildren(icone("olho"), "Detalhes");
    } else {
      areaDetalhe.replaceChildren(el("div", { classe: "detalhe-disputa" }, montarRanking(ranking)));
      botaoAbrir.replaceChildren(icone("fechar"), "Fechar");
    }
  } }, icone("olho"), "Detalhes");
  areaSituacao.append(botaoAbrir);
}

// Consulta os primeiros da lista com uma pausa entre cada chamada,
// pra respeitar o ritmo da API oficial
async function consultarVarios(anuncios) {
  const pendentes = anuncios.filter((item) => !rankingsCarregados.has(item.id)).slice(0, 10);
  if (!pendentes.length) {
    avisar("Os primeiros anúncios já foram consultados.", "info");
    return;
  }
  avisar(`Consultando ${pendentes.length} disputa(s)…`, "info", 3000);
  for (const item of pendentes) {
    try {
      rankingsCarregados.set(item.id, await buscarRanking(item.id));
    } catch {
      // se uma falhar, sigo pras outras — dá pra tentar de novo manualmente
    }
    await new Promise((resolver) => setTimeout(resolver, 600));
  }
  desenharLista(anuncios);
  avisar("Consultas concluídas.", "sucesso");
}
