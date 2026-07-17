// ============================================================
// painel-publico.js — a aba NÃO OFICIAL. Lê páginas públicas do
// Mercado Livre (loja por URL ou busca por produto) sem mexer em
// nada. Fica atrás de um cadeado com senha e sempre respeita as
// pausas de segurança do serviço local.
// ============================================================

import {
  el, icone, formatarMoeda, formatarNumero, formatarData, nomeCondicao,
  percentualDesconto, aguardarDigitacao, lerSalvo, salvar, baixarArquivo,
} from "./utilitarios.js";
import {
  iniciarLeituraPublica, acompanharLeituraPublica, cancelarLeituraPublica,
  retomarLeituraPublica, decidirLeituraPublica, situacaoAcessoPublico,
  cadastrarSenhaPublica, conferirSenhaPublica, redefinirSenhaPublica,
  buscarParticipantesCatalogo, enderecoConexaoOficial, erroAmigavel,
} from "./api.js";
import {
  avisar, abrirModal, fecharModal, confirmar, estadoVazio, montarPaginacao, botaoCopiar, caixaMarcar,
} from "./componentes.js";
import { montarRanking } from "./painel-anuncios.js";
import { publicarAviso } from "./central-avisos.js";

let contextoGlobal = null;
let raiz = null;

// ----- Estado persistido -----
const configuracao = {
  modo: "seller", url: "", termo: "", limitado: true, maximo: 30, verificarPix: true,
  // Pausa programada: a busca para ao atingir N produtos e pergunta se continua
  pausarAtivo: false, pausarA: 100,
  ...lerSalvo("marketsync_publico_config", {}),
};
let leitura = lerSalvo("marketsync_publico_leitura", null);
let arquivadas = lerSalvo("marketsync_publico_arquivo", []);
let selecionados = new Set(lerSalvo("marketsync_publico_selecao", []));

// A ativação fica salva: depois de liberar com o código uma vez, a área
// permanece ativa até a pessoa desativar no interruptor (pedido do Ander —
// antes trancava de novo a cada recarregada da página)
let ligado = lerSalvo("marketsync_publico_ativo", false);
let abaAtiva = "consulta";  // consulta | arquivadas
const visaoObservados = {
  busca: "", vendedor: "", precoMinimo: "", precoMaximo: "", vendasMinimas: "",
  filtro: "todos", ordenacao: "origem", pagina: 1, tamanhoPagina: 30,
};
let avisoComparacao = null;
let cronometroLeitura = null;

export function iniciarPainelPublico(contexto, secao) {
  contextoGlobal = contexto;
  raiz = secao;

  // Termo vindo da aba Tendências: já chego com a busca de produto preenchida
  const termoTendencia = sessionStorage.getItem("marketsync_termo_tendencia");
  if (termoTendencia) {
    sessionStorage.removeItem("marketsync_termo_tendencia");
    configuracao.modo = "product";
    configuracao.termo = termoTendencia;
    guardarConfiguracao();
    abaAtiva = "consulta";
  }

  desenhar();

  // Se a página fechou no meio de uma leitura, retomo o acompanhamento
  // (a área já fica ativa porque a ativação é persistida)
  if (ligado && leitura && ["queued", "running", "paused"].includes(leitura.status)) {
    acompanhar();
  }
}

function guardarConfiguracao() {
  salvar("marketsync_publico_config", configuracao);
}

function guardarLeitura() {
  if (leitura) salvar("marketsync_publico_leitura", leitura);
  else localStorage.removeItem("marketsync_publico_leitura");
}

// ============================================================
// Cadeado de ativação
// ============================================================

function ligar() {
  ligado = true;
  salvar("marketsync_publico_ativo", true);
  desenhar();
  if (leitura && ["queued", "running"].includes(leitura.status)) acompanhar();
}

async function abrirCadeado() {
  let configurado = false;
  try {
    configurado = (await situacaoAcessoPublico())?.configured ?? false;
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
    return;
  }
  if (configurado) formularioSenha();
  else formularioCadastro();
}

function formularioCadastro() {
  const campoSenha = el("input", { type: "password", placeholder: "Mínimo de 8 caracteres" });
  const campoPergunta = el("input", { placeholder: "Ex.: nome do meu primeiro cachorro?" });
  const campoResposta = el("input", { placeholder: "Só você precisa saber" });

  abrirModal({
    chapeu: "Primeira ativação",
    titulo: "Crie o código de liberação",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:12px" },
      el("p", { style: "font-size:.85rem;color:var(--texto-suave)" },
        "As consultas públicas ficam trancadas atrás de um código. Ele evita que a leitura de páginas seja ativada sem querer."),
      el("label", { classe: "campo" }, el("span", {}, "Código de liberação"), campoSenha),
      el("label", { classe: "campo" }, el("span", {}, "Pergunta de recuperação (mín. 10 caracteres)"), campoPergunta),
      el("label", { classe: "campo" }, el("span", {}, "Resposta de recuperação"), campoResposta),
    ),
    rodape: [
      el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao primario", aoClicar: async (evento) => {
        const botao = evento.currentTarget;
        botao.disabled = true;
        try {
          const csrf = await contextoGlobal.garantirCsrf();
          await cadastrarSenhaPublica(csrf, campoSenha.value, campoPergunta.value, campoResposta.value);
          fecharModal();
          avisar("Código criado. Área liberada.", "sucesso");
          ligar();
        } catch (motivo) {
          avisar(erroAmigavel(motivo), "perigo");
          botao.disabled = false;
        }
      } }, "Criar e liberar"),
    ],
  });
}

function formularioSenha() {
  const campoSenha = el("input", { type: "password", placeholder: "Digite o código" });
  const enviar = async (botao) => {
    botao.disabled = true;
    try {
      const csrf = await contextoGlobal.garantirCsrf();
      await conferirSenhaPublica(csrf, campoSenha.value);
      fecharModal();
      ligar();
    } catch (motivo) {
      avisar(motivo?.codigo === "WRONG_PASSWORD" ? "Código incorreto." : erroAmigavel(motivo), "perigo");
      botao.disabled = false;
    }
  };

  const botaoLiberar = el("button", { classe: "botao primario", aoClicar: (evento) => enviar(evento.currentTarget) }, "Liberar");
  campoSenha.addEventListener("keydown", (evento) => { if (evento.key === "Enter") enviar(botaoLiberar); });

  abrirModal({
    chapeu: "Área trancada",
    titulo: "Informe o código de liberação",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:12px" },
      el("label", { classe: "campo" }, el("span", {}, "Código de liberação"), campoSenha),
      el("button", { classe: "botao-texto", style: "align-self:flex-start", aoClicar: formularioRecuperacao }, "Esqueci o código"),
    ),
    rodape: [el("button", { classe: "botao", aoClicar: fecharModal }, "Cancelar"), botaoLiberar],
  });
  setTimeout(() => campoSenha.focus(), 60);
}

