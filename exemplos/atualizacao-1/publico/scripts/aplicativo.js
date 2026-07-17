// ============================================================
// aplicativo.js — ponto de entrada. Cuida da sessão, do tema,
// da navegação entre painéis e dos indicadores de conexão.
// Cada painel mora no seu próprio arquivo e é iniciado daqui.
// ============================================================

import { el, icone, lerSalvo, salvar, formatarNumero, copiarTexto } from "./utilitarios.js";
import {
  obterSessao, obterConfiguracao, obterConta, enderecoConexaoOficial,
  obterLinkConexao, encerrarSessao, verificarSaude, obterSincronizacao,
  iniciarSincronizacao, cancelarSincronizacao, registrarAtividade,
  baterCoracao, resetarTudo, erroAmigavel,
  sairDaConta, trocarSenha, excluirPropriaConta,
  chatNaoLidas, salvarFotoPerfil,
} from "./api.js";
import { avisar, abrirModal, fecharModal, confirmar, abrirMenuSuspenso } from "./componentes.js";
import { iniciarCentralAvisos, semearAvisosPadrao, publicarAviso } from "./central-avisos.js";
import { iniciarAutenticacao } from "./autenticacao.js";
import { definirUsuario, aplicarGateNoMenu, podeAcessar, telaBloqueada, usuario as usuarioLogado, areas as areasSistema, ehGestor } from "./permissoes.js";
import { abrirGestaoUsuarios } from "./painel-usuarios.js";
import { iniciarPainelInicio } from "./painel-inicio.js";
import { iniciarPainelAnuncios } from "./painel-anuncios.js";
import { iniciarPainelPrecos } from "./painel-precos.js";
import { iniciarPainelConcorrentes } from "./painel-concorrentes.js";
import { iniciarPainelPublico } from "./painel-publico.js";
import { iniciarPainelAssistente } from "./painel-assistente.js";
import { iniciarPainelHistorico } from "./painel-historico.js";
import { iniciarPainelVendas } from "./painel-vendas.js";
import { iniciarPainelPerguntas, conferirPerguntasPendentes } from "./painel-perguntas.js";
import { iniciarPainelTendencias } from "./painel-tendencias.js";
import { iniciarPainelChat, montarAvatar } from "./painel-chat.js";

// ----- Estado compartilhado entre os painéis -----
// Os painéis leem daqui e escutam os eventos pra reagir a mudanças.
export const contexto = {
  sessao: null,          // { authenticated, csrfToken }
  configuracao: null,    // { mercadoLivreConfigured, application }
  conta: null,           // dados da conta conectada (se tiver)
  eventos: new EventTarget(),

  get csrf() { return this.sessao?.csrfToken ?? null; },
  get conectado() { return Boolean(this.sessao?.authenticated); },
  get aplicativoPronto() {
    return Boolean(this.configuracao?.mercadoLivreConfigured && this.configuracao?.application?.secureRedirect);
  },

  // Garante que existe uma sessão local com token de segurança
  // (usada pelas consultas públicas e pelo assistente mesmo sem conta)
  async garantirCsrf() {
    if (this.csrf) return this.csrf;
    const [sessao, configuracao] = await Promise.all([obterSessao(), obterConfiguracao()]);
    if (!sessao?.csrfToken) throw new Error("O serviço local não iniciou uma sessão válida.");
    this.sessao = sessao;
    this.configuracao = configuracao;
    return sessao.csrfToken;
  },

  // Registro de atividade no histórico — nunca deixo isso travar a interface
  registrar(acao, extras = {}) {
    if (!this.csrf) return;
    registrarAtividade(this.csrf, { action: acao, ...extras }).catch(() => undefined);
  },

  avisar,
};

// ============================================================
// Tema claro/escuro
// ============================================================

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  salvar("marketsync_tema", tema);
  const escuro = tema === "escuro";
  const caminhoIcone = escuro ? "icone-escuro.png" : "icone-claro.png";
  for (const id of ["login-icone", "menu-icone"]) {
    const imagem = document.getElementById(id);
    if (imagem) imagem.src = caminhoIcone;
  }
  const botao = document.getElementById("botao-tema");
  if (botao) {
    botao.replaceChildren(icone(escuro ? "sol" : "lua"), el("span", {}, escuro ? "Tema claro" : "Tema escuro"));
  }
}

