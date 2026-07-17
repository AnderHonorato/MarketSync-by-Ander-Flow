// ============================================================
// painel-chat.js — chat interno da equipe, no estilo WhatsApp:
// lista de conversas à esquerda (fixar, arquivar, apagar),
// mensagens em balões à direita, apagar mensagem, foto de
// perfil visível e contador de não lidas.
//
// Quem fala com quem é o backend que decide (Owner ↔ todos;
// Admin e usuários entre si na mesma empresa).
// ============================================================

import { el, icone, tempoRelativo } from "./utilitarios.js";
import {
  chatContatos, chatConversas, chatMensagens, chatEnviar, chatApagarMensagem,
  chatPreferencias, chatApagarConversa, erroAmigavel,
} from "./api.js";
import { avisar, confirmar, estadoVazio, esqueletoLinhas, abrirMenuSuspenso } from "./componentes.js";
import { usuario as usuarioLogado } from "./permissoes.js";

let contextoGlobal = null;
let raiz = null;

let conversas = [];
let contatoAberto = null;   // contato da conversa aberta
let mensagens = [];
let vendoArquivadas = false;
let cronometroChat = null;  // atualização automática enquanto a aba está aberta

let areaConversas, areaThread, listaMensagens, caixaTexto, botaoEnviar;

const nomesPapel = { OWNER: "Fundador", ADMIN: "Administrador", USER: "Usuário" };

export function iniciarPainelChat(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;
  montarEstrutura();
  recarregarConversas();

  // Enquanto a aba do chat está visível, busco novidades a cada 4 s;
  // ao sair dela, o cronômetro para (o contador do menu segue por fora)
  contexto.eventos.addEventListener("painel-mostrado", (evento) => {
    if (evento.detail === "chat") ligarAtualizacao();
    else desligarAtualizacao();
  });
  ligarAtualizacao();
}

function ligarAtualizacao() {
  if (cronometroChat) return;
  cronometroChat = setInterval(() => {
    recarregarConversas(true);
    if (contatoAberto) abrirConversa(contatoAberto, true);
  }, 4000);
}

function desligarAtualizacao() {
  if (cronometroChat) { clearInterval(cronometroChat); cronometroChat = null; }
}

// ----- Estrutura -----

function montarEstrutura() {
  areaConversas = el("div", { classe: "chat-lista" });
  listaMensagens = el("div", { classe: "chat-mensagens" });

  caixaTexto = el("textarea", {
    rows: 1, placeholder: "Escreva uma mensagem…",
    aoDigitar: () => {
      caixaTexto.style.height = "auto";
      caixaTexto.style.height = `${Math.min(caixaTexto.scrollHeight, 120)}px`;
      botaoEnviar.disabled = !caixaTexto.value.trim();
    },
    aoTeclar: (evento) => {
      if (evento.key === "Enter" && !evento.shiftKey) { evento.preventDefault(); enviarMensagem(); }
    },
  });
  botaoEnviar = el("button", { classe: "botao-enviar", disabled: true, "aria-label": "Enviar", aoClicar: enviarMensagem }, icone("enviar"));

  areaThread = el("div", { classe: "chat-thread" },
    el("div", { classe: "chat-thread-vazia" },
      estadoVazio("conversa", "Escolha uma conversa", "Ou comece uma nova pelo botão “Nova conversa”.")),
  );

  const lateral = el("aside", { classe: "chat-lateral" },
    el("div", { classe: "chat-topo-lateral" },
      el("button", { classe: "botao primario", style: "flex:1", aoClicar: abrirNovaConversa }, icone("mais"), "Nova conversa"),
      el("button", { classe: "botao-icone", id: "chat-ver-arquivadas", title: "Ver arquivadas", aoClicar: () => {
        vendoArquivadas = !vendoArquivadas;
        document.getElementById("chat-ver-arquivadas").classList.toggle("ativa-arquivo", vendoArquivadas);
        desenharConversas();
      } }, icone("arquivo")),
    ),
    areaConversas,
  );

  raiz.append(el("div", { classe: "chat-envoltorio" }, lateral, areaThread));
}

// ----- Avatar (foto ou iniciais) -----

export function montarAvatar(pessoa, tamanho = 40) {
  if (pessoa?.fotoPerfil) {
    return el("img", { classe: "chat-avatar", src: pessoa.fotoPerfil, alt: pessoa.nome ?? "", style: `width:${tamanho}px;height:${tamanho}px` });
  }
  const iniciais = (pessoa?.nome ?? pessoa?.usuario ?? "?").trim().split(/\s+/).map((parte) => parte[0]).slice(0, 2).join("").toUpperCase();
  return el("div", { classe: "chat-avatar chat-avatar-iniciais", style: `width:${tamanho}px;height:${tamanho}px;font-size:${Math.round(tamanho * 0.38)}px` }, iniciais);
}