function formularioRecuperacao() {
  const campoResposta = el("input", { placeholder: "Resposta da pergunta de recuperação" });
  const campoNova = el("input", { type: "password", placeholder: "Novo código (mínimo 8 caracteres)" });

  abrirModal({
    chapeu: "Recuperação",
    titulo: "Redefinir o código",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:12px" },
      el("p", { style: "font-size:.85rem;color:var(--texto-suave)" },
        "Responda a pergunta de recuperação que você criou na primeira ativação e escolha um código novo."),
      el("label", { classe: "campo" }, el("span", {}, "Resposta de recuperação"), campoResposta),
      el("label", { classe: "campo" }, el("span", {}, "Novo código"), campoNova),
    ),
    rodape: [
      el("button", { classe: "botao", aoClicar: formularioSenha }, "Voltar"),
      el("button", { classe: "botao primario", aoClicar: async (evento) => {
        const botao = evento.currentTarget;
        botao.disabled = true;
        try {
          const csrf = await contextoGlobal.garantirCsrf();
          await redefinirSenhaPublica(csrf, campoResposta.value, campoNova.value);
          avisar("Código redefinido. Área liberada.", "sucesso");
          fecharModal();
          ligar();
        } catch (motivo) {
          avisar(motivo?.codigo === "WRONG_ANSWER" ? "Resposta incorreta." : erroAmigavel(motivo), "perigo");
          botao.disabled = false;
        }
      } }, "Redefinir e liberar"),
    ],
  });
}

// ============================================================
// Desenho principal
// ============================================================

function desenhar() {
  raiz.replaceChildren();

  const interruptor = el("button", {
    classe: `interruptor ${ligado ? "ligado" : ""}`,
    "aria-pressed": String(ligado),
    aoClicar: () => {
      if (ligado) {
        ligado = false;
        salvar("marketsync_publico_ativo", false);
        desenhar();
        return;
      }
      abrirCadeado();
    },
  }, el("i"), el("span", {}, ligado ? "Ativado" : "Ativar"));

  // Controle da pausa programada, ao lado do interruptor de ativar
  const marcadorPausa = caixaMarcar(configuracao.pausarAtivo, (marcado) => {
    configuracao.pausarAtivo = marcado;
    guardarConfiguracao();
  }, "Pausar a cada");
  const campoPausa = el("input", {
    type: "number", min: "10", max: "2000", value: configuracao.pausarA,
    style: "width:76px", classe: "entrada",
    title: "A busca pausa ao atingir essa quantidade e pergunta se deve continuar",
    aoMudar: (evento) => {
      configuracao.pausarA = Math.max(10, Math.min(2000, Number(evento.target.value) || 100));
      evento.target.value = configuracao.pausarA;
      guardarConfiguracao();
    },
  });

  raiz.append(el("div", { classe: "topo-publico" },
    el("span", { classe: "selo roxo" }, icone("radar"), "Opcional · não oficial"),
    ligado
      ? el("span", { classe: "controle-pausa", title: "Com isso ligado, a busca para na quantidade escolhida e pergunta se você quer continuar — bom pra não passar do ponto sem querer" },
          marcadorPausa.elemento, campoPausa, el("span", { style: "font-size:.8rem;color:var(--texto-suave)" }, "produtos"))
      : null,
    interruptor,
  ));

  if (!ligado) {
    raiz.append(el("div", { classe: "cartao-cadeado" },
      icone("cadeado"),
      el("h3", {}, "Consultas públicas desativadas"),
      el("p", {}, "Essa área lê páginas públicas do Mercado Livre sem alterar nada: dá pra observar uma loja inteira por URL ou buscar ofertas pelo nome do produto. Por segurança, ela fica trancada atrás de um código de liberação."),
      el("button", { classe: "botao primario", style: "margin:0 auto", aoClicar: abrirCadeado }, icone("cadeado-aberto"), "Ativar com o código"),
    ));
    return;
  }

  // Abas: consulta atual × arquivadas
  raiz.append(el("div", { classe: "abas", style: "margin-bottom:14px" },
    el("button", { classe: abaAtiva === "consulta" ? "ativa" : "", aoClicar: () => { abaAtiva = "consulta"; desenhar(); } },
      icone("lupa"), "Consultar"),
    el("button", { classe: abaAtiva === "arquivadas" ? "ativa" : "", aoClicar: () => { abaAtiva = "arquivadas"; desenhar(); } },
      icone("arquivo"), `Arquivadas${arquivadas.length ? ` (${arquivadas.length})` : ""}`),
  ));

  if (abaAtiva === "arquivadas") {
    desenharArquivadas();
    return;
  }

  desenharFormulario();
  const areaAndamento = el("div", { id: "area-andamento" });
  const areaResultados = el("div", { id: "area-resultados" });
  raiz.append(areaAndamento, areaResultados);
  desenharAndamento();
  desenharResultados();
}

// ----- Formulário de consulta -----