function alternarTema() {
  const atual = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  aplicarTema(atual);
  contexto.registrar("ui.theme", { metadata: { theme: atual === "escuro" ? "dark" : "light" } });
}

// ============================================================
// Navegação entre painéis
// ============================================================

const paineisIniciados = new Set();

const iniciadores = {
  inicio: iniciarPainelInicio,
  anuncios: iniciarPainelAnuncios,
  vendas: iniciarPainelVendas,
  perguntas: iniciarPainelPerguntas,
  tendencias: iniciarPainelTendencias,
  precos: iniciarPainelPrecos,
  concorrentes: iniciarPainelConcorrentes,
  publico: iniciarPainelPublico,
  assistente: iniciarPainelAssistente,
  chat: iniciarPainelChat,
  historico: iniciarPainelHistorico,
};

export function trocarPainel(nome) {
  const secao = document.getElementById(`painel-${nome}`);
  if (!secao) return;

  // Trava de permissão: se o usuário não pode acessar esta aba, mostro a
  // censura por cima em vez de montar o conteúdo, e não inicio o painel
  if (!podeAcessar(nome)) {
    const area = areasSistema().find((a) => a.chave === nome);
    secao.replaceChildren(telaBloqueada(area?.nome ?? nome));
    document.querySelectorAll(".painel").forEach((painel) => painel.classList.remove("ativo"));
    secao.classList.add("ativo");
    document.querySelectorAll("[data-painel]").forEach((botao) => botao.classList.toggle("ativo", botao.dataset.painel === nome));
    document.getElementById("titulo-painel").textContent = area?.nome ?? "Área restrita";
    document.getElementById("subtitulo-painel").textContent = "Sem permissão de acesso";
    return;
  }

  // Inicio o painel só na primeira visita (carregamento preguiçoso)
  if (!paineisIniciados.has(nome)) {
    paineisIniciados.add(nome);
    try { iniciadores[nome]?.(contexto, secao); }
    catch (motivo) { console.error(`Falha ao montar o painel ${nome}`, motivo); }
  }

  document.querySelectorAll(".painel").forEach((painel) => painel.classList.remove("ativo"));
  secao.classList.add("ativo");

  document.querySelectorAll("[data-painel]").forEach((botao) => {
    botao.classList.toggle("ativo", botao.dataset.painel === nome);
  });

  document.getElementById("titulo-painel").textContent = secao.dataset.titulo ?? "";
  document.getElementById("subtitulo-painel").textContent = secao.dataset.subtitulo ?? "";

  salvar("marketsync_painel", nome);
  document.getElementById("menu-lateral").classList.remove("aberto");
  contexto.eventos.dispatchEvent(new CustomEvent("painel-mostrado", { detail: nome }));
}

// ============================================================
// Indicadores de conexão (servidor local + conta)
// ============================================================

function pintarIndicador(id, estado, dica) {
  const indicador = document.getElementById(id);
  if (!indicador) return;
  indicador.classList.remove("ok", "falha", "pendente");
  if (estado) indicador.classList.add(estado);
  if (dica) indicador.title = dica;
}

async function conferirServidor() {
  try {
    const saude = await verificarSaude();
    if (saude?.api === "ok") {
      pintarIndicador("indicador-servidor", "ok", "Servidor local e API respondendo");
    } else {
      pintarIndicador("indicador-servidor", "pendente", saude?.dica ?? "A API local (porta 3100) não respondeu");
    }
    return true;
  } catch {
    pintarIndicador("indicador-servidor", "falha", "O serviço local não respondeu");
    return false;
  }
}

