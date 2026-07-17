// ============================================================
// dados-anuncios.js — carrega a lista completa de anúncios da
// conta (paginando por baixo dos panos) e mantém um histórico
// local de preços pra aba Preços mostrar o que mudou.
// Os painéis Início, Preços e Concorrentes bebem daqui.
// ============================================================

import { buscarAnuncios } from "./api.js";
import { lerSalvo, salvar } from "./utilitarios.js";

let cacheCompleto = null;      // { itens, carregadoEm }
let promessaCarregando = null; // evita duas cargas ao mesmo tempo

// A API limita 200 por página, então vou juntando página por página.
// Com poucas centenas de anúncios isso resolve em 1–3 chamadas.
export async function carregarTodosAnuncios(forcar = false) {
  if (!forcar && cacheCompleto && Date.now() - cacheCompleto.carregadoEm < 60000) {
    return cacheCompleto.itens;
  }
  if (promessaCarregando) return promessaCarregando;

  promessaCarregando = (async () => {
    const itens = [];
    let pagina = 1;
    while (pagina <= 50) { // trava de segurança: 50 × 200 = 10 mil anúncios
      const resposta = await buscarAnuncios({ pagina, tamanhoPagina: 200, ordenacao: "created_desc" });
      itens.push(...(resposta.items ?? []));
      if (!resposta.hasNext) break;
      pagina += 1;
    }
    cacheCompleto = { itens, carregadoEm: Date.now() };
    registrarPrecos(itens);
    return itens;
  })();

  try {
    return await promessaCarregando;
  } finally {
    promessaCarregando = null;
  }
}

export function limparCacheAnuncios() {
  cacheCompleto = null;
}

// ----- Resumo pro painel Início -----

export function resumirAnuncios(itens) {
  const resumo = {
    total: itens.length,
    ativos: 0,
    pausados: 0,
    semEstoque: 0,
    estoqueTotal: 0,
    vendidosTotal: 0,
    emPromocao: 0,
    comPix: 0,
    noCatalogo: 0,
    freteGratis: 0,
    valorEstoque: 0, // preço × estoque de tudo que está ativo
  };
  for (const item of itens) {
    if (item.status === "active") resumo.ativos += 1;
    if (item.status === "paused") resumo.pausados += 1;
    if ((item.availableQuantity ?? 0) <= 0) resumo.semEstoque += 1;
    resumo.estoqueTotal += item.availableQuantity ?? 0;
    resumo.vendidosTotal += item.soldQuantity ?? 0;
    if (item.promotion?.status === "active") resumo.emPromocao += 1;
    if (item.promotion?.pix) resumo.comPix += 1;
    if (item.catalogListing) resumo.noCatalogo += 1;
    if (item.freeShipping) resumo.freteGratis += 1;
    if (item.status === "active" && item.price) {
      resumo.valorEstoque += item.price * Math.max(item.availableQuantity ?? 0, 0);
    }
  }
  return resumo;
}

// ----- Histórico local de preços -----
// Cada vez que a lista completa chega, guardo um retrato {id: preço}.
// Comparando o retrato atual com o anterior dá pra mostrar na aba
// Preços o que subiu, o que caiu e quando foi a última mudança.

const CHAVE_HISTORICO = "marketsync_historico_precos";
const LIMITE_RETRATOS = 30;

function registrarPrecos(itens) {
  const historico = lerSalvo(CHAVE_HISTORICO, []);
  const retrato = { em: new Date().toISOString(), precos: {} };
  for (const item of itens) {
    if (item.price != null) retrato.precos[item.id] = item.price;
  }

  const ultimo = historico[historico.length - 1];
  // Só guardo um retrato novo se algum preço mudou de verdade
  if (ultimo) {
    const mudou = Object.keys(retrato.precos).length !== Object.keys(ultimo.precos).length
      || Object.entries(retrato.precos).some(([id, preco]) => ultimo.precos[id] !== preco);
    if (!mudou) return;
  }

  historico.push(retrato);
  while (historico.length > LIMITE_RETRATOS) historico.shift();
  salvar(CHAVE_HISTORICO, historico);
}

// Devolve, por anúncio, o preço anterior e a data em que mudou
export function variacoesDePreco() {
  const historico = lerSalvo(CHAVE_HISTORICO, []);
  if (historico.length < 2) return {};
  const atual = historico[historico.length - 1];
  const variacoes = {};

  for (const [id, precoAtual] of Object.entries(atual.precos)) {
    // ando pra trás procurando o último retrato com preço diferente
    for (let i = historico.length - 2; i >= 0; i -= 1) {
      const antigo = historico[i].precos[id];
      if (antigo == null) break;
      if (antigo !== precoAtual) {
        variacoes[id] = { anterior: antigo, atual: precoAtual, em: historico[i + 1].em };
        break;
      }
    }
  }
  return variacoes;
}

export function totalRetratosPreco() {
  return lerSalvo(CHAVE_HISTORICO, []).length;
}