function desenharFormulario() {
  const rodando = leitura && ["queued", "running", "paused"].includes(leitura.status);

  const campoPrincipal = configuracao.modo === "seller"
    ? el("label", { classe: "campo campo-principal" },
        el("span", {}, "URL da página ou loja"),
        el("input", { value: configuracao.url, placeholder: "https://www.mercadolivre.com.br/loja/…",
          aoDigitar: (evento) => { configuracao.url = evento.target.value; guardarConfiguracao(); } }))
    : el("label", { classe: "campo campo-principal" },
        el("span", {}, "Nome do produto"),
        el("input", { value: configuracao.termo, placeholder: "Ex.: Furadeira Bosch GSB 13 RE",
          aoDigitar: (evento) => { configuracao.termo = evento.target.value; guardarConfiguracao(); } }));

  const marcadorPix = caixaMarcar(configuracao.verificarPix, (marcado) => {
    configuracao.verificarPix = marcado;
    guardarConfiguracao();
  }, "Verificar Pix explícito nas páginas");

  raiz.append(el("div", { classe: "formulario-publico" },
    el("div", { classe: "abas", style: "margin-bottom:12px" },
      el("button", { classe: configuracao.modo === "seller" ? "ativa" : "", aoClicar: () => { configuracao.modo = "seller"; guardarConfiguracao(); desenhar(); } },
        icone("loja"), "URL do anunciante"),
      el("button", { classe: configuracao.modo === "product" ? "ativa" : "", aoClicar: () => { configuracao.modo = "product"; guardarConfiguracao(); desenhar(); } },
        icone("lupa"), "Nome do produto"),
    ),
    el("div", { classe: "linha-formulario" },
      campoPrincipal,
      el("label", { classe: "campo", style: "width:150px" },
        el("span", {}, "Quantidade"),
        el("select", { aoMudar: (evento) => { configuracao.limitado = evento.target.value === "limitado"; guardarConfiguracao(); desenhar(); } },
          el("option", { value: "limitado", selected: configuracao.limitado }, "Definir limite"),
          el("option", { value: "todos", selected: !configuracao.limitado }, "Buscar todos"))),
      configuracao.limitado
        ? el("label", { classe: "campo", style: "width:110px" },
            el("span", {}, "Máximo"),
            el("input", { type: "number", min: "1", max: "2000", value: configuracao.maximo,
              aoMudar: (evento) => { configuracao.maximo = Math.max(1, Number(evento.target.value) || 1); guardarConfiguracao(); } }))
        : null,
      el("button", { classe: "botao primario", disabled: rodando, aoClicar: prepararEnvio },
        icone(configuracao.modo === "seller" ? "loja" : "lupa"),
        configuracao.modo === "seller" ? "Ler loja" : "Buscar ofertas"),
    ),
    el("div", { classe: "opcoes-extras" },
      marcadorPix.elemento,
      el("span", { classe: "nota-cooldown" }, icone("escudo"),
        "Pausas de segurança sempre ativas: 4,5–8 s entre páginas e 2,8–5 s entre anúncios."),
    ),
    !configuracao.limitado
      ? el("p", { style: "font-size:.78rem;color:var(--atencao);margin-top:10px" },
          "“Buscar todos” percorre até 100 páginas e pode demorar bastante. Dá pra cancelar sem perder o que já foi lido.")
      : null,
  ));
}

async function prepararEnvio() {
  // Se já tem resultado na tela, ofereço arquivar antes de sobrescrever
  if (leitura?.items?.length) {
    const arquivar = await confirmar({
      titulo: "Guardar a consulta atual?",
      mensagem: `A consulta atual tem ${leitura.items.length} anúncios observados. Quer arquivá-la antes de começar uma nova? Arquivadas ficam salvas neste navegador.`,
      textoConfirmar: "Arquivar e continuar",
      textoCancelar: "Descartar e continuar",
    });
    if (arquivar) arquivarLeitura(leitura);
  }
  enviarConsulta();
}

function arquivarLeitura(antiga) {
  arquivadas = [{
    id: antiga.id,
    data: new Date().toISOString(),
    modo: antiga.mode,
    consulta: antiga.mode === "product" ? antiga.query ?? "" : antiga.sourceUrl,
    itens: antiga.items,
    paginasLidas: antiga.pagesRead,
    comPix: antiga.items.filter((item) => item.pixObserved).length,
  }, ...arquivadas].slice(0, 20);
  salvar("marketsync_publico_arquivo", arquivadas);
}

async function enviarConsulta() {
  if (configuracao.modo === "seller" && !configuracao.url.trim()) { avisar("Informe a URL da loja.", "perigo"); return; }
  if (configuracao.modo === "product" && configuracao.termo.trim().length < 2) { avisar("Digite o nome do produto.", "perigo"); return; }

  avisoComparacao = null;
  selecionados = new Set();
  salvar("marketsync_publico_selecao", []);
  visaoObservados.pagina = 1;

  try {
    const csrf = await contextoGlobal.garantirCsrf();
    leitura = await iniciarLeituraPublica(csrf, {
      mode: configuracao.modo,
      url: configuracao.modo === "seller" ? configuracao.url.trim() : undefined,
      query: configuracao.modo === "product" ? configuracao.termo.trim() : undefined,
      limitMode: configuracao.limitado ? "limited" : "all",
      maxItems: configuracao.limitado ? configuracao.maximo : undefined,
      inspectPix: configuracao.verificarPix,
      pauseEvery: configuracao.pausarAtivo ? configuracao.pausarA : undefined,
    });
    guardarLeitura();
    contextoGlobal.registrar("unofficial.start", {
      targetType: configuracao.modo === "seller" ? "public-page" : "public-search",
      targetId: configuracao.modo === "seller" ? configuracao.url : configuracao.termo,
      metadata: { mode: configuracao.modo, limitMode: configuracao.limitado ? "limited" : "all" },
    });
    desenharAndamento();
    desenharResultados();
    acompanhar();
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
  }
}

// ----- Acompanhamento (polling) -----

// Pergunta da pausa programada: abre uma vez por pausa (a chave junta o id
// da consulta com o total do momento pra não perguntar em dobro)
let pausaPerguntada = "";

function perguntarSobrePausa() {
  if (!leitura || leitura.status !== "paused") return;
  const chave = `${leitura.id}|${leitura.total}`;
  if (pausaPerguntada === chave) return;
  pausaPerguntada = chave;

  const decidir = async (continuar) => {
    fecharModal();
    try {
      const csrf = await contextoGlobal.garantirCsrf();
      leitura = await decidirLeituraPublica(csrf, leitura.id, continuar);
      guardarLeitura();
      desenharAndamento();
      avisar(continuar ? "Busca retomada — nada será repetido." : "Finalizando com o que já foi encontrado.", "info");
    } catch (motivo) {
      avisar(erroAmigavel(motivo), "perigo");
      pausaPerguntada = ""; // deixa perguntar de novo se a decisão falhou
    }
  };

  abrirModal({
    chapeu: "Pausa programada",
    titulo: "Deseja continuar a busca?",
    corpo: el("div", { style: "display:flex;flex-direction:column;gap:10px" },
      el("p", { style: "font-size:.92rem;line-height:1.6" },
        `Já observei `, el("strong", {}, `${formatarNumero(leitura.total)} produtos`),
        ` e pausei como você configurou. Se continuar, sigo buscando sem repetir nada do que já foi lido${configuracao.pausarAtivo ? ` e pauso de novo depois de mais ${formatarNumero(configuracao.pausarA)}` : ""}.`),
      el("p", { style: "font-size:.8rem;color:var(--texto-suave)" },
        "Se finalizar, passo direto pra leitura dos detalhes dos produtos já encontrados."),
    ),
    rodape: [
      el("button", { classe: "botao", aoClicar: () => decidir(false) }, `Finalizar com ${formatarNumero(leitura.total)}`),
      el("button", { classe: "botao primario", aoClicar: () => decidir(true) }, icone("lupa"), "Continuar a busca"),
    ],
    aoFechar: () => { /* a faixa de andamento mantém o botão de responder */ },
  });
}

