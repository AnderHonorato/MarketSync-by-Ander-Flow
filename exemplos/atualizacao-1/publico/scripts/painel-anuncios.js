// ============================================================
// painel-anuncios.js — a aba principal da conta conectada:
// busca, filtros, ordenação, seleção, alterações em massa,
// exportação e o detalhe completo de cada anúncio.
// ============================================================

import {
  el, icone, formatarMoeda, formatarNumero, formatarData, nomeStatus,
  classeStatus, nomeCondicao, percentualDesconto, aguardarDigitacao,
  gerarId, lerSalvo, salvar, baixarArquivo,
} from "./utilitarios.js";
import {
  buscarAnuncios, buscarAnuncio, buscarRanking, buscarVisitas, parametrosConsulta,
  preverAlteracaoMassa, executarAlteracaoMassa, acompanharAlteracaoMassa,
  exportarAnuncios, erroAmigavel,
} from "./api.js";
import {
  avisar, abrirModal, fecharModal, confirmar, estadoVazio,
  esqueletoLinhas, montarPaginacao, botaoCopiar, caixaMarcar, abrirMenuSuspenso,
} from "./componentes.js";
import { limparCacheAnuncios } from "./dados-anuncios.js";

// ----- Estado da consulta (persistido no navegador) -----

const FILTROS_VAZIOS = {
  status: [], estoque: "", vendas: "", idade: "", catalogo: "", promocao: "",
  condicao: "", tipoAnuncio: "", categoria: "", precoMinimo: "", precoMaximo: "",
  descontoMinimo: "", descontoMaximo: "", criadoDe: "", criadoAte: "",
};

const consulta = {
  busca: "",
  filtros: { ...FILTROS_VAZIOS, ...lerSalvo("marketsync_filtros", {}) },
  ordenacao: lerSalvo("marketsync_ordenacao", "created_desc"),
  pagina: 1,
  tamanhoPagina: lerSalvo("marketsync_tamanho_pagina", 30),
};

// Seleção: ou uma lista explícita de IDs, ou "todos os filtrados" menos exceções
let selecao = { modo: "explicita", ids: new Set() };
let paginaAtual = null;   // última resposta da API
let gavetaAberta = false;
let contextoGlobal = null;
let raiz = null;

const rotulosAcoes = {
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

export function iniciarPainelAnuncios(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("chave", "Conecte a conta pra gerenciar os anúncios",
      "Essa aba mostra os anúncios oficiais da conta autorizada. Use o botão “Conectar conta” no topo da página."));
    return;
  }

  montarEstrutura();
  carregarPagina();

  contexto.eventos.addEventListener("sincronizacao-concluida", () => {
    limparCacheAnuncios();
    carregarPagina();
  });
}

// ----- Estrutura fixa do painel -----

let areaLista, areaSelecao, areaGaveta, areaResumo;

function montarEstrutura() {
  raiz.replaceChildren();

  const campoBusca = el("input", {
    placeholder: "Buscar por título, MLB, SKU ou categoria…",
    value: consulta.busca,
    aoDigitar: aguardarDigitacao((evento) => {
      consulta.busca = evento.target.value.trim();
      consulta.pagina = 1;
      carregarPagina();
    }),
  });

  const seletorOrdenacao = el("select", { "aria-label": "Ordenar anúncios", aoMudar: (evento) => {
    consulta.ordenacao = evento.target.value;
    consulta.pagina = 1;
    salvar("marketsync_ordenacao", consulta.ordenacao);
    carregarPagina();
  } },
    montarOpcoes([
      ["created_desc", "Mais recentes"], ["created_asc", "Mais antigos"],
      ["price_desc", "Maior preço"], ["price_asc", "Menor preço"],
      ["stock_desc", "Maior estoque"], ["stock_asc", "Menor estoque"],
      ["sold_desc", "Mais vendidos"], ["sold_asc", "Menos vendidos"],
      ["discount_desc", "Maior desconto"], ["discount_asc", "Menor desconto"],
      ["age_desc", "Maior tempo ativo"], ["age_asc", "Menor tempo ativo"],
      ["title_asc", "Título A→Z"], ["title_desc", "Título Z→A"],
    ], consulta.ordenacao),
  );

  const botaoFiltros = el("button", { classe: "botao", aoClicar: () => {
    gavetaAberta = !gavetaAberta;
    desenharGaveta();
  } }, icone("filtro"), el("span", { id: "contador-filtros" }, "Filtros"));

  const botaoExportar = el("button", { classe: "botao", aoClicar: exportarPlanilha }, icone("baixar"), "Exportar");

  raiz.append(el("div", { classe: "barra-ferramentas" },
    el("div", { classe: "caixa-busca" }, icone("lupa"), campoBusca),
    botaoFiltros,
    seletorOrdenacao,
    el("div", { classe: "espaco" }),
    botaoExportar,
  ));

  areaGaveta = el("div");
  areaSelecao = el("div");
  areaResumo = el("div", { classe: "resumo-consulta", style: "margin-bottom:10px" });
  areaLista = el("div");
  raiz.append(areaGaveta, areaSelecao, areaResumo, areaLista);
  desenharGaveta();
}

