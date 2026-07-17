// ============================================================
// painel-vendas.js — pedidos e resumo financeiro da conta,
// direto da API oficial (/orders/search). Veio da tela
// "Pedidos & Financeiro" do metrys-hub antigo.
// ============================================================

import { el, icone, formatarMoeda, formatarNumero, formatarData, baixarArquivo } from "./utilitarios.js";
import { buscarPedidos, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas, montarPaginacao, botaoCopiar, avisar } from "./componentes.js";

let contextoGlobal = null;
let raiz = null;
let ultimaResposta = null;

const visao = { pagina: 1, status: "all", de: "", ate: "" };

const nomesStatusPedido = {
  paid: ["Pago", "verde"],
  confirmed: ["Confirmado", "azul"],
  payment_required: ["Aguardando pagamento", "laranja"],
  payment_in_process: ["Pagamento em análise", "laranja"],
  partially_paid: ["Pago em parte", "laranja"],
  cancelled: ["Cancelado", "vermelho"],
  invalid: ["Inválido", "vermelho"],
};

export function iniciarPainelVendas(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("carrinho", "Conecte a conta pra ver as vendas",
      "Os pedidos vêm da API oficial do Mercado Livre e só aparecem com a conta autorizada."));
    return;
  }
  montarEstrutura();
  carregar();
}

function montarEstrutura() {
  raiz.replaceChildren();

  raiz.append(el("div", { classe: "barra-ferramentas" },
    el("label", { classe: "campo", style: "width:210px" },
      el("span", {}, "Situação"),
      el("select", { aoMudar: (evento) => { visao.status = evento.target.value; visao.pagina = 1; carregar(); } },
        [["all", "Todas"], ["paid", "Pagos"], ["confirmed", "Confirmados"], ["payment_required", "Aguardando pagamento"], ["cancelled", "Cancelados"]].map(([valor, rotulo]) =>
          el("option", { value: valor, selected: visao.status === valor }, rotulo)))),
    el("label", { classe: "campo", style: "width:160px" },
      el("span", {}, "De"),
      el("input", { type: "date", value: visao.de, aoMudar: (evento) => { visao.de = evento.target.value; visao.pagina = 1; carregar(); } })),
    el("label", { classe: "campo", style: "width:160px" },
      el("span", {}, "Até"),
      el("input", { type: "date", value: visao.ate, aoMudar: (evento) => { visao.ate = evento.target.value; visao.pagina = 1; carregar(); } })),
    el("div", { classe: "espaco" }),
    el("button", { classe: "botao", aoClicar: carregar }, icone("sincronizar"), "Atualizar"),
    el("button", { classe: "botao", aoClicar: exportarCsv }, icone("baixar"), "Exportar CSV"),
  ));

  raiz.append(el("div", { id: "resumo-vendas" }), el("div", { id: "lista-vendas" }));
}