function acompanhar() {
  if (cronometroLeitura) clearInterval(cronometroLeitura);
  cronometroLeitura = setInterval(async () => {
    if (!leitura || !["queued", "running", "paused"].includes(leitura.status)) {
      clearInterval(cronometroLeitura);
      cronometroLeitura = null;
      return;
    }
    try {
      leitura = await acompanharLeituraPublica(leitura.id);
      guardarLeitura();
      desenharAndamento();
      if (leitura.status === "paused") {
        perguntarSobrePausa();
        publicarAviso({
          id: "leitura-publica",
          importante: true,
          texto: `Consulta pausada em ${formatarNumero(leitura.total)} produtos: aguardando sua decisão`,
          detalhes: "A pausa programada foi atingida. Volte à aba Consultas públicas e responda se deseja continuar a busca ou finalizar com o que já foi encontrado.",
        });
      }
      if (leitura.status === "completed") {
        contextoGlobal.registrar("unofficial.complete", {
          targetType: "public-page", targetId: leitura.id,
          metadata: { total: leitura.items.length, pix: leitura.items.filter((item) => item.pixObserved).length },
        });
        compararComArquivo();
        desenharResultados();
        avisar(`Leitura concluída: ${leitura.items.length} anúncios observados.`, "sucesso");
        const comPix = leitura.items.filter((item) => item.pixObserved).length;
        publicarAviso({
          id: "leitura-publica",
          importante: leitura.partial,
          texto: leitura.partial
            ? `Consulta pública concluída PARCIALMENTE: ${leitura.items.length} anúncios lidos`
            : `Consulta pública concluída: ${leitura.items.length} anúncios · ${comPix} com Pix`,
          detalhes: leitura.partial
            ? `A consulta terminou, mas algumas páginas ficaram bloqueadas pelo Mercado Livre mesmo após as novas tentativas com espera longa. Os ${leitura.items.length} anúncios lidos foram preservados. Espere alguns minutos antes de repetir a consulta — insistir logo em seguida aumenta o bloqueio.`
            : `Foram observados ${leitura.items.length} anúncios em ${leitura.pagesRead} página(s), ${comPix} com menção a Pix. Os resultados estão na aba Consultas públicas, com filtros, ordenação e exportação em CSV.`,
        });
      } else if (leitura.status === "auth_required") {
        desenharResultados();
        publicarAviso({
          id: "leitura-publica",
          importante: true,
          texto: "A consulta pública precisa de login pra continuar",
          detalhes: "O Mercado Livre pediu autenticação no meio da leitura. Faça login na conta oficial e use o botão “Retomar consulta” na aba Consultas públicas — ela continua do ponto em que parou, sem perder nada.",
        });
      } else if (["failed", "cancelled"].includes(leitura.status)) {
        desenharResultados();
        if (leitura.status === "failed") {
          publicarAviso({
            id: "leitura-publica",
            importante: true,
            texto: "A consulta pública não pôde ser concluída",
            detalhes: `${leitura.phase || leitura.error || "Falha na leitura pública."} Os anúncios já lidos (se houver) continuam salvos no navegador. Aguarde alguns minutos antes de tentar de novo.`,
          });
        }
      }
    } catch (motivo) {
      if (motivo?.codigo === "SCAN_NOT_FOUND") {
        // o serviço local reiniciou no meio; preservo o que já veio
        leitura = { ...leitura, status: "failed", waiting: false, phase: "A consulta anterior foi encerrada pelo serviço local." };
        guardarLeitura();
        desenharAndamento();
        desenharResultados();
      }
    }
  }, 800);
}

// Comparo a consulta nova com uma arquivada da mesma origem (se tiver)
function compararComArquivo() {
  const chave = leitura.mode === "product" ? leitura.query ?? "" : leitura.sourceUrl;
  const antiga = arquivadas.find((arquivo) => arquivo.consulta === chave);
  if (!antiga || !leitura.items.length) return;

  const idsAntigos = new Set(antiga.itens.map((item) => item.id));
  const idsNovos = new Set(leitura.items.map((item) => item.id));
  const iguais = [...idsNovos].filter((id) => idsAntigos.has(id)).length;
  if (iguais / Math.max(idsNovos.size, 1) < 0.8) return; // consultas diferentes demais, não comparo

  const novos = [...idsNovos].filter((id) => !idsAntigos.has(id)).length;
  const sumiram = [...idsAntigos].filter((id) => !idsNovos.has(id)).length;
  const precoMudou = leitura.items.filter((item) => {
    const antigo = antiga.itens.find((outro) => outro.id === item.id);
    return antigo && antigo.price !== item.price;
  }).length;

  if (!novos && !sumiram && !precoMudou) {
    avisoComparacao = "Nenhuma mudança em relação à consulta arquivada: os dados continuam iguais.";
  } else {
    const partes = [`${Math.round((iguais / idsNovos.size) * 100)}% igual à consulta arquivada`];
    if (novos) partes.push(`${novos} novos`);
    if (sumiram) partes.push(`${sumiram} sumiram`);
    if (precoMudou) partes.push(`${precoMudou} com preço diferente`);
    avisoComparacao = partes.join(" · ");
  }
}