// ----- Lista de conversas -----

async function recarregarConversas(silencioso = false) {
  if (!silencioso) areaConversas.replaceChildren(esqueletoLinhas(4, 56));
  try {
    conversas = (await chatConversas())?.conversas ?? [];
    desenharConversas();
  } catch (motivo) {
    if (!silencioso) areaConversas.replaceChildren(el("div", { classe: "aviso perigo", style: "margin:10px" }, icone("alerta"), erroAmigavel(motivo)));
  }
}

function desenharConversas() {
  const visiveis = conversas.filter((conversa) => Boolean(conversa.arquivada) === vendoArquivadas);
  areaConversas.replaceChildren();
  if (!visiveis.length) {
    areaConversas.append(el("p", { style: "font-size:.8rem;color:var(--texto-fraco);text-align:center;padding:18px 10px" },
      vendoArquivadas ? "Nenhuma conversa arquivada." : "Nenhuma conversa ainda. Comece uma!"));
    return;
  }
  for (const conversa of visiveis) {
    const { contato } = conversa;
    areaConversas.append(el("button", {
      classe: `chat-item ${contatoAberto?.id === contato.id ? "ativa" : ""}`,
      aoClicar: () => abrirConversa(contato),
    },
      montarAvatar(contato, 42),
      el("div", { classe: "chat-item-meio" },
        el("div", { classe: "chat-item-topo" },
          el("strong", {}, contato.nome),
          conversa.fixada ? el("span", { classe: "chat-pino", title: "Fixada" }, "📌") : null,
          el("time", {}, tempoRelativo(conversa.ultimaMensagem.em))),
        el("div", { classe: "chat-item-baixo" },
          el("span", { classe: "chat-previa" },
            conversa.ultimaMensagem.minha ? "Você: " : "",
            conversa.ultimaMensagem.texto ?? "mensagem apagada"),
          conversa.naoLidas ? el("b", { classe: "bolinha-contador" }, String(conversa.naoLidas)) : null),
      ),
      el("span", { classe: "chat-item-menu botao-icone", aoClicar: (evento) => {
        evento.stopPropagation();
        abrirMenuConversa(evento.currentTarget, conversa);
      } }, icone("engrenagem")),
    ));
  }
}

function abrirMenuConversa(ancora, conversa) {
  const { contato } = conversa;
  const aplicarPreferencia = async (prefs) => {
    try {
      await chatPreferencias(await contextoGlobal.garantirCsrf(), contato.id, prefs);
      recarregarConversas(true);
    } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
  };
  abrirMenuSuspenso(ancora, [
    { icone: "mais", rotulo: conversa.fixada ? "Desafixar" : "Fixar no topo", aoClicar: () => aplicarPreferencia({ fixada: !conversa.fixada }) },
    { icone: "arquivo", rotulo: conversa.arquivada ? "Desarquivar" : "Arquivar", aoClicar: () => aplicarPreferencia({ arquivada: !conversa.arquivada }) },
    "separador",
    { icone: "lixeira", rotulo: "Apagar conversa (só pra mim)", perigoso: true, aoClicar: async () => {
      if (!(await confirmar({ titulo: "Apagar conversa", mensagem: `O histórico com ${contato.nome} some SÓ pra você — o outro lado continua vendo as mensagens dele. Confirmar?`, textoConfirmar: "Apagar", perigoso: true }))) return;
      try {
        await chatApagarConversa(await contextoGlobal.garantirCsrf(), contato.id);
        if (contatoAberto?.id === contato.id) { contatoAberto = null; mensagens = []; desenharThread(); }
        recarregarConversas();
      } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
    } },
  ]);
}

// Nova conversa: lista de todos os contatos permitidos
async function abrirNovaConversa() {
  let contatos = [];
  try { contatos = (await chatContatos())?.contatos ?? []; }
  catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); return; }
  if (!contatos.length) { avisar("Nenhum contato disponível ainda. Crie usuários em Opções → Gerenciar usuários.", "info"); return; }
  areaConversas.replaceChildren(
    el("div", { style: "padding:8px 10px;font-size:.76rem;color:var(--texto-suave);display:flex;justify-content:space-between;align-items:center" },
      el("strong", {}, "Escolha um contato"),
      el("button", { classe: "botao-texto", aoClicar: () => desenharConversas() }, "voltar")),
    contatos.map((contato) => el("button", { classe: "chat-item", aoClicar: () => abrirConversa(contato) },
      montarAvatar(contato, 42),
      el("div", { classe: "chat-item-meio" },
        el("div", { classe: "chat-item-topo" }, el("strong", {}, contato.nome)),
        el("div", { classe: "chat-item-baixo" }, el("span", { classe: "chat-previa" }, nomesPapel[contato.papel] ?? contato.papel))),
    )),
  );
}

