// ============================================================
// painel-inicio.js — visão geral: boas-vindas, números da conta,
// atalhos pras outras abas e últimos movimentos do histórico.
// ============================================================

import { el, icone, formatarMoeda, formatarNumero, tempoRelativo } from "./utilitarios.js";
import { obterHistorico, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas } from "./componentes.js";
import { carregarTodosAnuncios, resumirAnuncios, limparCacheAnuncios } from "./dados-anuncios.js";
import { trocarPainel } from "./aplicativo.js";

// Tradução dos eventos do histórico pra lista de atividade recente
const nomesEventos = {
  "session.start": "Sessão iniciada",
  "oauth.connect": "Conta conectada",
  "oauth.disconnect": "Conta desconectada",
  "sync.start": "Sincronização iniciada",
  "sync.completed": "Sincronização concluída",
  "sync.failed": "Falha na sincronização",
  "bulk.execute": "Alteração em massa executada",
  "unofficial.start": "Leitura pública iniciada",
  "unofficial.complete": "Leitura pública concluída",
  "export.start": "Exportação solicitada",
  "ui.open": "Página aberta",
};

export function iniciarPainelInicio(contexto, secao) {
  desenhar(contexto, secao);

  // Depois de sincronizar, os números mudam — recarrego tudo
  contexto.eventos.addEventListener("sincronizacao-concluida", () => {
    limparCacheAnuncios();
    desenhar(contexto, secao);
  });
}

function desenhar(contexto, secao) {
  secao.replaceChildren();

  // Cartão de boas-vindas com o nome da conta (se tiver)
  const nomeConta = contexto.conta?.nickname;
  secao.append(el("div", { classe: "cartao-boas-vindas" },
    el("div", {},
      el("h2", {}, nomeConta ? `Olá, ${nomeConta}!` : "Bem-vindo ao MarketSync"),
      el("p", {}, contexto.conectado
        ? "Sua conta está conectada. Os números abaixo vêm da última sincronização."
        : "Você está no modo sem conta. Dá pra usar as consultas públicas e o assistente; conecte a conta pra ver seus anúncios."),
    ),
    el("div", { classe: "acoes" },
      el("button", { classe: "botao", aoClicar: () => trocarPainel("publico") }, icone("radar"), "Consultas públicas"),
      el("button", { classe: "botao primario", aoClicar: () => trocarPainel(contexto.conectado ? "anuncios" : "assistente") },
        icone(contexto.conectado ? "etiqueta" : "conversa"),
        contexto.conectado ? "Ver anúncios" : "Falar com o AlphaBot IA",),
    ),
  ));

  // Números gerais (só com conta conectada)
  const areaResumo = el("div", { classe: "secao-inicio" },
    el("h2", {}, icone("grafico"), "Resumo da conta"),
  );
  secao.append(areaResumo);

  if (contexto.conectado) {
    const carregando = esqueletoLinhas(1, 90);
    areaResumo.append(carregando);
    carregarTodosAnuncios()
      .then((itens) => {
        carregando.remove();
        areaResumo.append(montarResumo(resumirAnuncios(itens)));
      })
      .catch((motivo) => {
        carregando.remove();
        areaResumo.append(el("div", { classe: "aviso atencao" }, icone("alerta"), erroAmigavel(motivo)));
      });
  } else {
    areaResumo.append(estadoVazio("chave", "Conecte a conta pra ver o resumo",
      "Os números de anúncios, estoque e promoções aparecem aqui depois da primeira sincronização."));
  }

  // Atalhos + atividade recente lado a lado
  const grade = el("div", { classe: "grade-inicio" });
  secao.append(grade);

  grade.append(el("div", { classe: "secao-inicio" },
    el("h2", {}, icone("mais"), "Atalhos"),
    el("div", { classe: "lista-atalhos" },
      montarAtalho("moeda", "Preços", "Acompanhe valores, descontos e o que mudou entre sincronizações.", "precos"),
      montarAtalho("trofeu", "Concorrentes", "Veja a disputa de catálogo: quem está ganhando e o preço pra ganhar.", "concorrentes"),
      montarAtalho("radar", "Consultas públicas", "Leia uma loja por URL ou busque ofertas pelo nome do produto.", "publico"),
      montarAtalho("conversa", "Assistente", "Peça análises, textos de anúncio e tire dúvidas com o AlphaBot IA.", "assistente"),
    ),
  ));

  const areaAtividade = el("div", { classe: "secao-inicio" },
    el("h2", {}, icone("historico"), "Atividade recente"),
  );
  grade.append(areaAtividade);

  const esqueleto = esqueletoLinhas(4, 30);
  areaAtividade.append(esqueleto);
  obterHistorico()
    .then((historico) => {
      esqueleto.remove();
      const eventos = (historico?.events ?? []).slice(0, 8);
      if (!eventos.length) {
        areaAtividade.append(estadoVazio("historico", "Nada registrado ainda"));
        return;
      }
      areaAtividade.append(el("div", { classe: "cartao atividade-recente" },
        eventos.map((evento) => el("article", {},
          el("span", {}, nomesEventos[evento.action] ?? evento.action),
          el("time", {}, tempoRelativo(evento.createdAt)),
        )),
      ));
    })
    .catch(() => {
      esqueleto.remove();
      areaAtividade.append(estadoVazio("historico", "Histórico indisponível agora"));
    });
}

function montarAtalho(nomeIcone, titulo, texto, painel) {
  return el("button", { classe: "atalho", aoClicar: () => trocarPainel(painel) },
    icone(nomeIcone),
    el("div", {}, el("strong", {}, titulo), el("small", {}, texto)),
  );
}

function montarResumo(resumo) {
  const cartoes = [
    ["etiqueta", "Anúncios", formatarNumero(resumo.total), `${formatarNumero(resumo.ativos)} ativos · ${formatarNumero(resumo.pausados)} pausados`],
    ["caixa", "Estoque total", formatarNumero(resumo.estoqueTotal), `${formatarNumero(resumo.semEstoque)} anúncios sem estoque`],
    ["grafico", "Vendas acumuladas", formatarNumero(resumo.vendidosTotal), "soma dos anúncios sincronizados"],
    ["moeda", "Valor em estoque", formatarMoeda(resumo.valorEstoque), "preço × estoque dos ativos"],
    ["estrela", "Em promoção", formatarNumero(resumo.emPromocao), `${formatarNumero(resumo.comPix)} com campanha Pix`],
    ["trofeu", "No catálogo", formatarNumero(resumo.noCatalogo), "participam de página de catálogo"],
    ["caminhao", "Frete grátis", formatarNumero(resumo.freteGratis), "anúncios com frete grátis"],
  ];
  return el("div", { classe: "grade-resumo" },
    cartoes.map(([nomeIcone, rotulo, valor, detalhe]) => el("div", { classe: "cartao-resumo" },
      el("span", { classe: "rotulo" }, icone(nomeIcone), rotulo),
      el("strong", {}, valor),
      el("small", {}, detalhe),
    )),
  );
}