function desenharAndamento() {
  const area = document.getElementById("area-andamento");
  if (!area) return;
  area.replaceChildren();
  if (!leitura) return;

  if (["queued", "running"].includes(leitura.status)) {
    const progresso = Math.max(0, Math.min(100, leitura.progress ?? 0));
    area.append(el("div", { classe: "progresso-leitura" },
      el("div", { classe: "linha-fase" },
        leitura.waiting ? icone("relogio") : (() => { const giro = icone("sincronizar"); giro.classList.add("girando"); return giro; })(),
        el("span", {},
          el("strong", {}, leitura.phase || "Lendo a página…"),
          el("small", {}, leitura.waiting
            ? `Pausa de segurança · ${((leitura.cooldownMs || 0) / 1000).toFixed(1)} s programados`
            : `${leitura.processed} de ${leitura.total || "—"} anúncios · ${leitura.pagesRead || 0} página(s) lida(s)`)),
        el("b", {}, `${progresso}%`),
      ),
      el("div", { classe: "progresso" }, el("i", { style: `width:${progresso}%` })),
      el("div", { style: "display:flex;justify-content:flex-end;margin-top:8px" },
        el("button", { classe: "botao-texto", aoClicar: async () => {
          try {
            const csrf = await contextoGlobal.garantirCsrf();
            leitura = await cancelarLeituraPublica(csrf, leitura.id);
            guardarLeitura();
            desenharAndamento();
            desenharResultados();
          } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
        } }, "Cancelar consulta")),
    ));
    return;
  }

  if (leitura.status === "paused") {
    area.append(el("div", { classe: "aviso info" }, icone("relogio"),
      el("div", { style: "flex:1" },
        el("strong", { style: "display:block" }, `Pausado em ${formatarNumero(leitura.total)} produtos, como você configurou.`),
        el("span", {}, "A busca está esperando sua decisão — nada se perde enquanto isso.")),
      el("button", { classe: "botao pequeno primario", aoClicar: () => { pausaPerguntada = ""; perguntarSobrePausa(); } }, "Responder"),
    ));
  }

  if (leitura.status === "auth_required") {
    area.append(el("div", { classe: "aviso atencao" }, icone("alerta"),
      el("div", { style: "flex:1" },
        el("strong", { style: "display:block" }, "O Mercado Livre pediu autenticação."),
        el("span", {}, "Faça login na conta oficial e depois retome a consulta do ponto em que parou.")),
      !contextoGlobal.conectado && contextoGlobal.aplicativoPronto
        ? el("a", { classe: "botao pequeno", href: enderecoConexaoOficial() }, "Fazer login")
        : null,
      el("button", { classe: "botao pequeno primario", aoClicar: async () => {
        try {
          const csrf = await contextoGlobal.garantirCsrf();
          leitura = await retomarLeituraPublica(csrf, leitura.id);
          guardarLeitura();
          desenharAndamento();
          acompanhar();
        } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
      } }, "Retomar consulta"),
    ));
  }

  if (leitura.status === "failed" && leitura.error) {
    area.append(el("div", { classe: "aviso perigo" }, icone("alerta"), leitura.phase || leitura.error));
  }
}

// ============================================================
// Resultados observados
// ============================================================

function itensVisiveis() {
  const busca = visaoObservados.busca.toLowerCase();
  const vendedor = visaoObservados.vendedor.toLowerCase();
  const precoMinimo = Number(visaoObservados.precoMinimo);
  const precoMaximo = Number(visaoObservados.precoMaximo);
  const vendasMinimas = Number(visaoObservados.vendasMinimas);

  const filtrados = (leitura?.items ?? []).filter((item) => {
    if (busca && ![item.id, item.title, item.categoryId, item.catalogProductId].some((valor) => valor?.toLowerCase().includes(busca))) return false;
    if (vendedor && ![item.seller?.nickname, item.seller?.id].some((valor) => String(valor ?? "").toLowerCase().includes(vendedor))) return false;
    if (visaoObservados.precoMinimo && !(item.price != null && item.price >= precoMinimo)) return false;
    if (visaoObservados.precoMaximo && !(item.price != null && item.price <= precoMaximo)) return false;
    if (visaoObservados.vendasMinimas && !(item.soldQuantity != null && item.soldQuantity >= vendasMinimas)) return false;
    const filtro = visaoObservados.filtro;
    if (filtro === "pix") return item.pixObserved === true;
    if (filtro === "sem_pix") return item.pixObserved === false;
    if (filtro === "catalogo") return item.catalogListing;
    if (filtro === "fora_catalogo") return !item.catalogListing;
    if (filtro === "novos") return item.condition === "new";
    if (filtro === "usados") return item.condition === "used";
    if (filtro === "frete_gratis") return item.shipping?.freeShipping === true;
    if (filtro === "com_estoque") return (item.availableQuantity ?? 0) > 0;
    if (filtro === "com_avaliacao") return (item.rating ?? 0) > 0;
    if (filtro === "com_erro") return Boolean(item.error);
    return true;
  });

  return filtrados.sort((a, b) => {
    const ordem = visaoObservados.ordenacao;
    if (ordem === "mais_vendidos") return (b.soldQuantity ?? -1) - (a.soldQuantity ?? -1);
    if (ordem === "menor_preco") return (a.price ?? Infinity) - (b.price ?? Infinity);
    if (ordem === "maior_preco") return (b.price ?? -1) - (a.price ?? -1);
    if (ordem === "mais_recentes") return new Date(b.dateCreated ?? 0) - new Date(a.dateCreated ?? 0);
    if (ordem === "maior_desconto") {
      const desconto = (item) => item.originalPrice && item.price ? 1 - item.price / item.originalPrice : 0;
      return desconto(b) - desconto(a);
    }
    if (ordem === "melhor_avaliacao") return (b.rating ?? 0) - (a.rating ?? 0);
    return a.sourceRank - b.sourceRank;
  });
}