function montarOpcoes(pares, escolhido) {
  return pares.map(([valor, rotulo]) => el("option", { value: valor, selected: valor === escolhido }, rotulo));
}

// ----- Gaveta de filtros -----

function quantosFiltrosAtivos() {
  const filtros = consulta.filtros;
  let quantos = filtros.status.length ? 1 : 0;
  for (const [chave, valor] of Object.entries(filtros)) {
    if (chave !== "status" && valor) quantos += 1;
  }
  return quantos;
}

function desenharGaveta() {
  const contador = document.getElementById("contador-filtros");
  const ativos = quantosFiltrosAtivos();
  if (contador) contador.textContent = ativos ? `Filtros (${ativos})` : "Filtros";

  areaGaveta.replaceChildren();
  if (!gavetaAberta) return;

  const filtros = consulta.filtros;
  const aplicar = () => {
    consulta.pagina = 1;
    salvar("marketsync_filtros", filtros);
    desenharGaveta();
    carregarPagina();
  };

  // Chips de status (dá pra combinar mais de um)
  const grupoStatus = el("div", { classe: "grupo-filtro" },
    el("strong", {}, "Status"),
    el("div", { classe: "chips" },
      [["active", "Ativos"], ["paused", "Pausados"], ["closed", "Encerrados"], ["under_review", "Em revisão"]].map(([valor, rotulo]) =>
        el("button", {
          classe: filtros.status.includes(valor) ? "ativa" : "",
          aoClicar: () => {
            filtros.status = filtros.status.includes(valor)
              ? filtros.status.filter((s) => s !== valor)
              : [...filtros.status, valor];
            aplicar();
          },
        }, rotulo),
      ),
    ),
  );

  const seletor = (rotulo, chave, opcoes) => el("label", { classe: "campo" },
    el("span", {}, rotulo),
    el("select", { aoMudar: (evento) => { filtros[chave] = evento.target.value; aplicar(); } },
      montarOpcoes(opcoes, filtros[chave])),
  );

  const numero = (rotulo, chave, dica) => el("label", { classe: "campo" },
    el("span", {}, rotulo),
    el("input", { type: "number", min: "0", step: "0.01", placeholder: dica ?? "", value: filtros[chave],
      aoMudar: (evento) => { filtros[chave] = evento.target.value; aplicar(); } }),
  );

  const data = (rotulo, chave) => el("label", { classe: "campo" },
    el("span", {}, rotulo),
    el("input", { type: "date", value: filtros[chave],
      aoMudar: (evento) => { filtros[chave] = evento.target.value; aplicar(); } }),
  );

  areaGaveta.append(el("div", { classe: "gaveta-filtros" },
    grupoStatus,
    el("div", { classe: "grupo-filtro" },
      el("strong", {}, "Desempenho"),
      el("div", { classe: "empilhado" },
        seletor("Estoque", "estoque", [["", "Todos"], ["with", "Com estoque"], ["without", "Sem estoque"]]),
        seletor("Vendas", "vendas", [
          ["", "Todas"], ["with", "Com vendas"], ["zero", "Sem nenhuma venda"],
          ["none_7", "Sem vender há 7 dias"], ["none_15", "Sem vender há 15 dias"],
          ["none_30", "Sem vender há 30 dias"], ["none_60", "Sem vender há 60 dias"],
          ["none_90", "Sem vender há 90 dias"],
        ]),
        seletor("Tempo ativo", "idade", [
          ["", "Qualquer"], ["lt7", "Menos de 7 dias"], ["7_30", "7 a 30 dias"],
          ["31_60", "31 a 60 dias"], ["61_90", "61 a 90 dias"],
          ["gt90", "Mais de 90 dias"], ["gt180", "Mais de 180 dias"], ["gt365", "Mais de 1 ano"],
        ]),
      ),
    ),
    el("div", { classe: "grupo-filtro" },
      el("strong", {}, "Formato da oferta"),
      el("div", { classe: "empilhado" },
        seletor("Catálogo", "catalogo", [["", "Todos"], ["catalog", "No catálogo"], ["traditional", "Tradicionais"], ["associated", "Com produto associado"]]),
        seletor("Promoção", "promocao", [
          ["", "Todas"], ["active", "Promoção ativa"], ["future", "Promoção futura"],
          ["ended", "Promoção encerrada"], ["none", "Sem promoção"],
          ["pix", "Com campanha Pix"], ["pix_active", "Pix ativa"], ["no_pix", "Sem campanha Pix"],
        ]),
        seletor("Condição", "condicao", [["", "Todas"], ["new", "Novo"], ["used", "Usado"], ["refurbished", "Recondicionado"]]),
        seletor("Tipo de anúncio", "tipoAnuncio", [["", "Todos"], ["gold_special", "Clássico"], ["gold_pro", "Premium"], ["free", "Grátis"]]),
      ),
    ),
    el("div", { classe: "grupo-filtro" },
      el("strong", {}, "Faixas e período"),
      el("div", { classe: "empilhado" },
        el("div", { classe: "linha-campos" }, numero("Preço mínimo", "precoMinimo", "R$"), numero("Preço máximo", "precoMaximo", "R$")),
        el("div", { classe: "linha-campos" }, numero("Desconto mín. %", "descontoMinimo"), numero("Desconto máx. %", "descontoMaximo")),
        el("div", { classe: "linha-campos" }, data("Criado a partir de", "criadoDe"), data("Criado até", "criadoAte")),
      ),
    ),
    el("div", { classe: "rodape-filtros" },
      el("button", { classe: "botao discreto", aoClicar: () => {
        consulta.filtros = { ...FILTROS_VAZIOS };
        consulta.pagina = 1;
        salvar("marketsync_filtros", consulta.filtros);
        desenharGaveta();
        carregarPagina();
      } }, "Limpar filtros"),
      el("button", { classe: "botao", aoClicar: () => { gavetaAberta = false; desenharGaveta(); } }, "Fechar"),
    ),
  ));
}

