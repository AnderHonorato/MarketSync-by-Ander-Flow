// ============================================================
// painel-tendencias.js — os termos mais buscados no Mercado
// Livre agora (API oficial /trends), com atalho pra pesquisar
// cada termo na consulta pública e pra pedir ideias ao AlphaBot.
// ============================================================

import { el, icone } from "./utilitarios.js";
import { buscarTendencias, buscarReputacao, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas, botaoCopiar } from "./componentes.js";
import { trocarPainel } from "./aplicativo.js";

let raiz = null;

export function iniciarPainelTendencias(contexto, secao) {
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("tendencia", "Conecte a conta pra ver as tendências",
      "A lista de buscas em alta vem da API oficial e precisa de uma conta autorizada."));
    return;
  }
  desenhar();
}

async function desenhar() {
  raiz.replaceChildren();

  // Reputação do vendedor em cima (aproveito a aba pra dar visão de saúde da conta)
  const areaReputacao = el("div", { id: "area-reputacao", style: "margin-bottom:16px" });
  const areaTendencias = el("div", { id: "area-tendencias" });
  raiz.append(areaReputacao, areaTendencias);

  areaReputacao.append(esqueletoLinhas(1, 80));
  buscarReputacao()
    .then((reputacao) => { areaReputacao.replaceChildren(montarReputacao(reputacao)); })
    .catch(() => areaReputacao.replaceChildren());

  areaTendencias.append(esqueletoLinhas(6, 44));
  let dados;
  try {
    dados = await buscarTendencias();
  } catch (motivo) {
    areaTendencias.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const tendencias = dados?.tendencias ?? [];
  if (!tendencias.length) {
    areaTendencias.replaceChildren(estadoVazio("tendencia", "Sem tendências agora", "A API não devolveu termos em alta neste momento."));
    return;
  }

  areaTendencias.replaceChildren(
    el("div", { classe: "cabeca-painel" },
      el("div", { classe: "lado-esquerdo" },
        el("p", { style: "font-size:.85rem;color:var(--texto-suave)" },
          `Top ${tendencias.length} buscas em alta no ${dados.site ?? "MLB"}. Use a lupa pra observar as ofertas de cada termo na consulta pública.`)),
    ),
    el("div", { classe: "grade-tendencias" },
      tendencias.map((linha) => el("div", { classe: "cartao-tendencia" },
        el("span", { classe: "posicao-tendencia" }, `${linha.posicao}º`),
        el("strong", {}, linha.termo),
        el("div", { classe: "acoes-tendencia" },
          botaoCopiar(linha.termo, "Copiar termo"),
          el("button", { classe: "botao-icone", title: "Observar ofertas desse termo na consulta pública", aoClicar: () => {
            // Deixo o termo pronto pro painel público usar como busca de produto
            sessionStorage.setItem("marketsync_termo_tendencia", linha.termo);
            trocarPainel("publico");
          } }, icone("lupa")),
          linha.link ? el("a", { classe: "botao-icone", href: linha.link, target: "_blank", rel: "noreferrer", title: "Abrir busca no Mercado Livre" }, icone("externo")) : null,
        ),
      )),
    ),
  );
}

function montarReputacao(reputacao) {
  if (!reputacao) return el("div");
  const nomesNivel = {
    "5_green": ["Verde — excelente", "verde"],
    "4_light_green": ["Verde-claro — muito boa", "verde"],
    "3_yellow": ["Amarela — atenção", "laranja"],
    "2_orange": ["Laranja — em risco", "laranja"],
    "1_red": ["Vermelha — crítica", "vermelho"],
  };
  const [nomeNivel, corNivel] = nomesNivel[reputacao.nivel] ?? [reputacao.nivel ?? "Sem nível ainda", ""];
  const medalhas = { platinum: "MercadoLíder Platinum", gold: "MercadoLíder Gold", silver: "MercadoLíder" };
  return el("div", { classe: "cartao", style: "display:flex;align-items:center;gap:18px;flex-wrap:wrap" },
    el("div", {},
      el("h3", {}, `Reputação de ${reputacao.apelido ?? "vendedor"}`),
      el("div", { style: "display:flex;gap:6px;margin-top:6px;flex-wrap:wrap" },
        el("span", { classe: `selo ${corNivel}` }, nomeNivel),
        reputacao.medalha ? el("span", { classe: "selo azul" }, icone("trofeu"), medalhas[reputacao.medalha] ?? reputacao.medalha) : null,
      ),
    ),
    el("div", { classe: "numeros-reputacao" },
      el("span", {}, el("b", {}, String(reputacao.transacoes?.concluidas ?? 0)), " vendas concluídas"),
      el("span", {}, el("b", {}, `${Math.round((reputacao.metricas?.reclamacoes ?? 0) * 100)}%`), " reclamações"),
      el("span", {}, el("b", {}, `${Math.round((reputacao.metricas?.atrasos ?? 0) * 100)}%`), " despachos com atraso"),
      el("span", {}, el("b", {}, `${Math.round((reputacao.metricas?.cancelamentos ?? 0) * 100)}%`), " cancelamentos"),
    ),
  );
}
