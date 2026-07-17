// ============================================================
// painel-perguntas.js — o SAC: perguntas de compradores vindas
// da API oficial, com resposta enviada direto daqui. O AlphaBot
// ajuda com um botão que rascunha a resposta.
// ============================================================

import { el, icone, formatarMoeda, tempoRelativo, formatarNumero, lerSalvo, salvar, gerarId } from "./utilitarios.js";
import { buscarPerguntas, responderPergunta, erroAmigavel } from "./api.js";
import { estadoVazio, esqueletoLinhas, montarPaginacao, avisar, fecharModal, abrirModal, abrirMenuSuspenso, confirmar } from "./componentes.js";
import { trocarPainel } from "./aplicativo.js";
import { publicarAviso, removerAviso } from "./central-avisos.js";

// Modelos de resposta rápida (respostas pré-definidas), salvos no navegador.
// Inspirado nas "respostas automáticas" do Shopping de Preços — a pessoa
// monta um texto uma vez e reaplica com um clique nas perguntas.
const MODELOS_PADRAO = [
  { id: "m-prazo", titulo: "Prazo de entrega", texto: "Olá! O prazo de entrega aparece na própria página do anúncio ao informar seu CEP. Assim que você comprar, despachamos rapidinho. Qualquer dúvida, estou à disposição! 😊" },
  { id: "m-estoque", titulo: "Tem em estoque", texto: "Olá! Sim, temos em estoque e pronta entrega. É só finalizar a compra que enviamos o quanto antes. Obrigado pelo contato!" },
  { id: "m-nota", titulo: "Emite nota fiscal", texto: "Olá! Sim, todos os nossos produtos acompanham nota fiscal. Pode comprar com tranquilidade!" },
];

function lerModelos() {
  return lerSalvo("marketsync_modelos_resposta", MODELOS_PADRAO);
}
function salvarModelos(modelos) {
  salvar("marketsync_modelos_resposta", modelos);
}

let contextoGlobal = null;
let raiz = null;

const visao = { pagina: 1, status: "UNANSWERED" };

export function iniciarPainelPerguntas(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  if (!contexto.conectado) {
    secao.append(estadoVazio("pergunta", "Conecte a conta pra atender os compradores",
      "As perguntas dos seus anúncios chegam aqui e podem ser respondidas sem sair do sistema."));
    return;
  }
  montarEstrutura();
  carregar();
}

// O aplicativo chama isso de tempos em tempos pra manter o contador
// do menu e o aviso do cabeçalho atualizados, mesmo fora da aba
export async function conferirPerguntasPendentes(contexto) {
  if (!contexto.conectado) return;
  try {
    const resposta = await buscarPerguntas({ status: "UNANSWERED", limite: 1 });
    const pendentes = Number(resposta?.total ?? 0);
    const bolinha = document.getElementById("contador-perguntas");
    if (bolinha) {
      bolinha.hidden = pendentes === 0;
      bolinha.textContent = pendentes > 99 ? "99+" : String(pendentes);
    }
    if (pendentes > 0) {
      publicarAviso({
        id: "perguntas-pendentes",
        importante: true,
        texto: `${formatarNumero(pendentes)} pergunta${pendentes === 1 ? "" : "s"} de comprador${pendentes === 1 ? "" : "es"} sem resposta`,
        detalhes: () => el("div", {},
          el("p", { style: "font-size:.9rem;margin-bottom:12px" },
            "Responder rápido melhora a conversão e a reputação. As perguntas estão na aba Perguntas · SAC, com envio direto por lá."),
          el("button", { classe: "botao primario", aoClicar: () => { fecharModal(); trocarPainel("perguntas"); } },
            icone("pergunta"), "Abrir as perguntas"),
        ),
      });
    } else {
      removerAviso("perguntas-pendentes");
    }
  } catch {
    // sem drama: tento de novo na próxima rodada
  }
}

function montarEstrutura() {
  raiz.replaceChildren();
  raiz.append(el("div", { classe: "barra-ferramentas" },
    el("div", { classe: "abas" },
      [["UNANSWERED", "Sem resposta"], ["ANSWERED", "Respondidas"], ["all", "Todas"]].map(([valor, rotulo]) =>
        el("button", { classe: visao.status === valor ? "ativa" : "", dataset: { status: valor }, aoClicar: (evento) => {
          visao.status = valor;
          visao.pagina = 1;
          raiz.querySelectorAll(".abas button").forEach((botao) => botao.classList.toggle("ativa", botao.dataset.status === valor));
          carregar();
        } }, rotulo)),
    ),
    el("div", { classe: "espaco" }),
    el("button", { classe: "botao", aoClicar: abrirGerenciadorModelos }, icone("lapis"), "Modelos de resposta"),
    el("button", { classe: "botao", aoClicar: carregar }, icone("sincronizar"), "Atualizar"),
  ));
  raiz.append(el("div", { id: "lista-perguntas" }));
}