function pintarConta() {
  const botaoConectar = document.getElementById("botao-conectar");
  const botaoSincronizar = document.getElementById("botao-sincronizar");
  if (contexto.conectado) {
    const nome = contexto.conta?.nickname ? ` — ${contexto.conta.nickname}` : "";
    pintarIndicador("indicador-conta", "ok", `Conta conectada${nome}`);
    botaoConectar.hidden = true;
    botaoSincronizar.hidden = false;
  } else {
    pintarIndicador("indicador-conta", "pendente", "Nenhuma conta de anúncios conectada");
    botaoConectar.hidden = !contexto.aplicativoPronto;
    botaoConectar.href = enderecoConexaoOficial();
    botaoSincronizar.hidden = true;
  }
}

// ============================================================
// Sincronização (faixa de progresso abaixo do cabeçalho)
// ============================================================

let cronometroSync = null;

function desenharFaixaSync(estado) {
  const faixa = document.getElementById("faixa-sincronizacao");
  const rodando = estado && ["queued", "running", "cancelling"].includes(estado.status);
  faixa.hidden = !rodando;
  if (!rodando) return;

  const progresso = Math.max(0, Math.min(100, Number(estado.progress ?? 0)));
  faixa.replaceChildren(
    el("svg", {}),
    el("strong", {}, estado.phase || "Sincronizando anúncios…"),
    el("span", {}, `${formatarNumero(estado.processed)} de ${estado.total ? formatarNumero(estado.total) : "—"}`),
    el("div", { classe: `progresso ${estado.total ? "" : "indeterminado"}` }, el("i", { style: `width:${progresso}%` })),
    el("b", {}, `${progresso}%`),
    estado.canCancel !== false
      ? el("button", { classe: "botao-texto", aoClicar: async () => {
          try { await cancelarSincronizacao(contexto.csrf); } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
        } }, "Cancelar")
      : null,
  );
  faixa.firstChild.replaceWith(icone("sincronizar"));
  faixa.querySelector("svg").classList.add("girando");
}

async function acompanharSincronizacao() {
  if (cronometroSync) return;
  cronometroSync = setInterval(async () => {
    try {
      const estado = await obterSincronizacao();
      desenharFaixaSync(estado);
      if (!["queued", "running", "cancelling"].includes(estado.status)) {
        clearInterval(cronometroSync);
        cronometroSync = null;
        if (estado.status === "completed") {
          const mudancas = estado.changes ?? {};
          avisar(`Sincronização concluída: ${mudancas.added ?? 0} novos, ${mudancas.updated ?? 0} alterados, ${mudancas.removed ?? 0} não retornaram.`, "sucesso", 6000);
          contexto.eventos.dispatchEvent(new CustomEvent("sincronizacao-concluida", { detail: estado }));
          // Evento pontual: entra na central de avisos com os detalhes
          const houveMudanca = (mudancas.added ?? 0) + (mudancas.updated ?? 0) + (mudancas.removed ?? 0) > 0;
          publicarAviso({
            id: "ultima-sincronizacao",
            importante: houveMudanca,
            texto: houveMudanca
              ? `Sincronização trouxe mudanças: ${mudancas.added ?? 0} novos · ${mudancas.updated ?? 0} alterados · ${mudancas.removed ?? 0} sumiram`
              : "Sincronização concluída sem mudanças nos anúncios",
            detalhes: () => el("div", {},
              el("p", { style: "font-size:.9rem;margin-bottom:10px" },
                `A última sincronização processou ${formatarNumero(estado.processed)} anúncio(s).`),
              el("ul", { style: "font-size:.87rem;padding-left:20px;line-height:1.8" },
                el("li", {}, `${formatarNumero(mudancas.added ?? 0)} anúncios novos entraram`),
                el("li", {}, `${formatarNumero(mudancas.updated ?? 0)} tiveram algum campo alterado`),
                el("li", {}, `${formatarNumero(mudancas.removed ?? 0)} não retornaram na consulta`),
                el("li", {}, `${formatarNumero(mudancas.unchanged ?? 0)} continuam iguais`)),
              el("p", { style: "font-size:.8rem;color:var(--texto-suave);margin-top:10px" },
                "Os anúncios alterados aparecem com etiqueta colorida na aba Anúncios, e o detalhe completo fica no Histórico."),
            ),
          });
        } else if (estado.status === "failed") {
          avisar(estado.error || "A sincronização falhou.", "perigo");
          publicarAviso({
            id: "ultima-sincronizacao",
            importante: true,
            texto: "A última sincronização falhou",
            detalhes: `A sincronização não terminou: ${estado.error || "falha não identificada"}. Tente de novo pelo botão Sincronizar; se repetir, veja o código do erro no Histórico.`,
          });
        }
      }
    } catch {
      // erro passageiro de rede: a próxima batida tenta de novo
    }
  }, 1200);
}