function desenharResultados() {
  const area = document.getElementById("area-resultados");
  if (!area) return;
  area.replaceChildren();

  const itens = leitura?.items ?? [];
  if (!itens.length) {
    if (!leitura || ["failed", "cancelled"].includes(leitura?.status)) {
      area.append(estadoVazio("radar", "Nenhuma leitura por enquanto",
        "Preencha o formulário acima e comece uma consulta. Os resultados aparecem aqui em cartões, com filtros e ordenação."));
    }
    return;
  }

  if (avisoComparacao) {
    area.append(el("div", { classe: "aviso info" }, icone("info"), avisoComparacao));
  }

  const comPix = itens.filter((item) => item.pixObserved).length;
  const visiveis = itensVisiveis();
  const idsVisiveis = visiveis.map((item) => item.id);
  const todosMarcados = idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionados.has(id));

  const selecionarTodosVisiveis = () => {
    if (todosMarcados) {
      idsVisiveis.forEach((id) => selecionados.delete(id));
    } else {
      idsVisiveis.forEach((id) => selecionados.add(id));
    }
    salvar("marketsync_publico_selecao", [...selecionados]);
    desenharResultados();
  };

  const limparSelecao = () => {
    selecionados = new Set();
    salvar("marketsync_publico_selecao", []);
    desenharResultados();
  };

  area.append(el("div", { classe: "cabeca-painel" },
    el("div", { classe: "lado-esquerdo" },
      el("div", {},
        el("strong", {}, `${formatarNumero(itens.length)} anúncios observados`),
        el("div", { style: "font-size:.78rem;color:var(--texto-suave)" },
          leitura.mode === "product" ? `Ofertas públicas para "${leitura.query}"` : `${leitura.pagesRead || 1} página(s) da loja`,
          ` · ${comPix} com Pix explícito · ${selecionados.size} selecionado(s)`)),
    ),
    el("div", { classe: "lado-direito", style: "gap:8px;align-items:center" },
      el("button", { classe: "botao pequeno discreto", aoClicar: selecionarTodosVisiveis },
        caixaMarcar(todosMarcados, selecionarTodosVisiveis).elemento,
        el("span", { style: "margin-left:4px" }, `Todos (${formatarNumero(idsVisiveis.length)})`)),
      selecionados.size > 0
        ? [
          el("span", { style: "font-size:.82rem;color:var(--texto-suave)" }, `${selecionados.size} selecionado(s)`),
          el("button", { classe: "botao pequeno", aoClicar: exportarObservados }, icone("baixar"), "Exportar selecionados"),
          el("button", { classe: "botao pequeno discreto", aoClicar: limparSelecao }, "Limpar"),
        ]
        : [
          el("button", { classe: "botao pequeno", aoClicar: exportarObservados }, icone("baixar"), "Exportar CSV"),
        ],
      montarTerminalBotao(),
    ),
  ));

  // Terminal de logs visível quando houver erros
  const registros = leitura?.logs ?? [];
  const temErros = registros.some((r) => r.level === "error");
  if (temErros) {
    area.append(el("div", { classe: "terminal-leitura" },
      registros.filter((r) => r.level === "error" || r.level === "warning")
        .slice(-15)
        .map((registro) => el("div", { classe: registro.level === "error" ? "erro" : "aviso-log" },
          el("time", {}, new Date(registro.at).toLocaleTimeString("pt-BR")),
          registro.message)),
    ));
  }

  // Filtros avançados
  const campo = (rotulo, chave, tipo = "text", extra = {}) => el("label", { classe: `campo ${chave === "busca" ? "crescer" : ""}` },
    el("span", {}, rotulo),
    el("input", { type: tipo, value: visaoObservados[chave], ...extra,
      aoDigitar: aguardarDigitacao((evento) => {
        visaoObservados[chave] = evento.target.value.trim();
        visaoObservados.pagina = 1;
        desenharResultados();
      }, 300) }),
  );

  area.append(el("div", { classe: "filtros-observados" },
    campo("Buscar título ou MLB", "busca"),
    campo("Vendedor", "vendedor"),
    campo("Preço mín.", "precoMinimo", "number", { min: "0" }),
    campo("Preço máx.", "precoMaximo", "number", { min: "0" }),
    campo("Vendas mín.", "vendasMinimas", "number", { min: "0" }),
    el("label", { classe: "campo" },
      el("span", {}, "Mostrar"),
      el("select", { aoMudar: (evento) => { visaoObservados.filtro = evento.target.value; visaoObservados.pagina = 1; desenharResultados(); } },
        [["todos", "Todos"], ["pix", "Pix observado"], ["sem_pix", "Sem Pix explícito"], ["catalogo", "Somente catálogo"],
         ["fora_catalogo", "Fora do catálogo"], ["novos", "Produtos novos"], ["usados", "Produtos usados"],
         ["frete_gratis", "Frete grátis"], ["com_estoque", "Com estoque"], ["com_avaliacao", "Com avaliação"],
         ["com_erro", "Com erro de leitura"]].map(([valor, rotulo]) =>
          el("option", { value: valor, selected: visaoObservados.filtro === valor }, rotulo)))),
    el("label", { classe: "campo" },
      el("span", {}, "Ordenar"),
      el("select", { aoMudar: (evento) => { visaoObservados.ordenacao = evento.target.value; visaoObservados.pagina = 1; desenharResultados(); } },
        [["origem", "Ordem encontrada"], ["mais_vendidos", "Mais vendidos"], ["menor_preco", "Menor preço"],
         ["maior_preco", "Maior preço"], ["maior_desconto", "Maior desconto"], ["melhor_avaliacao", "Melhor avaliação"],
         ["mais_recentes", "Mais recentes"]].map(([valor, rotulo]) =>
          el("option", { value: valor, selected: visaoObservados.ordenacao === valor }, rotulo)))),
  ));

  if (!visiveis.length) {
    area.append(estadoVazio("lupa", "Nada bate com os filtros", "Afrouxe algum critério pra ver os anúncios observados."));
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / visaoObservados.tamanhoPagina));
  visaoObservados.pagina = Math.min(visaoObservados.pagina, totalPaginas);
  const daPagina = visiveis.slice(
    (visaoObservados.pagina - 1) * visaoObservados.tamanhoPagina,
    visaoObservados.pagina * visaoObservados.tamanhoPagina,
  );

  area.append(el("div", { classe: "grade-observados" }, daPagina.map(montarCartaoObservado)));

  area.append(montarPaginacao({
    pagina: visaoObservados.pagina,
    totalPaginas,
    total: visiveis.length,
    tamanhoPagina: visaoObservados.tamanhoPagina,
    aoTrocarPagina: (pagina) => { visaoObservados.pagina = Math.max(1, Math.min(pagina, totalPaginas)); desenharResultados(); },
    aoTrocarTamanho: (tamanho) => { visaoObservados.tamanhoPagina = tamanho; visaoObservados.pagina = 1; desenharResultados(); },
    tamanhos: [30, 60, 100, 200],
  }));
}

function montarTerminalBotao() {
  const registros = leitura?.logs ?? [];
  const erros = registros.filter((registro) => registro.level === "error");
  if (!registros.length) return null;
  return el("button", { classe: "botao pequeno discreto", aoClicar: () => {
    abrirModal({
      chapeu: "Processo da leitura",
      titulo: erros.length ? `Registros (${erros.length} erro(s))` : "Registros",
      tamanho: "largo",
      corpo: el("div", { classe: "terminal-leitura", style: "max-height:420px" },
        registros.map((registro) => el("div", { classe: registro.level === "error" ? "erro" : registro.level === "warning" ? "aviso-log" : "" },
          el("time", {}, new Date(registro.at).toLocaleTimeString("pt-BR")),
          registro.message)),
      ),
    });
  } }, icone("historico"), erros.length ? `Processo (${erros.length}⚠)` : "Processo");
}

