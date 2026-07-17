// ============================================================
// painel-precos.js — visão focada em precificação, inspirada
// na tela "Precificação ML" do metrys-hub antigo: preço atual,
// desconto, promoção e o que mudou desde as últimas cargas
// (o histórico fica salvo no navegador, em dados-anuncios.js).
// ============================================================

import { el, icone, formatarMoeda, formatarNumero, formatarData, percentualDesconto, aguardarDigitacao, baixarArquivo } from "./utilitarios.js";
import { erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas, avisar } from "./componentes.js";
import { carregarTodosAnuncios, variacoesDePreco, totalRetratosPreco, limparCacheAnuncios } from "./dados-anuncios.js";

let contextoGlobal = null;
let raiz = null;

// filtros locais dessa aba (não misturo com os filtros da aba Anúncios)
const visao = { busca: "", filtro: "todos", ordenacao: "maior_desconto" };

export function iniciarPainelPrecos(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("moeda", "Conecte a conta pra acompanhar os preços",
      "Aqui você vê preço, desconto e promoção de cada anúncio, além do que mudou entre sincronizações."));
    return;
  }

  desenhar();
  contexto.eventos.addEventListener("sincronizacao-concluida", () => {
    limparCacheAnuncios();
    desenhar();
  });
}

async function desenhar() {
  raiz.replaceChildren(esqueletoLinhas(8, 52));

  let itens;
  try { itens = await carregarTodosAnuncios(); }
  catch (motivo) {
    raiz.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const variacoes = variacoesDePreco();
  raiz.replaceChildren();

  // Cartões de resumo da precificação
  const comDesconto = itens.filter((item) => percentualDesconto(item.originalPrice, item.price) > 0);
  const emPromocao = itens.filter((item) => item.promotion?.status === "active");
  const mudaram = Object.keys(variacoes).length;
  const precoMedio = itens.length
    ? itens.reduce((soma, item) => soma + (item.price ?? 0), 0) / itens.filter((item) => item.price != null).length
    : 0;

  raiz.append(el("div", { classe: "grade-resumo", style: "margin-bottom:16px" },
    cartaoResumo("moeda", "Preço médio", formatarMoeda(precoMedio), `${formatarNumero(itens.length)} anúncios`),
    cartaoResumo("etiqueta", "Com desconto", formatarNumero(comDesconto.length), "preço abaixo do original"),
    cartaoResumo("estrela", "Promoção ativa", formatarNumero(emPromocao.length), "campanhas em andamento"),
    cartaoResumo("grafico", "Preços que mudaram", formatarNumero(mudaram),
      totalRetratosPreco() > 1 ? "desde as cargas anteriores" : "o histórico começa agora"),
  ));

  // Ferramentas: busca, filtro e exportação em CSV
  const campoBusca = el("input", {
    placeholder: "Buscar por título ou MLB…",
    value: visao.busca,
    aoDigitar: aguardarDigitacao((evento) => { visao.busca = evento.target.value.trim().toLowerCase(); desenharTabela(itens, variacoes); }),
  });

  raiz.append(el("div", { classe: "barra-ferramentas" },
    el("div", { classe: "caixa-busca" }, icone("lupa"), campoBusca),
    el("select", { aoMudar: (evento) => { visao.filtro = evento.target.value; desenharTabela(itens, variacoes); } },
      [["todos", "Todos os anúncios"], ["desconto", "Com desconto"], ["promocao", "Promoção ativa"],
       ["pix", "Campanha Pix"], ["mudou", "Preço mudou"], ["sem_desconto", "Sem desconto"]].map(([valor, rotulo]) =>
        el("option", { value: valor, selected: visao.filtro === valor }, rotulo)),
    ),
    el("select", { aoMudar: (evento) => { visao.ordenacao = evento.target.value; desenharTabela(itens, variacoes); } },
      [["maior_desconto", "Maior desconto"], ["menor_preco", "Menor preço"], ["maior_preco", "Maior preço"],
       ["mais_vendidos", "Mais vendidos"], ["titulo", "Título A→Z"]].map(([valor, rotulo]) =>
        el("option", { value: valor, selected: visao.ordenacao === valor }, rotulo)),
    ),
    el("div", { classe: "espaco" }),
    el("button", { classe: "botao", aoClicar: () => exportarCsv(itens, variacoes) }, icone("baixar"), "Exportar CSV"),
  ));

  const areaTabela = el("div", { id: "area-tabela-precos" });
  raiz.append(areaTabela);
  desenharTabela(itens, variacoes);
}

function cartaoResumo(nomeIcone, rotulo, valor, detalhe) {
  return el("div", { classe: "cartao-resumo" },
    el("span", { classe: "rotulo" }, icone(nomeIcone), rotulo),
    el("strong", {}, valor),
    el("small", {}, detalhe),
  );
}

function filtrarOrdenar(itens, variacoes) {
  let lista = itens.filter((item) => {
    if (visao.busca && ![item.title, item.id, item.sku].some((valor) => valor?.toLowerCase().includes(visao.busca))) return false;
    const desconto = percentualDesconto(item.originalPrice, item.price);
    if (visao.filtro === "desconto") return desconto > 0;
    if (visao.filtro === "sem_desconto") return desconto === 0;
    if (visao.filtro === "promocao") return item.promotion?.status === "active";
    if (visao.filtro === "pix") return Boolean(item.promotion?.pix);
    if (visao.filtro === "mudou") return Boolean(variacoes[item.id]);
    return true;
  });

  const desconto = (item) => percentualDesconto(item.originalPrice, item.price);
  lista.sort((a, b) => {
    if (visao.ordenacao === "maior_desconto") return desconto(b) - desconto(a);
    if (visao.ordenacao === "menor_preco") return (a.price ?? Infinity) - (b.price ?? Infinity);
    if (visao.ordenacao === "maior_preco") return (b.price ?? -1) - (a.price ?? -1);
    if (visao.ordenacao === "mais_vendidos") return (b.soldQuantity ?? 0) - (a.soldQuantity ?? 0);
    return (a.title ?? "").localeCompare(b.title ?? "", "pt-BR");
  });
  return lista;
}

function desenharTabela(itens, variacoes) {
  const area = document.getElementById("area-tabela-precos");
  if (!area) return;
  const lista = filtrarOrdenar(itens, variacoes).slice(0, 500);

  if (!lista.length) {
    area.replaceChildren(estadoVazio("moeda", "Nada por aqui", "Nenhum anúncio bate com esse filtro."));
    return;
  }

  area.replaceChildren(el("div", { classe: "envoltorio-tabela" },
    el("table", { classe: "tabela" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Anúncio"),
        el("th", { classe: "celula-numero" }, "Preço atual"),
        el("th", { classe: "celula-numero" }, "Preço original"),
        el("th", { classe: "celula-numero" }, "Desconto"),
        el("th", {}, "Promoção"),
        el("th", {}, "Última mudança"),
        el("th", { classe: "celula-numero" }, "Vendidos"),
      )),
      el("tbody", {}, lista.map((item) => {
        const desconto = percentualDesconto(item.originalPrice, item.price);
        const variacao = variacoes[item.id];
        return el("tr", {},
          el("td", {}, el("div", { classe: "celula-produto" },
            item.thumbnail ? el("img", { src: item.thumbnail, alt: "", loading: "lazy" }) : el("div", { classe: "miniatura-vazia" }, icone("caixa")),
            el("div", { classe: "info" },
              el("div", { classe: "titulo" }, item.title),
              el("div", { classe: "codigo" }, el("code", {}, item.id)),
            ),
          )),
          el("td", { classe: "celula-numero" }, el("strong", {}, formatarMoeda(item.price, item.currencyId))),
          el("td", { classe: "celula-numero" }, item.originalPrice && item.originalPrice !== item.price
            ? el("del", {}, formatarMoeda(item.originalPrice, item.currencyId)) : "—"),
          el("td", { classe: "celula-numero" }, desconto ? el("span", { classe: "selo verde" }, `−${desconto}%`) : "—"),
          el("td", {}, montarSeloPromocao(item.promotion)),
          el("td", {}, variacao
            ? el("div", {},
                el("span", { classe: `variacao-preco ${variacao.atual > variacao.anterior ? "subiu" : "caiu"}` },
                  variacao.atual > variacao.anterior ? "▲" : "▼",
                  ` ${formatarMoeda(variacao.anterior)} → ${formatarMoeda(variacao.atual)}`),
                el("div", { style: "font-size:.7rem;color:var(--texto-fraco)" }, formatarData(variacao.em, true)))
            : el("span", { classe: "variacao-preco igual" }, "sem registro")),
          el("td", { classe: "celula-numero" }, formatarNumero(item.soldQuantity)),
        );
      })),
    ),
  ));
}