async function aoClicarSincronizar() {
  const botao = document.getElementById("botao-sincronizar");
  botao.disabled = true;
  try {
    const estado = await iniciarSincronizacao(contexto.csrf);
    desenharFaixaSync(estado);
    acompanharSincronizacao();
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
  } finally {
    botao.disabled = false;
  }
}

// ============================================================
// Tela de login
// ============================================================

function desenharLogin(erroSessao) {
  const tela = document.getElementById("tela-login");
  const conexoes = document.getElementById("login-conexoes");
  const acoes = document.getElementById("login-acoes");
  const caixaErro = document.getElementById("login-erro");

  caixaErro.hidden = !erroSessao;
  if (erroSessao) caixaErro.textContent = erroSessao;

  const pronto = contexto.aplicativoPronto;
  const verificado = contexto.configuracao != null;

  conexoes.replaceChildren(
    el("article", { classe: verificado ? (pronto ? "pronta" : "atencao") : "" },
      icone("chave"),
      el("div", {},
        el("span", {}, "Conexão do aplicativo"),
        el("strong", {}, verificado ? (pronto ? "Pronta" : "Configuração necessária") : "Ainda não verificada"),
      ),
      el("i"),
    ),
    el("article", { classe: contexto.conectado ? "pronta" : "" },
      icone("loja"),
      el("div", {},
        el("span", {}, "Conta dos anúncios"),
        el("strong", {}, contexto.conectado ? "Conectada" : "Aguardando conexão"),
      ),
      el("i"),
    ),
  );

  acoes.replaceChildren();
  if (!verificado) {
    acoes.append(el("button", {
      classe: "botao primario",
      aoClicar: async (evento) => {
        const botao = evento.currentTarget;
        botao.disabled = true;
        botao.textContent = "Verificando…";
        try {
          contexto.configuracao = await obterConfiguracao();
          desenharLogin();
        } catch (motivo) {
          desenharLogin(erroAmigavel(motivo));
        }
      },
    }, icone("chave"), "Verificar conexão oficial"));
  } else if (pronto) {
    acoes.append(el("a", { classe: "botao primario", href: enderecoConexaoOficial() },
      "Conectar conta Mercado Livre", icone("externo")));
    // Alternativa pra quem não tem webcam no computador: o reconhecimento
    // facial acontece no celular e a conta conecta aqui mesmo assim
    acoes.append(el("button", { classe: "botao", aoClicar: () => { void abrirConexaoPeloCelular(); } },
      icone("celular"), "Conectar pelo celular (sem webcam)"));
  } else {
    acoes.append(el("button", { classe: "botao primario", disabled: true }, "Conexão oficial indisponível"));
  }
  acoes.append(el("button", {
    classe: "botao",
    aoClicar: () => {
      salvar("marketsync_convidado", true);
      tela.hidden = true;
      mostrarAplicativo();
    },
  }, "Continuar sem conectar"));

  tela.hidden = false;
}

// ============================================================
// Ajuda e opções
// ============================================================