function montarCartaoObservado(item) {
  const desconto = percentualDesconto(item.originalPrice, item.price);
  const marcador = caixaMarcar(selecionados.has(item.id), (marcado) => {
    if (marcado) selecionados.add(item.id);
    else selecionados.delete(item.id);
    salvar("marketsync_publico_selecao", [...selecionados]);
    cartao.classList.toggle("selecionado", marcado);
  });
  marcador.elemento.classList.add("marcar-cartao");

  const cartao = el("article", {
    classe: `cartao-observado ${selecionados.has(item.id) ? "selecionado" : ""}`,
    aoClicar: () => abrirDetalheObservado(item),
  },
    el("div", { classe: "foto" },
      marcador.elemento,
      item.thumbnail ? el("img", { src: item.thumbnail, alt: item.title, loading: "lazy" }) : icone("caixa"),
      el("div", { classe: "selos-foto" },
        item.catalogListing ? el("span", { classe: "selo azul" }, icone("trofeu"), "Catálogo") : null,
        item.pixObserved != null
          ? el("span", { classe: `selo selo-pix ${item.pixObserved ? "sim" : "nao"}` }, item.pixObserved ? "Pix ✓" : "sem Pix")
          : null,
      ),
    ),
    el("div", { classe: "corpo" },
      el("div", { classe: "titulo" }, item.title),
      el("div", { classe: "preco" },
        formatarMoeda(item.price),
        desconto ? el("del", {}, formatarMoeda(item.originalPrice)) : null,
        desconto ? el("span", { classe: "desconto" }, `−${desconto}%`) : null,
      ),
      el("div", { classe: "metricas" },
        item.soldQuantity != null ? el("span", {}, icone("grafico"), `${formatarNumero(item.soldQuantity)} vendidos`) : null,
        item.rating ? el("span", {}, icone("estrela"), `${item.rating.toFixed(1)}${item.reviewCount ? ` (${formatarNumero(item.reviewCount)})` : ""}`) : null,
        item.shipping?.freeShipping ? el("span", {}, icone("caminhao"), "frete grátis") : null,
      ),
      item.seller?.nickname ? el("div", { classe: "vendedor" }, `Vendido por ${item.seller.nickname}`) : null,
      item.error ? el("div", { classe: "rodape-cartao" }, el("span", { classe: "selo vermelho" }, "leitura incompleta")) : null,
    ),
  );
  return cartao;
}

// ----- Detalhe de um anúncio observado -----

function abrirDetalheObservado(item) {
  const fotos = item.pictures?.length ? item.pictures : (item.thumbnail ? [item.thumbnail] : []);
  const fotoPrincipal = fotos.length ? el("img", { src: fotos[0], alt: item.title }) : null;
  const desconto = percentualDesconto(item.originalPrice, item.price);

  const lateral = el("aside", { classe: "midia-detalhe" },
    fotoPrincipal ?? el("div", { classe: "miniatura-vazia", style: "width:100%;aspect-ratio:1" }, icone("caixa")),
    fotos.length > 1 ? el("div", { classe: "tira-fotos" }, fotos.map((foto, indice) =>
      el("img", { src: foto, alt: "", classe: indice === 0 ? "escolhida" : "", aoClicar: (evento) => {
        fotoPrincipal.src = foto;
        lateral.querySelectorAll(".tira-fotos img").forEach((imagem) => imagem.classList.remove("escolhida"));
        evento.currentTarget.classList.add("escolhida");
      } }))) : null,
    el("div", { classe: "bloco-preco" },
      el("strong", {}, formatarMoeda(item.price)),
      desconto ? el("del", {}, formatarMoeda(item.originalPrice)) : null,
      desconto ? el("span", { classe: "selo verde" }, `−${desconto}%`) : null,
    ),
    el("div", { classe: `aviso ${item.pixObserved ? "sucesso" : "info"}`, style: "margin-top:12px;margin-bottom:0" },
      icone(item.pixObserved ? "confere" : "ajuda"),
      el("div", {},
        el("strong", { style: "display:block;font-size:.82rem" },
          item.pixObserved ? "Pix explícito observado" : item.pixObserved === false ? "Pix explícito não encontrado" : "Pix não verificado"),
        item.pixEvidence ? el("span", { style: "font-size:.76rem" }, item.pixEvidence) : null)),
  );

  const gruposInfo = [
    ["Anúncio", [["MLB", item.id], ["Condição", nomeCondicao(item.condition)], ["Tipo", item.listingTypeId], ["Categoria", item.categoryId], ["Garantia", item.warranty]]],
    ["Catálogo", [["Participa", item.catalogListing ? "Sim" : "Não"], ["Produto", item.catalogProductId]]],
    ["Vendedor", [["Nome", item.seller?.nickname], ["ID", item.seller?.id]]],
    ["Entrega", [["Frete grátis", item.shipping?.freeShipping == null ? null : item.shipping.freeShipping ? "Sim" : "Não"], ["Modo", item.shipping?.mode], ["Logística", item.shipping?.logisticType]]],
    ["Números observados", [["Estoque", formatarNumero(item.availableQuantity)], ["Vendidos", formatarNumero(item.soldQuantity)], ["Avaliação", item.rating ? `${item.rating.toFixed(1)} (${formatarNumero(item.reviewCount)} avaliações)` : null]]],
  ];

  const areaAba = el("div", { style: "margin-top:14px" });
  const barraAbas = el("div", { classe: "abas" });
  const abas = [
    ["informacoes", "Informações"],
    ["descricao", "Descrição"],
    ["fotos", `Fotos (${item.pictures?.length ?? 0})`],
    ["ficha", `Ficha (${item.attributes?.length ?? 0})`],
    item.catalogProductId ? ["disputa", "Disputa de catálogo"] : null,
  ].filter(Boolean);

  const mostrarAba = (chave) => {
    barraAbas.querySelectorAll("button").forEach((botao) => botao.classList.toggle("ativa", botao.dataset.aba === chave));
    if (chave === "informacoes") {
      areaAba.replaceChildren(el("div", { classe: "grade-informacoes" },
        gruposInfo.map(([titulo, linhas]) => el("section", {},
          el("h4", {}, titulo),
          linhas.filter(([, valor]) => valor != null && valor !== "" && valor !== "—").map(([rotulo, valor]) =>
            el("div", {}, el("span", {}, rotulo), el("strong", {}, String(valor)))))),
      ));
    } else if (chave === "descricao") {
      areaAba.replaceChildren(el("div", { classe: "descricao-anuncio" },
        item.description || "A descrição não apareceu na página pública deste anúncio."));
    } else if (chave === "fotos") {
      areaAba.replaceChildren(item.pictures?.length
        ? el("div", { classe: "galeria-fotos" }, item.pictures.map((foto, indice) =>
            el("a", { href: foto, target: "_blank", rel: "noreferrer" }, el("img", { src: foto, alt: `${item.title} ${indice + 1}`, loading: "lazy" }))))
        : estadoVazio("imagem", "Nenhuma foto adicional"));
    } else if (chave === "ficha") {
      areaAba.replaceChildren(item.attributes?.length
        ? el("div", { classe: "ficha-tecnica" }, item.attributes.map((atributo) =>
            el("div", {}, el("span", {}, atributo.name), el("strong", {}, atributo.value))))
        : estadoVazio("caixa", "A ficha técnica não apareceu na leitura pública"));
    } else if (chave === "disputa") {
      areaAba.replaceChildren(el("div", { classe: "pensando" }, "Buscando participantes do catálogo…"));
      buscarParticipantesCatalogo(item.catalogProductId)
        .then((resposta) => {
          areaAba.replaceChildren(montarRanking({
            available: true,
            catalogProductId: item.catalogProductId,
            participants: resposta.participants ?? [],
          }));
        })
        .catch((motivo) => areaAba.replaceChildren(el("div", { classe: "aviso atencao" }, icone("alerta"), erroAmigavel(motivo))));
    }
  };
  for (const [chave, rotulo] of abas) {
    barraAbas.append(el("button", { dataset: { aba: chave }, aoClicar: () => mostrarAba(chave) }, rotulo));
  }

  const conteudo = el("div", { classe: "conteudo-detalhe" },
    el("h3", {}, item.title, " ", botaoCopiar(item.title, "Copiar título")),
    el("div", { classe: "identificadores" },
      el("span", {}, el("code", {}, item.id), " ", botaoCopiar(item.id, "Copiar MLB")),
      item.permalink ? el("a", { classe: "botao pequeno", href: item.permalink, target: "_blank", rel: "noreferrer" }, "Abrir página oficial", icone("externo")) : null,
    ),
    barraAbas,
    areaAba,
    item.checkedAt ? el("p", { style: "font-size:.72rem;color:var(--texto-fraco);margin-top:12px" }, `Dados observados em ${formatarData(item.checkedAt, true)}`) : null,
  );

  abrirModal({
    chapeu: "Anúncio observado",
    titulo: item.id,
    tamanho: "gigante",
    corpo: el("div", { classe: "detalhe-anuncio" }, lateral, conteudo),
  });
  mostrarAba("informacoes");
}