async function carregar() {
  const area = document.getElementById("lista-perguntas");
  if (!area) return;
  area.replaceChildren(esqueletoLinhas(5, 90));

  let resposta;
  try {
    resposta = await buscarPerguntas({ pagina: visao.pagina, status: visao.status });
  } catch (motivo) {
    area.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
    return;
  }

  const { perguntas = [], totalPaginas = 1, total = 0 } = resposta;
  if (!perguntas.length) {
    area.replaceChildren(estadoVazio("pergunta",
      visao.status === "UNANSWERED" ? "Nenhuma pergunta esperando resposta" : "Nada por aqui",
      visao.status === "UNANSWERED" ? "Quando um comprador perguntar algo, aparece aqui na hora de responder." : ""));
    return;
  }

  area.replaceChildren(
    el("div", { style: "display:flex;flex-direction:column;gap:10px" }, perguntas.map(montarCartaoPergunta)),
    montarPaginacao({
      pagina: visao.pagina,
      totalPaginas,
      total,
      tamanhoPagina: 30,
      aoTrocarPagina: (pagina) => { visao.pagina = Math.max(1, Math.min(pagina, totalPaginas)); carregar(); },
    }),
  );
}

function montarCartaoPergunta(pergunta) {
  const cartao = el("div", { classe: "cartao cartao-pergunta" });

  cartao.append(el("div", { classe: "topo-pergunta" },
    pergunta.anuncio?.foto
      ? el("img", { src: pergunta.anuncio.foto, alt: "", classe: "foto-pergunta" })
      : el("div", { classe: "miniatura-vazia" }, icone("caixa")),
    el("div", { style: "flex:1;min-width:0" },
      el("div", { style: "font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" },
        pergunta.anuncio?.titulo ?? pergunta.anuncio?.id ?? "Anúncio"),
      el("div", { style: "font-size:.74rem;color:var(--texto-fraco)" },
        `${pergunta.anuncio?.id ?? ""}${pergunta.anuncio?.preco ? ` · ${formatarMoeda(pergunta.anuncio.preco)}` : ""} · ${tempoRelativo(pergunta.criadaEm)}`),
    ),
    pergunta.anuncio?.link ? el("a", { classe: "botao-icone", href: pergunta.anuncio.link, target: "_blank", rel: "noreferrer", title: "Abrir anúncio" }, icone("externo")) : null,
  ));

  cartao.append(el("p", { classe: "texto-pergunta" }, icone("pergunta"), el("span", {}, pergunta.texto)));

  if (pergunta.resposta) {
    cartao.append(el("div", { classe: "resposta-dada" },
      el("strong", {}, "Sua resposta", el("small", { style: "font-weight:400;color:var(--texto-fraco)" }, ` · ${tempoRelativo(pergunta.resposta.em)}`)),
      el("p", {}, pergunta.resposta.texto),
    ));
    return cartao;
  }

  // Pergunta aberta: campo de resposta + atalho pro AlphaBot rascunhar
  const campoResposta = el("textarea", { rows: 2, placeholder: "Escreva a resposta pro comprador…", classe: "entrada" });

  // Botão que abre a lista de modelos e joga o texto escolhido no campo
  const botaoModelos = el("button", { classe: "botao pequeno", title: "Usar um modelo de resposta", aoClicar: (evento) => {
    const modelos = lerModelos();
    if (!modelos.length) { avisar("Você ainda não tem modelos. Crie em “Modelos de resposta”.", "info"); return; }
    abrirMenuSuspenso(evento.currentTarget, modelos.map((modelo) => ({
      icone: "conversa", rotulo: modelo.titulo,
      aoClicar: () => { campoResposta.value = modelo.texto; campoResposta.focus(); },
    })));
  } }, icone("mais"), "Modelo");
  const botaoEnviar = el("button", { classe: "botao primario pequeno", aoClicar: async () => {
    const texto = campoResposta.value.trim();
    if (texto.length < 2) { avisar("Escreva a resposta antes de enviar.", "info"); return; }
    botaoEnviar.disabled = true;
    try {
      const csrf = await contextoGlobal.garantirCsrf();
      await responderPergunta(csrf, pergunta.id, texto);
      avisar("Resposta enviada pro comprador.", "sucesso");
      contextoGlobal.registrar("question.answer", { targetType: "question", targetId: String(pergunta.id) });
      carregar();
      conferirPerguntasPendentes(contextoGlobal);
    } catch (motivo) {
      avisar(erroAmigavel(motivo), "perigo");
      botaoEnviar.disabled = false;
    }
  } }, icone("enviar"), "Responder");

  cartao.append(el("div", { classe: "acoes-pergunta" },
    campoResposta,
    el("div", { style: "display:flex;flex-direction:column;gap:6px" },
      botaoEnviar,
      botaoModelos,
      el("button", { classe: "botao pequeno", title: "O AlphaBot escreve um rascunho e você revisa antes de enviar", aoClicar: () => {
        // Mando a pergunta pro assistente já com contexto; a resposta volta
        // pra pessoa colar aqui depois de revisar
        salvarRascunhoPendente(pergunta);
        trocarPainel("assistente");
      } }, icone("conversa"), "Rascunhar com IA"),
    ),
  ));

  return cartao;
}