const topicosAjuda = [
  ["Conexão oficial", "Carrega somente os anúncios da conta autorizada e permite alterações seguras pela API do Mercado Livre."],
  ["Consultas públicas", "A aba separada consulta uma loja por URL ou procura ofertas pelo nome do produto. É opcional, não altera anúncios e pode ficar incompleta se o site bloquear a leitura."],
  ["Pix oficial × observado", "O oficial vem da API (campanha BANK). O observado é texto explícito visto na página pública — é uma observação, não garantia de checkout."],
  ["Preços", "A aba Preços acompanha os valores dos seus anúncios e guarda um histórico local pra mostrar o que subiu ou desceu entre sincronizações."],
  ["Concorrentes", "Mostra a disputa de catálogo dos seus anúncios: quem está ganhando, o preço pra ganhar e os demais participantes."],
  ["Filtros e seleção", "Combine filtros, selecione a página ou todos os resultados e revise a prévia antes de qualquer alteração em massa."],
  ["Pausas de segurança", "As consultas públicas aguardam entre páginas e anúncios. O tempo de espera aparece no progresso."],
  ["Assistente", "O AlphaBot IA responde dúvidas, analisa anúncios e escreve textos. Aceita imagens coladas ou arrastadas na conversa."],
  ["Histórico", "Guarda sessões, sincronizações e alterações. Tokens e credenciais nunca entram nesse registro."],
  ["Persistência", "Tema, filtros, busca e aba continuam como estavam quando você voltar. Resetar informações limpa essas preferências."],
];

function abrirAjuda() {
  abrirModal({
    chapeu: "Guia rápido",
    titulo: "Como usar o MarketSync",
    tamanho: "largo",
    corpo: el("div", { classe: "lista-ajuda" },
      topicosAjuda.map(([titulo, texto]) => el("div", {}, el("strong", {}, titulo), el("p", {}, texto))),
    ),
  });
}

// O Mercado Livre às vezes exige reconhecimento facial no login. Sem webcam,
// o caminho é abrir o link de autorização no CELULAR: a câmera do telefone
// resolve a verificação e a conta conecta aqui, porque a autorização fica
// amarrada à sessão deste computador (via state), não ao aparelho.
async function abrirConexaoPeloCelular() {
  let link = "";
  try {
    link = (await obterLinkConexao())?.url ?? "";
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
    return;
  }
  if (!link) { avisar("Não consegui gerar o link de conexão.", "perigo"); return; }

  const campoLink = el("input", { classe: "entrada", value: link, readonly: true, aoClicar: (evento) => evento.currentTarget.select() });
  abrirModal({
    chapeu: "Conexão da conta",
    titulo: "Conectar pelo celular",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:12px" },
      el("p", { style: "font-size:.88rem;line-height:1.6" },
        "O Mercado Livre pediu reconhecimento facial e este computador não tem câmera? Sem problema: abra o link abaixo no seu celular, faça o login e a verificação por lá. Assim que aprovar, ", el("strong", {}, "a conta conecta neste computador"), " — depois é só voltar aqui e recarregar a página."),
      campoLink,
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
        el("button", { classe: "botao primario", aoClicar: async (evento) => {
          if (await copiarTexto(link)) {
            evento.currentTarget.replaceChildren(icone("confere"), "Link copiado!");
          }
        } }, icone("copiar"), "Copiar link"),
        el("a", { classe: "botao", href: `https://wa.me/?text=${encodeURIComponent(`Conectar MarketSync: ${link}`)}`, target: "_blank", rel: "noreferrer" },
          icone("celular"), "Enviar pro WhatsApp"),
      ),
      el("p", { style: "font-size:.76rem;color:var(--texto-suave)" },
        "O link vale por 10 minutos e só funciona uma vez. Depois de aprovar no celular, a página que abrir lá pode ser fechada."),
    ),
  });
}

// Troca de senha de quem está logado
function abrirTrocarSenha() {
  const atual = el("input", { classe: "entrada", type: "password", placeholder: "Senha atual" });
  const nova = el("input", { classe: "entrada", type: "password", placeholder: "Nova senha (mínimo 6)" });
  abrirModal({
    chapeu: "Segurança", titulo: "Trocar senha",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:10px" },
      el("label", { classe: "campo" }, el("span", {}, "Senha atual"), atual),
      el("label", { classe: "campo" }, el("span", {}, "Nova senha"), nova)),
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao primario", aoClicar: async (evento) => {
        evento.currentTarget.disabled = true;
        try {
          await trocarSenha(await contexto.garantirCsrf(), atual.value, nova.value);
          avisar("Senha trocada com sucesso.", "sucesso");
          fecharModal();
        } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); evento.currentTarget.disabled = false; }
      } }, "Salvar nova senha"),
    ],
  });
}