// ----- Exportação CSV dos observados -----

function exportarObservados() {
  const base = selecionados.size
    ? (leitura?.items ?? []).filter((item) => selecionados.has(item.id))
    : itensVisiveis();
  if (!base.length) { avisar("Nada pra exportar.", "info"); return; }

  const linhas = [["MLB", "Título", "Preço", "Preço original", "Desconto %", "Vendidos", "Estoque", "Avaliação", "Pix observado", "Catálogo", "Frete grátis", "Vendedor", "Condição", "Link"]];
  for (const item of base) {
    linhas.push([
      item.id,
      `"${(item.title ?? "").replace(/"/g, '""')}"`,
      item.price ?? "",
      item.originalPrice ?? "",
      percentualDesconto(item.originalPrice, item.price) || "",
      item.soldQuantity ?? "",
      item.availableQuantity ?? "",
      item.rating ?? "",
      item.pixObserved == null ? "" : item.pixObserved ? "sim" : "não",
      item.catalogListing ? "sim" : "não",
      item.shipping?.freeShipping ? "sim" : "não",
      item.seller?.nickname ?? "",
      nomeCondicao(item.condition),
      item.permalink ?? "",
    ]);
  }
  baixarArquivo(`consulta-publica-${new Date().toISOString().slice(0, 10)}.csv`, linhas.map((linha) => linha.join(";")).join("\n"));
  avisar(`${base.length} anúncio(s) exportado(s).`, "sucesso");
  contextoGlobal.registrar("export.start", { metadata: { origem: "publico", total: base.length } });
}

// ----- Consultas arquivadas -----

function desenharArquivadas() {
  if (!arquivadas.length) {
    raiz.append(estadoVazio("arquivo", "Nenhuma consulta arquivada",
      "Quando você começa uma consulta nova, o sistema oferece arquivar a anterior. As arquivadas ficam aqui, salvas neste navegador."));
    return;
  }

  raiz.append(el("div", { style: "display:flex;flex-direction:column;gap:10px" },
    arquivadas.map((arquivo) => el("div", { classe: "cartao-arquivado" },
      icone("arquivo"),
      el("div", { classe: "info-arquivo" },
        el("strong", {}, arquivo.consulta || "(sem identificação)"),
        el("small", {}, `${arquivo.modo === "product" ? "Busca por produto" : "Leitura de loja"} · arquivada em ${formatarData(arquivo.data, true)}`),
      ),
      el("div", { classe: "numeros" },
        el("span", {}, el("b", {}, formatarNumero(arquivo.itens.length)), " anúncios"),
        el("span", {}, el("b", {}, formatarNumero(arquivo.comPix)), " com Pix"),
        el("span", {}, el("b", {}, formatarNumero(arquivo.paginasLidas)), " páginas"),
      ),
      el("div", { style: "display:flex;gap:6px" },
        el("button", { classe: "botao pequeno", aoClicar: () => {
          // Restauro a consulta arquivada como se fosse a atual
          leitura = {
            id: arquivo.id, mode: arquivo.modo, sourceUrl: arquivo.modo === "seller" ? arquivo.consulta : "",
            query: arquivo.modo === "product" ? arquivo.consulta : null,
            status: "completed", phase: "", progress: 100, processed: arquivo.itens.length,
            total: arquivo.itens.length, pagesRead: arquivo.paginasLidas, waiting: false,
            cooldownMs: 0, partial: false, inspectPix: true, limitMode: "limited",
            items: arquivo.itens, logs: [],
          };
          guardarLeitura();
          avisoComparacao = null;
          abaAtiva = "consulta";
          visaoObservados.pagina = 1;
          desenhar();
        } }, icone("olho"), "Reabrir"),
        el("button", { classe: "botao pequeno perigoso", aoClicar: async () => {
          if (!(await confirmar({ titulo: "Excluir consulta arquivada", mensagem: "Essa consulta arquivada será removida deste navegador. Não dá pra desfazer.", textoConfirmar: "Excluir", perigoso: true }))) return;
          arquivadas = arquivadas.filter((outro) => outro !== arquivo);
          salvar("marketsync_publico_arquivo", arquivadas);
          desenhar();
        } }, icone("lixeira")),
      ),
    )),
  ));
}