// ----- Carregar e desenhar a lista -----

let controladorBusca = null;

async function carregarPagina() {
  controladorBusca?.abort();
  controladorBusca = new AbortController();
  areaLista.replaceChildren(esqueletoLinhas(8, 52));
  areaResumo.textContent = "";

  try {
    paginaAtual = await buscarAnuncios(consulta, controladorBusca.signal);
  } catch (motivo) {
    if (motivo?.name === "AbortError") return;
    areaLista.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const { items = [], total = 0, totalPages = 1 } = paginaAtual;
  areaResumo.replaceChildren(
    el("span", {}, el("strong", {}, formatarNumero(total)), ` anúncio${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`),
    consulta.busca ? el("span", {}, ` para “${consulta.busca}”`) : null,
  );

  if (!items.length) {
    areaLista.replaceChildren(estadoVazio("caixa", "Nenhum anúncio por aqui",
      quantosFiltrosAtivos() || consulta.busca
        ? "Nada bateu com a busca e os filtros atuais. Tente afrouxar algum critério."
        : "Rode uma sincronização pra trazer os anúncios da conta."));
    desenharBarraSelecao();
    return;
  }

  desenharTabela(items, total, totalPages);
  desenharBarraSelecao();
}

function itemSelecionado(id) {
  return selecao.modo === "explicita" ? selecao.ids.has(id) : !selecao.excecoes.has(id);
}

function quantosSelecionados() {
  return selecao.modo === "explicita" ? selecao.ids.size : Math.max(0, selecao.total - selecao.excecoes.size);
}

function desenharTabela(itens, total, totalPaginas) {
  const cabecalhoMarcar = caixaMarcar(
    itens.every((item) => itemSelecionado(item.id)) && itens.length > 0,
    (marcado) => {
      if (selecao.modo !== "explicita") selecao = { modo: "explicita", ids: new Set() };
      for (const item of itens) {
        if (marcado) selecao.ids.add(item.id);
        else selecao.ids.delete(item.id);
      }
      desenharTabela(itens, total, totalPaginas);
      desenharBarraSelecao();
    },
  );

  const tabela = el("table", { classe: "tabela" },
    el("thead", {}, el("tr", {},
      el("th", { style: "width:36px" }, cabecalhoMarcar.elemento),
      el("th", {}, "Anúncio"),
      el("th", {}, "Status"),
      el("th", { classe: "celula-numero" }, "Preço"),
      el("th", { classe: "celula-numero" }, "Estoque"),
      el("th", { classe: "celula-numero" }, "Vendidos"),
      el("th", {}, "Oferta"),
      el("th", {}, "Criado em"),
      el("th", { style: "width:80px" }, ""),
    )),
    el("tbody", {}, itens.map((item) => montarLinha(item, itens, total, totalPaginas))),
  );

  const paginacao = montarPaginacao({
    pagina: paginaAtual.page,
    totalPaginas,
    total,
    tamanhoPagina: consulta.tamanhoPagina,
    aoTrocarPagina: (pagina) => {
      consulta.pagina = Math.max(1, Math.min(pagina, totalPaginas));
      carregarPagina();
    },
    aoTrocarTamanho: (tamanho) => {
      consulta.tamanhoPagina = tamanho;
      consulta.pagina = 1;
      salvar("marketsync_tamanho_pagina", tamanho);
      carregarPagina();
    },
  });

  areaLista.replaceChildren(el("div", { classe: "envoltorio-tabela" }, tabela), paginacao);
}

function montarLinha(item, itens, total, totalPaginas) {
  const marcador = caixaMarcar(itemSelecionado(item.id), (marcado) => {
    if (selecao.modo === "explicita") {
      if (marcado) selecao.ids.add(item.id);
      else selecao.ids.delete(item.id);
    } else if (marcado) selecao.excecoes.delete(item.id);
    else selecao.excecoes.add(item.id);
    linha.classList.toggle("selecionada", marcado);
    desenharBarraSelecao();
  });

  const desconto = percentualDesconto(item.originalPrice, item.price);
  const promocao = item.promotion;

  const etiquetaSync = item.syncChange
    ? el("span", {
        classe: `mudanca-sync ${item.syncChange.kind === "added" ? "nova" : item.syncChange.kind === "removed" ? "removida" : "alterada"}`,
        title: item.syncChange.fields?.length ? `Campos: ${item.syncChange.fields.join(", ")}` : "",
      }, item.syncChange.kind === "added" ? "novo" : item.syncChange.kind === "removed" ? "sumiu" : "mudou")
    : null;

  const linha = el("tr", { classe: itemSelecionado(item.id) ? "selecionada" : "" },
    el("td", {}, marcador.elemento),
    el("td", {}, el("div", { classe: "celula-produto" },
      item.thumbnail
        ? el("img", { src: item.thumbnail, alt: "", loading: "lazy" })
        : el("div", { classe: "miniatura-vazia" }, icone("caixa")),
      el("div", { classe: "info" },
        el("div", { classe: "titulo" }, item.title, etiquetaSync ? " " : "", etiquetaSync),
        el("div", { classe: "codigo" }, el("code", {}, item.id), botaoCopiar(item.id, "Copiar MLB"),
          item.sku ? el("span", {}, ` · SKU ${item.sku}`) : null),
      ),
    )),
    el("td", {}, el("span", { classe: `status-anuncio ${classeStatus(item.status)}` }, el("i"), nomeStatus(item.status))),
    el("td", { classe: "celula-numero" },
      el("div", {}, el("strong", {}, formatarMoeda(item.price, item.currencyId)),
        desconto ? el("div", { style: "font-size:.72rem;color:var(--texto-fraco)" },
          el("del", {}, formatarMoeda(item.originalPrice, item.currencyId)), ` −${desconto}%`) : null),
    ),
    el("td", { classe: "celula-numero" }, formatarNumero(item.availableQuantity)),
    el("td", { classe: "celula-numero" }, formatarNumero(item.soldQuantity)),
    el("td", {}, el("div", { style: "display:flex;gap:4px;flex-wrap:wrap" },
      item.catalogListing ? el("span", { classe: "selo azul" }, icone("trofeu"), "Catálogo") : null,
      promocao?.status === "active" ? el("span", { classe: "selo verde" }, promocao.pix ? "Pix" : "Promo") : null,
      promocao?.status === "future" ? el("span", { classe: "selo laranja" }, "Promo futura") : null,
      item.freeShipping ? el("span", { classe: "selo" }, icone("caminhao"), "Frete grátis") : null,
    )),
    el("td", {}, el("span", { title: `${item.activeDays ?? "—"} dias ativo` }, formatarData(item.createdAt))),
    el("td", {}, el("div", { style: "display:flex;gap:2px;justify-content:flex-end" },
      el("button", { classe: "botao-icone", title: "Ver detalhes", aoClicar: () => abrirDetalhe(item.id) }, icone("olho")),
      item.permalink ? el("a", { classe: "botao-icone", title: "Abrir no Mercado Livre", href: item.permalink, target: "_blank", rel: "noreferrer" }, icone("externo")) : null,
    )),
  );
  return linha;
}

// ----- Barra de seleção e ações em massa -----

function desenharBarraSelecao() {
  areaSelecao.replaceChildren();
  const quantos = quantosSelecionados();
  if (!quantos) return;

  const botaoAcoes = el("button", { classe: "botao primario pequeno", aoClicar: (evento) => {
    abrirMenuSuspenso(evento.currentTarget, Object.entries(rotulosAcoes).map(([tipo, rotulo]) => ({
      rotulo,
      icone: tipo.includes("price") ? "moeda" : tipo.includes("stock") ? "caixa" : tipo === "set_sku" ? "lapis" : tipo === "pause" ? "relogio" : tipo === "activate" ? "confere" : "etiqueta",
      aoClicar: () => abrirFormularioAcao(tipo),
    })));
  } }, "Aplicar ação…");

  areaSelecao.append(el("div", { classe: "barra-selecao" },
    el("span", {}, el("strong", {}, formatarNumero(quantos)), ` selecionado${quantos === 1 ? "" : "s"}`),
    selecao.modo === "explicita" && paginaAtual && paginaAtual.total > quantos
      ? el("button", { classe: "botao-texto", aoClicar: () => {
          selecao = { modo: "todos", excecoes: new Set(), total: paginaAtual.total };
          carregarPagina();
        } }, `Selecionar todos os ${formatarNumero(paginaAtual.total)} filtrados`)
      : null,
    el("div", { classe: "acoes-selecao" },
      botaoAcoes,
      el("button", { classe: "botao pequeno", aoClicar: () => {
        selecao = { modo: "explicita", ids: new Set() };
        carregarPagina();
      } }, "Limpar seleção"),
    ),
  ));
}

// A seleção precisa ir pra API no formato dela (nomes em inglês)
function montarSelecaoParaApi() {
  if (selecao.modo === "explicita") return { mode: "explicit", ids: [...selecao.ids] };
  const f = consulta.filtros;
  return {
    mode: "allFiltered",
    excludedIds: [...selecao.excecoes],
    filters: {
      search: consulta.busca,
      sort: consulta.ordenacao,
      scoreEnabled: true,
      filters: {
        statuses: f.status, stock: f.estoque, sales: f.vendas, age: f.idade,
        catalog: f.catalogo, promotion: f.promocao, condition: f.condicao,
        listingType: f.tipoAnuncio, categoryId: f.categoria,
        minPrice: f.precoMinimo, maxPrice: f.precoMaximo,
        minDiscount: f.descontoMinimo, maxDiscount: f.descontoMaximo,
        createdFrom: f.criadoDe, createdTo: f.criadoAte,
      },
    },
  };
}

function abrirFormularioAcao(tipo) {
  const precisaValor = tipo.includes("price") || tipo.includes("stock") || tipo === "set_sku";
  const ehPreco = tipo.includes("price");
  const ehAjuste = ["increase_price", "decrease_price"].includes(tipo);

  const campoValor = el("input", {
    type: tipo === "set_sku" ? "text" : "number",
    min: "0",
    step: ehPreco ? "0.01" : "1",
    placeholder: tipo === "set_sku" ? "Novo SKU" : ehPreco ? "0,00" : "0",
  });
  const campoUnidade = el("select", {},
    el("option", { value: "fixed" }, "Valor em R$"),
    el("option", { value: "percentage" }, "Percentual (%)"));
  const campoArredondar = el("select", {},
    el("option", { value: "none" }, "Sem arredondar"),
    el("option", { value: "integer" }, "Número inteiro"),
    el("option", { value: "ending_90" }, "Terminar em ,90"),
    el("option", { value: "ending_99" }, "Terminar em ,99"));
  const campoMinimo = el("input", { type: "number", min: "0", step: "0.01", placeholder: "opcional" });
  const campoMaximo = el("input", { type: "number", min: "0", step: "0.01", placeholder: "opcional" });

  const corpo = el("div", { style: "display:flex;flex-direction:column;gap:12px" },
    el("p", { style: "font-size:.87rem;color:var(--texto-suave)" },
      `A ação será aplicada em ${formatarNumero(quantosSelecionados())} anúncio(s). Você ainda vai revisar a prévia antes de confirmar.`),
    precisaValor ? el("label", { classe: "campo" }, el("span", {}, tipo === "set_sku" ? "Novo SKU" : "Valor"), campoValor) : null,
    ehAjuste ? el("label", { classe: "campo" }, el("span", {}, "Tipo de ajuste"), campoUnidade) : null,
    ehPreco ? el("label", { classe: "campo" }, el("span", {}, "Arredondamento"), campoArredondar) : null,
    ehAjuste ? el("div", { classe: "linha-campos", style: "display:flex;gap:8px" },
      el("label", { classe: "campo", style: "flex:1" }, el("span", {}, "Preço mínimo final"), campoMinimo),
      el("label", { classe: "campo", style: "flex:1" }, el("span", {}, "Preço máximo final"), campoMaximo),
    ) : null,
  );

  abrirModal({
    chapeu: "Alteração em massa",
    titulo: rotulosAcoes[tipo],
    corpo,
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao primario", aoClicar: async (evento) => {
        const operacao = { type: tipo };
        if (precisaValor) {
          if (!campoValor.value.trim()) { avisar("Informe o valor da ação.", "perigo"); return; }
          operacao.value = tipo === "set_sku" ? campoValor.value.trim() : Number(campoValor.value);
        }
        if (ehAjuste) {
          operacao.unit = campoUnidade.value;
          if (campoMinimo.value) operacao.minPrice = Number(campoMinimo.value);
          if (campoMaximo.value) operacao.maxPrice = Number(campoMaximo.value);
        }
        if (ehPreco && campoArredondar.value !== "none") operacao.rounding = campoArredondar.value;

        const botao = evento.currentTarget;
        botao.disabled = true;
        try {
          const previa = await preverAlteracaoMassa(contextoGlobal.csrf, montarSelecaoParaApi(), operacao, gerarId());
          abrirPrevia(previa, operacao);
        } catch (motivo) {
          avisar(erroAmigavel(motivo), "perigo");
          botao.disabled = false;
        }
      } }, "Ver prévia"),
    ],
  });
}