async function sairERecarregar() {
  try { await sairDaConta(contexto.csrf); } catch { /* mesmo se falhar, recarrego */ }
  window.location.reload();
}

async function excluirMinhaConta() {
  const papel = usuarioLogado()?.papel;
  const aviso = papel === "ADMIN"
    ? "Excluir sua conta de Administrador apaga TAMBÉM todos os usuários vinculados à sua empresa. Esta ação é definitiva."
    : "Sua conta será apagada de forma definitiva.";
  const confirmado = await confirmar({
    titulo: "Excluir minha conta", mensagem: `${aviso} Digite EXCLUIR na próxima etapa para confirmar.`,
    textoConfirmar: "Continuar", perigoso: true,
  });
  if (!confirmado) return;
  const campo = el("input", { classe: "entrada", placeholder: "Digite EXCLUIR" });
  abrirModal({
    chapeu: "Ação definitiva", titulo: "Confirmar exclusão da conta",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:10px" },
      el("p", { style: "font-size:.88rem;color:var(--texto-suave)" }, aviso),
      el("label", { classe: "campo" }, el("span", {}, "Confirmação"), campo)),
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao perigoso", aoClicar: async (evento) => {
        evento.currentTarget.disabled = true;
        try {
          const resultado = await excluirPropriaConta(await contexto.garantirCsrf(), campo.value.trim());
          avisar(resultado.usuariosRemovidos ? `Conta e ${resultado.usuariosRemovidos} usuário(s) vinculados removidos.` : "Conta removida.", "sucesso");
          setTimeout(() => window.location.reload(), 900);
        } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); evento.currentTarget.disabled = false; }
      } }, "Excluir definitivamente"),
    ],
  });
}

function abrirOpcoes(ancora) {
  const itens = [];
  const eu = usuarioLogado();
  if (eu) {
    itens.push({ icone: "usuarios", rotulo: `${eu.nome || eu.usuario} · ${{ OWNER: "Fundador", ADMIN: "Administrador", USER: "Usuário" }[eu.papel] ?? eu.papel}`, aoClicar: () => {} });
    if (ehGestor()) itens.push({ icone: "usuarios", rotulo: "Gerenciar usuários", aoClicar: () => abrirGestaoUsuarios(contexto) });
    itens.push({ icone: "imagem", rotulo: "Foto de perfil", aoClicar: abrirFotoPerfil });
    itens.push({ icone: "chave", rotulo: "Trocar senha", aoClicar: abrirTrocarSenha });
    itens.push({ icone: "sair", rotulo: "Sair da conta", aoClicar: () => { void sairERecarregar(); } });
    itens.push("separador");
  }
  if (!contexto.conectado && contexto.aplicativoPronto) {
    itens.push({
      icone: "celular", rotulo: "Conectar Mercado Livre pelo celular",
      aoClicar: () => { void abrirConexaoPeloCelular(); },
    });
  }
  if (contexto.conectado) {
    itens.push({
      icone: "sair", rotulo: "Desconectar conta", perigoso: true,
      aoClicar: async () => {
        if (!(await confirmar({ titulo: "Desconectar conta", mensagem: "A conta do Mercado Livre será desconectada deste computador. Os anúncios já sincronizados continuam salvos.", textoConfirmar: "Desconectar", perigoso: true }))) return;
        try {
          await encerrarSessao(contexto.csrf);
          localStorage.removeItem("marketsync_convidado");
          window.location.reload();
        } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
      },
    });
  } else {
    itens.push({
      icone: "sair", rotulo: "Sair do modo sem conta",
      aoClicar: () => { localStorage.removeItem("marketsync_convidado"); window.location.reload(); },
    });
  }
  itens.push("separador");
  if (eu) itens.push({ icone: "lixeira", rotulo: "Excluir minha conta", perigoso: true, aoClicar: () => { void excluirMinhaConta(); } });
  itens.push({
    icone: "lixeira", rotulo: "Resetar informações locais", perigoso: true,
    aoClicar: async () => {
      if (!(await confirmar({ titulo: "Resetar informações", mensagem: "Limpa preferências, filtros e leituras públicas salvas neste navegador. O histórico de auditoria e os anúncios sincronizados não são apagados.", textoConfirmar: "Resetar", perigoso: true }))) return;
      try {
        const csrf = await contexto.garantirCsrf();
        await resetarTudo(csrf, "RESETAR").catch(() => undefined);
      } catch { /* mesmo sem backend dá pra limpar o navegador */ }
      const tema = lerSalvo("marketsync_tema", "claro");
      localStorage.clear();
      salvar("marketsync_tema", tema);
      contexto.registrar("ui.reset");
      avisar("Informações locais limpas.", "sucesso");
      setTimeout(() => window.location.reload(), 700);
    },
  });
  abrirMenuSuspenso(ancora, itens);
}