// ----- Gerenciador de modelos de resposta -----

function abrirGerenciadorModelos() {
  const area = el("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const redesenhar = () => {
    const modelos = lerModelos();
    area.replaceChildren();
    if (!modelos.length) {
      area.append(estadoVazio("conversa", "Nenhum modelo ainda", "Crie respostas prontas para usar com um clique."));
    }
    for (const modelo of modelos) {
      area.append(el("div", { classe: "cartao", style: "display:flex;gap:10px;align-items:flex-start" },
        el("div", { style: "flex:1;min-width:0" },
          el("strong", { style: "font-size:.88rem" }, modelo.titulo),
          el("p", { style: "font-size:.82rem;color:var(--texto-suave);margin-top:2px" }, modelo.texto)),
        el("div", { style: "display:flex;gap:2px" },
          el("button", { classe: "botao-icone", title: "Editar", aoClicar: () => editarModelo(modelo, redesenhar) }, icone("lapis")),
          el("button", { classe: "botao-icone", title: "Excluir", aoClicar: async () => {
            if (!(await confirmar({ titulo: "Excluir modelo", mensagem: `Remover o modelo “${modelo.titulo}”?`, textoConfirmar: "Excluir", perigoso: true }))) return;
            salvarModelos(lerModelos().filter((m) => m.id !== modelo.id));
            redesenhar();
          } }, icone("lixeira"))),
      ));
    }
  };
  redesenhar();

  abrirModal({
    chapeu: "Perguntas · SAC", titulo: "Modelos de resposta rápida", tamanho: "largo",
    corpo: el("div", {}, area),
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Fechar"),
      el("button", { classe: "botao primario", aoClicar: () => editarModelo(null, redesenhar) }, icone("mais"), "Novo modelo"),
    ],
  });
}

function editarModelo(existente, aoSalvar) {
  const titulo = el("input", { classe: "entrada", value: existente?.titulo ?? "", placeholder: "Ex.: Prazo de entrega" });
  const texto = el("textarea", { classe: "entrada", rows: 4, value: existente?.texto ?? "", placeholder: "Texto que será inserido na resposta" });
  abrirModal({
    chapeu: existente ? "Editar modelo" : "Novo modelo", titulo: "Modelo de resposta",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:10px" },
      el("label", { classe: "campo" }, el("span", {}, "Título"), titulo),
      el("label", { classe: "campo" }, el("span", {}, "Texto da resposta"), texto)),
    rodape: [
      el("button", { classe: "botao", aoClicar: () => { fecharModal(); abrirGerenciadorModelos(); } }, "Voltar"),
      el("button", { classe: "botao primario", aoClicar: () => {
        if (!titulo.value.trim() || !texto.value.trim()) { avisar("Preencha título e texto.", "info"); return; }
        const modelos = lerModelos();
        if (existente) {
          const alvo = modelos.find((m) => m.id === existente.id);
          if (alvo) { alvo.titulo = titulo.value.trim(); alvo.texto = texto.value.trim(); }
        } else {
          modelos.push({ id: gerarId(), titulo: titulo.value.trim(), texto: texto.value.trim() });
        }
        salvarModelos(modelos);
        fecharModal();
        abrirGerenciadorModelos();
      } }, "Salvar modelo"),
    ],
  });
}

// Deixa a pergunta pronta pro painel do assistente sugerir como primeiro texto
function salvarRascunhoPendente(pergunta) {
  try {
    sessionStorage.setItem("marketsync_rascunho_pergunta", JSON.stringify({
      pergunta: pergunta.texto,
      anuncio: pergunta.anuncio?.titulo ?? pergunta.anuncio?.id ?? "",
    }));
  } catch { /* sem espaço, segue sem rascunho */ }
}