function abrirPrevia(previa, operacao) {
  const linhas = (previa.items ?? []).slice(0, 60).map((item) => el("tr", {},
    el("td", {}, el("code", {}, item.id)),
    el("td", {}, item.title ?? "—"),
    el("td", { classe: "celula-numero" }, item.currentValue ?? "—"),
    el("td", { classe: "celula-numero" }, el("strong", {}, item.newValue ?? "—")),
    el("td", {}, item.valid === false
      ? el("span", { classe: "selo vermelho" }, item.message || "inválido")
      : el("span", { classe: "selo verde" }, "ok")),
  ));

  abrirModal({
    chapeu: "Revise antes de confirmar",
    titulo: `Prévia — ${rotulosAcoes[operacao.type]}`,
    tamanho: "largo",
    corpo: el("div", {},
      el("p", { style: "font-size:.87rem;margin-bottom:10px" },
        `${formatarNumero(previa.affected)} anúncios afetados · `,
        el("strong", { style: "color:var(--sucesso)" }, `${formatarNumero(previa.valid)} válidos`),
        previa.invalid ? el("span", { style: "color:var(--perigo)" }, ` · ${formatarNumero(previa.invalid)} inválidos`) : null),
      (previa.warnings ?? []).map((texto) => el("div", { classe: "aviso atencao" }, icone("alerta"), texto)),
      el("div", { classe: "envoltorio-tabela", style: "max-height:340px;overflow:auto" },
        el("table", { classe: "tabela" },
          el("thead", {}, el("tr", {}, el("th", {}, "MLB"), el("th", {}, "Título"), el("th", { classe: "celula-numero" }, "Atual"), el("th", { classe: "celula-numero" }, "Novo"), el("th", {}, ""))),
          el("tbody", {}, linhas),
        )),
      previa.items?.length > 60 ? el("p", { style: "font-size:.78rem;color:var(--texto-suave);margin-top:6px" }, `Mostrando os primeiros 60 de ${previa.items.length}.`) : null,
    ),
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao primario", disabled: !previa.valid, aoClicar: async (evento) => {
        const botao = evento.currentTarget;
        botao.disabled = true;
        try {
          const trabalho = await executarAlteracaoMassa(contextoGlobal.csrf, previa, gerarId());
          contextoGlobal.registrar("bulk.execute", { targetType: "bulk-job", targetId: trabalho.id, metadata: { action: operacao.type } });
          acompanharTrabalho(trabalho);
        } catch (motivo) {
          avisar(erroAmigavel(motivo), "perigo");
          botao.disabled = false;
        }
      } }, `Confirmar em ${formatarNumero(previa.valid)} anúncio(s)`),
    ],
  });
}