// ============================================================
// Inicialização
// ============================================================

function mostrarAplicativo() {
  document.getElementById("tela-login").hidden = true;
  document.getElementById("tela-autenticacao").hidden = true;
  document.getElementById("aplicativo").hidden = false;
  pintarConta();

  // Central de avisos do cabeçalho: dicas rotativas + eventos pontuais
  iniciarCentralAvisos();
  semearAvisosPadrao(contexto);

  // Perguntas de compradores sem resposta: confiro agora e a cada 5 minutos
  // (alimenta a bolinha do menu e o aviso importante do cabeçalho)
  if (contexto.conectado) {
    void conferirPerguntasPendentes(contexto);
    setInterval(() => void conferirPerguntasPendentes(contexto), 300000);
  }

  // Volto pro painel onde a pessoa estava da última vez
  const painelSalvo = lerSalvo("marketsync_painel", "inicio");
  trocarPainel(iniciadores[painelSalvo] ? painelSalvo : "inicio");

  contexto.registrar("ui.open");

  // Batida de presença pro histórico saber que a sessão continua viva
  if (contexto.csrf) {
    const bater = () => baterCoracao(contexto.csrf).catch(() => undefined);
    setInterval(bater, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) bater(); });
  }

  // Se já tinha uma sincronização rodando quando a página abriu, retomo o acompanhamento
  if (contexto.conectado) {
    obterSincronizacao().then((estado) => {
      if (["queued", "running", "cancelling"].includes(estado.status)) {
        desenharFaixaSync(estado);
        acompanharSincronizacao();
      }
    }).catch(() => undefined);
  }
}

async function iniciar() {
  aplicarTema(lerSalvo("marketsync_tema", "claro"));
  if (lerSalvo("marketsync_menu_recolhido") === "1") {
    document.getElementById("menu-lateral").classList.add("recolhido");
  }

  // Ligações fixas da interface
  document.getElementById("botao-tema").addEventListener("click", alternarTema);
  document.getElementById("botao-ajuda").addEventListener("click", abrirAjuda);
  document.getElementById("botao-configuracoes").addEventListener("click", (evento) => abrirOpcoes(evento.currentTarget));
  document.getElementById("botao-sincronizar").addEventListener("click", aoClicarSincronizar);
  document.getElementById("botao-menu-mobile").addEventListener("click", () => {
    const menu = document.getElementById("menu-lateral");
    if (window.matchMedia("(min-width: 921px)").matches) {
      const recolhido = menu.classList.toggle("recolhido");
      salvar("marketsync_menu_recolhido", recolhido ? "1" : "0");
    } else {
      menu.classList.toggle("aberto");
    }
  });
  document.getElementById("botao-mais-mobile")?.addEventListener("click", () => {
    document.getElementById("menu-lateral").classList.add("aberto");
  });
  // Fecha a gaveta do menu ao tocar fora dela (no celular)
  document.addEventListener("click", (evento) => {
    const menu = document.getElementById("menu-lateral");
    if (menu.classList.contains("aberto") && !menu.contains(evento.target)
      && !evento.target.closest("#botao-menu-mobile") && !evento.target.closest("#botao-mais-mobile")) {
      menu.classList.remove("aberto");
    }
  });

  document.querySelectorAll("[data-painel]").forEach((botao) => {
    botao.addEventListener("click", () => {
      trocarPainel(botao.dataset.painel);
      contexto.registrar("ui.tab", { metadata: { tab: botao.dataset.painel } });
    });
  });

  // Conexão com o servidor: confiro agora e depois de tempos em tempos
  conferirServidor();
  setInterval(conferirServidor, 30000);

  // Descubro em que pé está a sessão do Mercado Livre (para os painéis)
  try {
    const [sessao, configuracao] = await Promise.all([obterSessao(), obterConfiguracao()]);
    contexto.sessao = sessao;
    contexto.configuracao = configuracao;
  } catch { /* segue; o login local trata o erro de conexão */ }

  // O PORTÃO agora é o login local do aplicativo. Só depois de entrar é que
  // o conteúdo aparece (e já com o gate de permissões aplicado).
  await iniciarAutenticacao(contexto, aoEntrarLogado);
}