async function carregar() {
  const areaResumo = document.getElementById("resumo-vendas");
  const areaLista = document.getElementById("lista-vendas");
  if (!areaLista) return;
  areaResumo.replaceChildren();
  areaLista.replaceChildren(esqueletoLinhas(6, 58));

  try {
    ultimaResposta = await buscarPedidos({ pagina: visao.pagina, status: visao.status, de: visao.de, ate: visao.ate });
  } catch (motivo) {
    areaLista.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const { pedidos = [], resumo = {}, totalPaginas = 1, total = 0 } = ultimaResposta;

  areaResumo.replaceChildren(el("div", { classe: "grade-resumo", style: "margin-bottom:14px" },
    cartao("carrinho", "Pedidos", formatarNumero(resumo.totalPedidos ?? total), "no período filtrado"),
    cartao("moeda", "Recebido (página)", formatarMoeda(resumo.valorPagina), "soma dos pedidos exibidos"),
    cartao("confere", "Pagos", formatarNumero(resumo.pagos), "nesta página"),
    cartao("alerta", "Cancelados", formatarNumero(resumo.cancelados), "nesta página"),
  ));

  if (!pedidos.length) {
    areaLista.replaceChildren(estadoVazio("carrinho", "Nenhum pedido encontrado",
      visao.status !== "all" || visao.de || visao.ate ? "Nada bate com os filtros escolhidos." : "Quando as vendas acontecerem, elas aparecem aqui."));
    return;
  }

  areaLista.replaceChildren(
    el("div", { classe: "envoltorio-tabela" },
      el("table", { classe: "tabela" },
        el("thead", {}, el("tr", {},
          el("th", {}, "Pedido"),
          el("th", {}, "Produtos"),
          el("th", {}, "Comprador"),
          el("th", {}, "Situação"),
          el("th", { classe: "celula-numero" }, "Valor"),
          el("th", {}, "Pagamento"),
          el("th", {}, "Data"),
        )),
        el("tbody", {}, pedidos.map(montarLinhaPedido)),
      ),
    ),
    montarPaginacao({
      pagina: visao.pagina,
      totalPaginas,
      total,
      tamanhoPagina: 50,
      aoTrocarPagina: (pagina) => { visao.pagina = Math.max(1, Math.min(pagina, totalPaginas)); carregar(); },
    }),
  );
}

function cartao(nomeIcone, rotulo, valor, detalhe) {
  return el("div", { classe: "cartao-resumo" },
    el("span", { classe: "rotulo" }, icone(nomeIcone), rotulo),
    el("strong", {}, valor),
    el("small", {}, detalhe),
  );
}

function montarLinhaPedido(pedido) {
  const [nomeStatus, cor] = nomesStatusPedido[pedido.status] ?? [pedido.status ?? "—", ""];
  const nomesPagamento = { credit_card: "Cartão de crédito", debit_card: "Cartão de débito", account_money: "Dinheiro em conta", ticket: "Boleto", bank_transfer: "Pix / transferência", digital_currency: "Digital" };
  return el("tr", {},
    el("td", {}, el("span", { style: "display:inline-flex;align-items:center;gap:4px" }, el("code", {}, String(pedido.id)), botaoCopiar(String(pedido.id), "Copiar número"))),
    el("td", { style: "max-width:340px" }, (pedido.itens ?? []).map((item) =>
      el("div", { style: "font-size:.82rem;line-height:1.4" },
        `${item.quantidade}× ${item.titulo ?? item.id ?? "item"} `,
        el("span", { style: "color:var(--texto-fraco)" }, `(${formatarMoeda(item.precoUnitario)})`)))),
    el("td", {}, pedido.comprador?.apelido ?? "—"),
    el("td", {}, el("span", { classe: `selo ${cor}` }, nomeStatus)),
    el("td", { classe: "celula-numero" }, el("strong", {}, formatarMoeda(pedido.valorPago, pedido.moeda))),
    el("td", {}, nomesPagamento[pedido.formaPagamento] ?? pedido.formaPagamento ?? "—"),
    el("td", {}, formatarData(pedido.criadoEm, true)),
  );
}

function exportarCsv() {
  const pedidos = ultimaResposta?.pedidos ?? [];
  if (!pedidos.length) { avisar("Nada pra exportar nesta página.", "info"); return; }
  const linhas = [["Pedido", "Data", "Situação", "Comprador", "Valor pago", "Pagamento", "Itens"]];
  for (const pedido of pedidos) {
    linhas.push([
      pedido.id,
      formatarData(pedido.criadoEm, true),
      pedido.status ?? "",
      pedido.comprador?.apelido ?? "",
      pedido.valorPago ?? "",
      pedido.formaPagamento ?? "",
      `"${(pedido.itens ?? []).map((item) => `${item.quantidade}x ${item.titulo ?? ""}`).join(" | ").replace(/"/g, '""')}"`,
    ]);
  }
  baixarArquivo(`vendas-${new Date().toISOString().slice(0, 10)}.csv`, linhas.map((linha) => linha.join(";")).join("\n"));
  contextoGlobal.registrar("export.start", { metadata: { origem: "vendas" } });
}