function acompanharTrabalho(trabalho) {
  const areaProgresso = el("div", {},
    el("div", { classe: "progresso", style: "margin-bottom:10px" }, el("i", { style: "width:0%" })),
    el("p", { style: "font-size:.87rem;color:var(--texto-suave)" }, "Aplicando as alterações…"),
  );
  abrirModal({ chapeu: "Executando", titulo: rotulosAcoes[trabalho.type] ?? "Alteração em massa", corpo: areaProgresso });

  const cronometro = setInterval(async () => {
    let atual;
    try { atual = await acompanharAlteracaoMassa(trabalho.id); }
    catch { return; } // tento de novo na próxima batida
    const progresso = atual.total ? Math.round((atual.processed / atual.total) * 100) : 0;
    areaProgresso.querySelector(".progresso i").style.width = `${progresso}%`;
    areaProgresso.querySelector("p").textContent = `${formatarNumero(atual.processed)} de ${formatarNumero(atual.total)} · ${formatarNumero(atual.successes)} ok · ${formatarNumero(atual.failures)} falhas`;

    if (["completed", "failed", "cancelled"].includes(atual.status)) {
      clearInterval(cronometro);
      fecharModal();
      if (atual.failures) {
        avisar(`Alteração terminou com ${formatarNumero(atual.failures)} falha(s). ${formatarNumero(atual.successes)} aplicadas.`, "perigo", 7000);
      } else {
        avisar(`Alteração aplicada em ${formatarNumero(atual.successes)} anúncio(s).`, "sucesso");
      }
      selecao = { modo: "explicita", ids: new Set() };
      limparCacheAnuncios();
      carregarPagina();
    }
  }, 1000);
}