// Contador de mensagens não lidas do chat (bolinha no menu)
async function conferirChatNaoLidas() {
  try {
    const { total } = await chatNaoLidas();
    const bolinha = document.getElementById("contador-chat");
    if (bolinha) {
      bolinha.hidden = !total;
      bolinha.textContent = total > 99 ? "99+" : String(total);
    }
  } catch { /* tento de novo na próxima rodada */ }
}

// Avatar do usuário logado no cabeçalho (clicando troca a foto de perfil)
function desenharAvatarCabecalho() {
  const eu = usuarioLogado();
  if (!eu) return;
  document.getElementById("avatar-cabecalho-atual")?.remove();
  const avatar = montarAvatar(eu, 32);
  avatar.id = "avatar-cabecalho-atual";
  avatar.classList.add("avatar-cabecalho");
  avatar.title = `${eu.nome || eu.usuario} — clique pra trocar a foto de perfil`;
  avatar.addEventListener("click", abrirFotoPerfil);
  document.querySelector(".estado-cabecalho")?.prepend(avatar);
}

// Troca de foto de perfil: reduzo a imagem pra 128px no navegador
// antes de mandar, então o banco guarda só uma miniatura leve
function abrirFotoPerfil() {
  const entrada = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  entrada.addEventListener("change", async () => {
    const arquivo = entrada.files?.[0];
    if (!arquivo) return;
    try {
      const bitmap = await createImageBitmap(arquivo);
      const lado = Math.min(bitmap.width, bitmap.height);
      const tela = document.createElement("canvas");
      tela.width = 128; tela.height = 128;
      // recorte quadrado central, pra foto ficar redondinha sem esticar
      tela.getContext("2d").drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 128, 128);
      const dataUrl = tela.toDataURL("image/jpeg", 0.85);
      const { usuario } = await salvarFotoPerfil(await contexto.garantirCsrf(), dataUrl);
      const eu = usuarioLogado();
      if (eu) eu.fotoPerfil = usuario.fotoPerfil;
      desenharAvatarCabecalho();
      avisar("Foto de perfil atualizada.", "sucesso");
    } catch (motivo) {
      avisar(erroAmigavel(motivo), "perigo");
    }
  });
  document.body.append(entrada);
  entrada.click();
  setTimeout(() => entrada.remove(), 60000);
}

// Chamado quando o login local dá certo (ou já havia sessão logada).
async function aoEntrarLogado(usuarioLocal, areas) {
  definirUsuario(usuarioLocal, areas);
  aplicarGateNoMenu();

  // Agora carrego os detalhes da conta do Mercado Livre, se conectada
  if (contexto.conectado) {
    try { contexto.conta = await obterConta(); } catch { /* sigo sem os detalhes */ }
  }
  mostrarAplicativo();
  desenharAvatarCabecalho();

  // Mensagens do chat: confiro agora e a cada 45 segundos
  void conferirChatNaoLidas();
  setInterval(() => void conferirChatNaoLidas(), 45000);
}

iniciar();