// ----- Conversa aberta -----

async function abrirConversa(contato, silencioso = false) {
  const trocouDeContato = contatoAberto?.id !== contato.id;
  contatoAberto = contato;
  if (!silencioso && trocouDeContato) {
    listaMensagens.replaceChildren(esqueletoLinhas(4, 40));
    desenharThread();
  }
  try {
    const resposta = await chatMensagens(contato.id);
    // Só redesenho se algo mudou, pra rolagem não pular à toa
    const novaChave = JSON.stringify((resposta.mensagens ?? []).map((mensagem) => `${mensagem.id}:${mensagem.apagada}:${mensagem.lida}`));
    const chaveAtual = JSON.stringify(mensagens.map((mensagem) => `${mensagem.id}:${mensagem.apagada}:${mensagem.lida}`));
    if (trocouDeContato || novaChave !== chaveAtual) {
      mensagens = resposta.mensagens ?? [];
      contatoAberto = resposta.contato;
      desenharThread();
    }
    if (trocouDeContato) recarregarConversas(true);
  } catch (motivo) {
    if (!silencioso) avisar(erroAmigavel(motivo), "perigo");
  }
}

function desenharThread() {
  if (!contatoAberto) {
    areaThread.replaceChildren(el("div", { classe: "chat-thread-vazia" },
      estadoVazio("conversa", "Escolha uma conversa", "Ou comece uma nova pelo botão “Nova conversa”.")));
    return;
  }

  const cabecalho = el("div", { classe: "chat-cabecalho-thread" },
    montarAvatar(contatoAberto, 38),
    el("div", {},
      el("strong", {}, contatoAberto.nome),
      el("div", { style: "font-size:.72rem;color:var(--texto-suave)" }, nomesPapel[contatoAberto.papel] ?? contatoAberto.papel)),
  );

  listaMensagens.replaceChildren();
  const eu = usuarioLogado();
  let ultimaData = "";
  for (const mensagem of mensagens) {
    // Separador de dia, igual ao WhatsApp
    const dia = new Date(mensagem.criadaEm).toLocaleDateString("pt-BR");
    if (dia !== ultimaData) {
      ultimaData = dia;
      listaMensagens.append(el("div", { classe: "chat-separador-dia" }, el("span", {}, dia)));
    }
    const minha = mensagem.deId === eu?.id;
    const balao = el("div", { classe: `chat-balao ${minha ? "minha" : ""} ${mensagem.apagada ? "apagada" : ""}` },
      el("div", { classe: "chat-balao-texto" }, mensagem.apagada ? "🚫 mensagem apagada" : mensagem.texto),
      el("div", { classe: "chat-balao-rodape" },
        new Date(mensagem.criadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        minha && !mensagem.apagada ? el("span", { title: mensagem.lida ? "Lida" : "Enviada", classe: mensagem.lida ? "chat-lida" : "" }, mensagem.lida ? "✓✓" : "✓") : null),
      minha && !mensagem.apagada
        ? el("button", { classe: "chat-apagar-mensagem", title: "Apagar mensagem", aoClicar: async () => {
            if (!(await confirmar({ titulo: "Apagar mensagem", mensagem: "A mensagem vira “mensagem apagada” pros dois lados. Confirmar?", textoConfirmar: "Apagar", perigoso: true }))) return;
            try {
              await chatApagarMensagem(await contextoGlobal.garantirCsrf(), mensagem.id);
              abrirConversa(contatoAberto, true);
            } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
          } }, icone("lixeira"))
        : null,
    );
    listaMensagens.append(balao);
  }
  if (!mensagens.length) {
    listaMensagens.append(el("p", { style: "text-align:center;font-size:.8rem;color:var(--texto-fraco);margin:auto" },
      `Comece a conversa com ${contatoAberto.nome}. As mensagens ficam guardadas no servidor local.`));
  }

  const compositor = el("div", { classe: "chat-compositor" },
    caixaTexto,
    botaoEnviar,
  );

  areaThread.replaceChildren(cabecalho, listaMensagens, compositor);
  listaMensagens.scrollTop = listaMensagens.scrollHeight;
}

async function enviarMensagem() {
  const texto = caixaTexto.value.trim();
  if (!texto || !contatoAberto) return;
  botaoEnviar.disabled = true;
  try {
    const csrf = await contextoGlobal.garantirCsrf();
    const { mensagem } = await chatEnviar(csrf, contatoAberto.id, texto);
    mensagens.push(mensagem);
    caixaTexto.value = "";
    caixaTexto.style.height = "auto";
    desenharThread();
    caixaTexto.focus();
    recarregarConversas(true);
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
  } finally {
    botaoEnviar.disabled = !caixaTexto.value.trim();
  }
}