// ----- Exportação -----

async function exportarPlanilha() {
  contextoGlobal.registrar("export.start");
  avisar("Gerando a planilha…", "info", 2500);
  try {
    const parametros = parametrosConsulta({ ...consulta, pagina: 1, tamanhoPagina: 200 });
    const { blob, nome } = await exportarAnuncios(parametros);
    baixarArquivo(nome ?? "anuncios.xlsx", blob);
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
  }
}

// ----- Detalhe do anúncio -----

async function abrirDetalhe(id) {
  const corpo = el("div", {}, esqueletoLinhas(5, 60));
  abrirModal({ chapeu: "Anúncio", titulo: id, tamanho: "gigante", corpo });
  contextoGlobal.registrar("listing.view", { targetType: "listing", targetId: id });

  let detalhe;
  try { detalhe = await buscarAnuncio(id); }
  catch (motivo) {
    corpo.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }
  corpo.replaceChildren(montarDetalhe(detalhe));
}

function montarDetalhe(detalhe) {
  const fotos = detalhe.pictures ?? [];
  const fotoPrincipal = el("img", { src: fotos[0]?.url ?? detalhe.thumbnail ?? "", alt: detalhe.title });
  const desconto = percentualDesconto(detalhe.originalPrice, detalhe.price);

  const lateral = el("aside", { classe: "midia-detalhe" },
    fotos.length || detalhe.thumbnail ? fotoPrincipal : el("div", { classe: "miniatura-vazia", style: "width:100%;aspect-ratio:1" }, icone("caixa")),
    fotos.length > 1 ? el("div", { classe: "tira-fotos" }, fotos.map((foto, indice) =>
      el("img", { src: foto.url, alt: "", classe: indice === 0 ? "escolhida" : "", aoClicar: (evento) => {
        fotoPrincipal.src = foto.url;
        lateral.querySelectorAll(".tira-fotos img").forEach((imagem) => imagem.classList.remove("escolhida"));
        evento.currentTarget.classList.add("escolhida");
      } }))) : null,
    el("div", { classe: "bloco-preco" },
      el("strong", {}, formatarMoeda(detalhe.price, detalhe.currencyId)),
      desconto ? el("del", {}, formatarMoeda(detalhe.originalPrice, detalhe.currencyId)) : null,
      desconto ? el("span", { classe: "selo verde" }, `−${desconto}%`) : null,
    ),
    el("div", { style: "margin-top:10px;display:flex;flex-direction:column;gap:6px" },
      el("span", { classe: `status-anuncio ${classeStatus(detalhe.status)}` }, el("i"), nomeStatus(detalhe.status)),
      detalhe.permalink ? el("a", { classe: "botao pequeno", href: detalhe.permalink, target: "_blank", rel: "noreferrer" }, "Abrir no Mercado Livre", icone("externo")) : null,
    ),
  );

  const gruposInfo = [
    ["Anúncio", [["MLB", detalhe.id], ["SKU", detalhe.sku], ["Condição", nomeCondicao(detalhe.condition)], ["Tipo", detalhe.listingTypeId], ["Categoria", detalhe.categoryId], ["Dias ativo", detalhe.activeDays]]],
    ["Catálogo", [["Participa", detalhe.catalogListing ? "Sim" : "Não"], ["Produto", detalhe.catalogProductId], ["Elegível", detalhe.catalogEligible == null ? null : detalhe.catalogEligible ? "Sim" : "Não"]]],
    ["Números", [["Estoque", formatarNumero(detalhe.availableQuantity)], ["Vendidos", formatarNumero(detalhe.soldQuantity)], ["Saúde", detalhe.health != null ? `${Math.round(detalhe.health * 100)}%` : null]]],
    ["Entrega", [["Frete grátis", detalhe.freeShipping == null ? null : detalhe.freeShipping ? "Sim" : "Não"], ["Modo", detalhe.shippingMode]]],
    ["Datas", [["Criado", formatarData(detalhe.createdAt, true)], ["Atualizado", formatarData(detalhe.updatedAt, true)]]],
  ];

  const abas = [
    ["informacoes", "Informações"],
    ["descricao", "Descrição"],
    ["ficha", `Ficha (${detalhe.attributes?.length ?? 0})`],
    ["variacoes", `Variações (${detalhe.variations?.length ?? 0})`],
    detalhe.catalogProductId ? ["concorrencia", "Concorrência"] : null,
    ["visitas", "Visitas"],
  ].filter(Boolean);

  const areaAba = el("div", { style: "margin-top:14px" });
  const barraAbas = el("div", { classe: "abas" });
  const mostrarAba = (chave) => {
    barraAbas.querySelectorAll("button").forEach((botao) => botao.classList.toggle("ativa", botao.dataset.aba === chave));
    if (chave === "informacoes") {
      areaAba.replaceChildren(el("div", { classe: "grade-informacoes" },
        gruposInfo.map(([titulo, linhas]) => el("section", {},
          el("h4", {}, titulo),
          linhas.filter(([, valor]) => valor != null && valor !== "" && valor !== "—").map(([rotulo, valor]) =>
            el("div", {}, el("span", {}, rotulo), el("strong", {}, String(valor)))),
        )),
      ));
    } else if (chave === "descricao") {
      areaAba.replaceChildren(el("div", { classe: "descricao-anuncio" },
        detalhe.description || "Este anúncio não tem descrição em texto."));
    } else if (chave === "ficha") {
      areaAba.replaceChildren((detalhe.attributes?.length)
        ? el("div", { classe: "ficha-tecnica" }, detalhe.attributes.map((atributo) =>
            el("div", {}, el("span", {}, atributo.name ?? atributo.id ?? ""), el("strong", {}, atributo.valueName ?? "—"))))
        : estadoVazio("caixa", "Sem ficha técnica"));
    } else if (chave === "variacoes") {
      areaAba.replaceChildren((detalhe.variations?.length)
        ? el("div", { classe: "envoltorio-tabela" }, el("table", { classe: "tabela" },
            el("thead", {}, el("tr", {}, el("th", {}, "Variação"), el("th", {}, "SKU"), el("th", { classe: "celula-numero" }, "Preço"), el("th", { classe: "celula-numero" }, "Estoque"), el("th", { classe: "celula-numero" }, "Vendidos"))),
            el("tbody", {}, detalhe.variations.map((variacao) => el("tr", {},
              el("td", {}, (variacao.attributes ?? []).map((a) => a.valueName).filter(Boolean).join(" · ") || variacao.id),
              el("td", {}, variacao.sku ?? "—"),
              el("td", { classe: "celula-numero" }, formatarMoeda(variacao.price)),
              el("td", { classe: "celula-numero" }, formatarNumero(variacao.availableQuantity)),
              el("td", { classe: "celula-numero" }, formatarNumero(variacao.soldQuantity)),
            )))))
        : estadoVazio("caixa", "Anúncio sem variações"));
    } else if (chave === "concorrencia") {
      areaAba.replaceChildren(esqueletoLinhas(4, 44));
      buscarRanking(detalhe.id)
        .then((ranking) => areaAba.replaceChildren(montarRanking(ranking)))
        .catch((motivo) => areaAba.replaceChildren(el("div", { classe: "aviso atencao" }, icone("alerta"), erroAmigavel(motivo))));
    } else if (chave === "visitas") {
      // Visitas dos últimos 30 dias, com gráfico de barras simples em CSS
      areaAba.replaceChildren(esqueletoLinhas(3, 44));
      buscarVisitas([detalhe.id], 30)
        .then((resposta) => {
          const dados = resposta?.itens?.[0];
          if (!dados || dados.total == null) {
            areaAba.replaceChildren(estadoVazio("grafico", "Sem dados de visitas",
              dados?.erro ?? "A API não devolveu as visitas deste anúncio."));
            return;
          }
          const maior = Math.max(...dados.porDia.map((dia) => dia.visitas), 1);
          areaAba.replaceChildren(
            el("p", { style: "font-size:.87rem;margin-bottom:10px" },
              el("strong", {}, formatarNumero(dados.total)), ` visitas nos últimos ${resposta.dias} dias`,
              detalhe.soldQuantity ? el("span", { style: "color:var(--texto-suave)" }, ` · ${formatarNumero(detalhe.soldQuantity)} vendas no total do anúncio`) : null),
            el("div", { classe: "grafico-visitas" },
              dados.porDia.map((dia) => el("div", {
                classe: "barra-visita",
                title: `${formatarData(dia.data)}: ${formatarNumero(dia.visitas)} visita(s)`,
              }, el("i", { style: `height:${Math.max(4, Math.round((dia.visitas / maior) * 100))}%` })))),
            el("p", { style: "font-size:.72rem;color:var(--texto-fraco);margin-top:6px" },
              "Passe o mouse nas barras pra ver o dia e a quantidade."),
          );
        })
        .catch((motivo) => areaAba.replaceChildren(el("div", { classe: "aviso atencao" }, icone("alerta"), erroAmigavel(motivo))));
    }
  };
  for (const [chave, rotulo] of abas) {
    barraAbas.append(el("button", { dataset: { aba: chave }, aoClicar: () => mostrarAba(chave) }, rotulo));
  }

  const conteudo = el("div", { classe: "conteudo-detalhe" },
    el("h3", {}, detalhe.title),
    el("div", { classe: "identificadores" },
      el("span", {}, el("code", {}, detalhe.id), " ", botaoCopiar(detalhe.id, "Copiar MLB")),
      detalhe.catalogListing ? el("span", { classe: "selo azul" }, icone("trofeu"), "Catálogo") : null,
      detalhe.promotion?.status === "active" ? el("span", { classe: "selo verde" }, detalhe.promotion.pix ? "Campanha Pix" : "Promoção ativa") : null,
    ),
    barraAbas,
    areaAba,
  );

  mostrarAba("informacoes");
  return el("div", { classe: "detalhe-anuncio" }, lateral, conteudo);
}