function montarSeloPromocao(promocao) {
  if (!promocao || promocao.status === "unknown") return el("span", { style: "color:var(--texto-fraco)" }, "—");
  if (promocao.status === "active") {
    return el("span", { classe: "selo verde", title: promocao.name ?? "" }, promocao.pix ? "Pix ativa" : "Ativa");
  }
  if (promocao.status === "future") return el("span", { classe: "selo laranja" }, "Agendada");
  if (promocao.status === "ended") return el("span", { classe: "selo" }, "Encerrada");
  return el("span", { style: "color:var(--texto-fraco)" }, "—");
}

// CSV com ponto e vírgula, do jeito que o Excel em português espera
function exportarCsv(itens, variacoes) {
  contextoGlobal.registrar("export.start", { metadata: { origem: "precos" } });
  const linhas = [["MLB", "Título", "Preço atual", "Preço original", "Desconto %", "Promoção", "Pix", "Preço anterior", "Mudou em", "Vendidos", "Estoque"]];
  for (const item of filtrarOrdenar(itens, variacoes)) {
    const variacao = variacoes[item.id];
    linhas.push([
      item.id,
      `"${(item.title ?? "").replace(/"/g, '""')}"`,
      item.price ?? "",
      item.originalPrice ?? "",
      percentualDesconto(item.originalPrice, item.price) || "",
      item.promotion?.status ?? "",
      item.promotion?.pix ? "sim" : "",
      variacao?.anterior ?? "",
      variacao ? formatarData(variacao.em, true) : "",
      item.soldQuantity ?? "",
      item.availableQuantity ?? "",
    ]);
  }
  baixarArquivo(`precos-${new Date().toISOString().slice(0, 10)}.csv`, linhas.map((linha) => linha.join(";")).join("\n"));
  avisar("Arquivo CSV gerado.", "sucesso");
}