// Ranking de catálogo — também é usado pelo painel Concorrentes
export function montarRanking(ranking) {
  if (!ranking.available) {
    return estadoVazio("trofeu", "Sem ranking disponível", ranking.message ?? "Este anúncio não participa de uma página de catálogo.");
  }
  const caixa = el("div", {});
  caixa.append(el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:.86rem" },
    ranking.status ? el("span", { classe: `selo ${ranking.status === "winning" ? "verde" : "laranja"}` },
      ranking.status === "winning" ? "Você está ganhando" : "Concorrendo") : null,
    ranking.priceToWin != null ? el("span", {}, "Preço pra ganhar: ", el("strong", {}, formatarMoeda(ranking.priceToWin))) : null,
    ranking.visitShare ? el("span", {}, "Fatia de visitas: ", el("strong", {}, ranking.visitShare)) : null,
  ));
  const participantes = ranking.participants ?? [];
  if (!participantes.length) {
    caixa.append(estadoVazio("usuarios", "Nenhum participante listado", "A API não devolveu a lista de concorrentes deste catálogo."));
    return caixa;
  }
  caixa.append(el("div", {}, participantes.map((participante, indice) => el("div", {
    classe: `linha-participante ${participante.winner ? "vencedor" : ""} ${participante.mine ? "meu" : ""}`,
  },
    el("span", { classe: "posicao" }, `${indice + 1}º`),
    participante.thumbnail ? el("img", { src: participante.thumbnail, alt: "" }) : el("div", { classe: "miniatura-vazia", style: "width:34px;height:34px" }, icone("caixa")),
    el("div", { classe: "quem" },
      el("strong", {}, participante.sellerNickname ?? participante.sellerId ?? "Vendedor"),
      el("small", {},
        participante.mine ? "seu anúncio · " : "",
        participante.reputation ? `reputação ${participante.reputation} · ` : "",
        participante.freeShipping ? "frete grátis" : ""),
    ),
    el("div", { style: "display:flex;flex-direction:column;align-items:flex-end" },
      el("span", { classe: "valor" }, formatarMoeda(participante.price, participante.currencyId)),
      participante.winner ? el("span", { classe: "selo verde" }, icone("trofeu"), "vencedor") : null,
    ),
    participante.permalink ? el("a", { classe: "botao-icone", href: participante.permalink, target: "_blank", rel: "noreferrer", title: "Abrir anúncio" }, icone("externo")) : null,
  ))));
  return caixa;
}
