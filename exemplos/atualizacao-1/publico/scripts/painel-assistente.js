// ============================================================
// painel-assistente.js — o AlphaBot IA. Conversas salvas no
// serviço local, resposta em streaming (dá pra ver o raciocínio
// chegando), anexo de imagens por clique, colagem ou arraste.
// ============================================================

import { el, icone, markdownSimples, tempoRelativo, formatarDuracao, formatarNumero } from "./utilitarios.js";
import {
  listarConversas, criarConversa, buscarMensagens, atualizarConversa,
  excluirConversa, enviarMensagemIa, erroAmigavel,
} from "./api.js";
import { avisar, confirmar, abrirMenuSuspenso, estadoVazio } from "./componentes.js";

let contextoGlobal = null;

// Estado da tela
let conversas = [];
let conversaAtual = null;   // objeto da conversa aberta
let mensagens = [];
let anexos = [];            // imagens esperando envio
let ocupado = false;        // tem resposta chegando agora
let vendoArquivadas = false;

// Referências de elementos que atualizo o tempo todo
let areaMensagens, areaLista, caixaTexto, botaoEnviar, areaAnexos, lateralConversas;
let elementoTokens = null;

// Sugestões ligadas a EVENTOS do sistema: pergunta de comprador esperando
// rascunho (veio da aba Perguntas · SAC) e consulta pública recém-concluída.
// Elas furam a fila das sugestões normais quando existem.
function sugestoesDeEventos() {
  const sugestoes = [];
  try {
    const rascunho = JSON.parse(sessionStorage.getItem("marketsync_rascunho_pergunta") ?? "null");
    if (rascunho?.pergunta) {
      sessionStorage.removeItem("marketsync_rascunho_pergunta");
      sugestoes.push(`Escreva uma resposta educada e vendedora pra esta pergunta de comprador no anúncio "${rascunho.anuncio}": "${rascunho.pergunta}"`);
    }
  } catch { /* rascunho corrompido, ignoro */ }
  try {
    const leitura = JSON.parse(localStorage.getItem("marketsync_publico_leitura") ?? "null");
    if (leitura?.items?.length && leitura.status === "completed") {
      const origem = leitura.mode === "product" ? `a busca "${leitura.query}"` : "a loja observada";
      sugestoes.push(`Acabei de observar ${leitura.items.length} anúncios em ${origem}. Que padrões de preço e título valem a pena analisar?`);
    }
  } catch { /* sem leitura salva */ }
  return sugestoes;
}

// Baralho de ideias sorteadas pra completar as quatro sugestões
const baralhoDeIdeias = [
  "Como faço meu anúncio aparecer melhor na busca do Mercado Livre?",
  "Escreva um título de anúncio pra um kit de ferramentas 110 peças",
  "Quais erros derrubam a reputação de um vendedor no Mercado Livre?",
  "Vale a pena anunciar no Premium ou no Clássico? Compare os dois",
  "Como precificar pra ganhar no catálogo sem destruir a margem?",
  "Me dê um checklist pra fotos de produto que convertem mais",
];

function saudacaoPorHorario() {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function sugestoesContextuais() {
  // Eventos pontuais entram primeiro, depois completo com o que faz
  // sentido pro estado da conta e com ideias sorteadas do baralho
  const sugestoes = sugestoesDeEventos();
  const porEstado = contextoGlobal?.conectado
    ? [
        "Analise o desempenho dos meus anúncios",
        "Como melhorar o ranqueamento no catálogo?",
        "O que é Buy Box e como disputar?",
        "Escreva uma descrição persuasiva para meu produto",
      ]
    : contextoGlobal?.aplicativoPronto
      ? [
          "Como conectar minha conta do Mercado Livre?",
          "O que o MarketSync faz pelos meus anúncios?",
          "Preciso de ajuda para melhorar minhas vendas",
          "Como funciona a precificação e o catálogo?",
        ]
      : [];
  const baralho = [...porEstado, ...baralhoDeIdeias];
  while (sugestoes.length < 4 && baralho.length) {
    // As duas primeiras do estado atual entram na ordem; o resto é sorteado
    const posicao = sugestoes.length < 2 && porEstado.length ? 0 : Math.floor(Math.random() * baralho.length);
    sugestoes.push(baralho.splice(posicao, 1)[0]);
  }
  return sugestoes;
}

function subtituloContextual() {
  const nome = contextoGlobal?.conta?.nickname;
  if (contextoGlobal?.conectado && nome) {
    return `Conta ${nome} conectada. Posso analisar seus anúncios, escrever títulos e descrições, e tirar dúvidas sobre o Mercado Livre. Também leio imagens e arquivos que você anexar aqui.`;
  }
  if (contextoGlobal?.aplicativoPronto) {
    return "Sou a assistente do MarketSync. Conecte sua conta do Mercado Livre para eu te ajudar com anúncios, precificação e catálogo.";
  }
  return "Sou a assistente do MarketSync. Assim que o serviço estiver pronto, conecte sua conta para começar.";
}

export function iniciarPainelAssistente(contexto, secao) {
  contextoGlobal = contexto;
  montarEstrutura(secao);
  carregarConversas();
}

// ----- Estrutura -----

function montarEstrutura(secao) {
  areaLista = el("div", { classe: "lista-conversas" });
  areaMensagens = el("div", { classe: "mensagens" });
  areaAnexos = el("div", { classe: "anexos-pendentes" });

  caixaTexto = el("textarea", {
    rows: 1,
    placeholder: "Pergunte alguma coisa ou cole uma imagem…",
    aoDigitar: () => {
      caixaTexto.style.height = "auto";
      caixaTexto.style.height = `${Math.min(caixaTexto.scrollHeight, 150)}px`;
      atualizarBotaoEnviar();
    },
    aoTeclar: (evento) => {
      if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        enviar();
      }
    },
  });
  caixaTexto.addEventListener("paste", (evento) => {
    const arquivos = [...(evento.clipboardData?.files ?? [])];
    if (arquivos.length) { evento.preventDefault(); adicionarAnexos(arquivos); }
  });

  const entradaImagem = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true });
  entradaImagem.addEventListener("change", () => { adicionarAnexos([...entradaImagem.files]); entradaImagem.value = ""; });

  const entradaArquivo = el("input", { type: "file", accept: ".pdf,.xlsx,.txt,.md,.csv,.json,.log", multiple: true, hidden: true });
  entradaArquivo.addEventListener("change", () => { adicionarAnexos([...entradaArquivo.files]); entradaArquivo.value = ""; });

  botaoEnviar = el("button", { classe: "botao-enviar", disabled: true, "aria-label": "Enviar", aoClicar: enviar }, icone("enviar"));

  lateralConversas = el("aside", { classe: "conversas-lateral" },
    el("div", { classe: "topo-conversas" },
      el("button", { classe: "botao primario", aoClicar: () => { abrirConversa(null); fecharLateralNoCelular(); } }, icone("mais"), "Nova conversa"),
    ),
    areaLista,
    el("div", { classe: "rodape-conversas" },
      el("button", { classe: "botao discreto pequeno", style: "width:100%", aoClicar: () => {
        vendoArquivadas = !vendoArquivadas;
        carregarConversas();
      } }, icone("arquivo"), el("span", { id: "rotulo-arquivadas" }, "Ver arquivadas")),
    ),
  );

  const areaConversa = el("div", { classe: "area-conversa" },
    areaMensagens,
    el("div", { classe: "compositor" },
      areaAnexos,
      el("div", { classe: "caixa-compositor" },
        caixaTexto,
        el("button", { classe: "botao-icone", title: "Anexar imagem", aoClicar: () => entradaImagem.click() }, icone("imagem")),
        el("button", { classe: "botao-icone", title: "Anexar arquivo", aoClicar: () => entradaArquivo.click() }, icone("arquivo")),
        botaoEnviar,
      ),
      el("p", { classe: "nota-compositor" },
        el("span", {}, "O AlphaBot IA pode cometer erros. Confira informações importantes antes de aplicar."),
        elementoTokens = el("span", { classe: "tokens-conversa" }, ""),
      ),
    ),
    entradaImagem,
    entradaArquivo,
  );

  // No celular a lista de conversas vira uma gaveta
  const botaoListaMobile = el("button", { classe: "botao pequeno somente-mobile", style: "position:absolute;top:10px;left:10px;z-index:6", aoClicar: () => {
    lateralConversas.classList.toggle("aberta");
  } }, icone("menu"), "Conversas");

  const envoltorio = el("div", { classe: "assistente" }, lateralConversas, areaConversa, botaoListaMobile);

  // Arrastar imagem pra qualquer lugar do chat também anexa
  envoltorio.addEventListener("dragover", (evento) => evento.preventDefault());
  envoltorio.addEventListener("drop", (evento) => {
    evento.preventDefault();
    adicionarAnexos([...(evento.dataTransfer?.files ?? [])]);
  });

  secao.append(envoltorio);
  desenharMensagens();
}

function fecharLateralNoCelular() {
  lateralConversas.classList.remove("aberta");
}

// ----- Conversas -----

async function carregarConversas() {
  const rotulo = document.getElementById("rotulo-arquivadas");
  if (rotulo) rotulo.textContent = vendoArquivadas ? "Ver ativas" : "Ver arquivadas";
  try {
    conversas = (await listarConversas(vendoArquivadas))?.items ?? [];
    desenharListaConversas();
  } catch (motivo) {
    areaLista.replaceChildren(el("div", { classe: "aviso atencao", style: "margin:8px" }, erroAmigavel(motivo)));
  }
}

function desenharListaConversas() {
  areaLista.replaceChildren();
  if (!conversas.length) {
    areaLista.append(el("p", { style: "font-size:.78rem;color:var(--texto-fraco);text-align:center;padding:16px 8px" },
      vendoArquivadas ? "Nenhuma conversa arquivada." : "Suas conversas aparecem aqui."));
    return;
  }
  for (const conversa of conversas) {
    const item = el("button", {
      classe: `item-conversa ${conversaAtual?.id === conversa.id ? "ativa" : ""}`,
      aoClicar: () => { abrirConversa(conversa); fecharLateralNoCelular(); },
    },
      el("span", { classe: "nome" }, conversa.title || "Conversa sem título"),
      el("time", {}, tempoRelativo(conversa.updatedAt)),
      el("span", { classe: "acoes-conversa" },
        el("button", { classe: "botao-icone", style: "width:24px;height:24px", title: "Opções", aoClicar: (evento) => {
          evento.stopPropagation();
          abrirMenuConversa(evento.currentTarget, conversa);
        } }, icone("engrenagem")),
      ),
    );
    areaLista.append(item);
  }
}

function abrirMenuConversa(ancora, conversa) {
  abrirMenuSuspenso(ancora, [
    { icone: "lapis", rotulo: "Renomear", aoClicar: async () => {
      const nome = prompt("Novo nome da conversa:", conversa.title);
      if (!nome?.trim()) return;
      try {
        await atualizarConversa(await contextoGlobal.garantirCsrf(), conversa.id, { title: nome.trim() });
        carregarConversas();
      } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
    } },
    { icone: "arquivo", rotulo: conversa.archived ? "Desarquivar" : "Arquivar", aoClicar: async () => {
      try {
        await atualizarConversa(await contextoGlobal.garantirCsrf(), conversa.id, { archived: !conversa.archived });
        if (conversaAtual?.id === conversa.id) abrirConversa(null);
        carregarConversas();
      } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
    } },
    "separador",
    { icone: "lixeira", rotulo: "Excluir", perigoso: true, aoClicar: async () => {
      if (!(await confirmar({ titulo: "Excluir conversa", mensagem: `“${conversa.title || "Conversa sem título"}” será apagada de vez, com todas as mensagens.`, textoConfirmar: "Excluir", perigoso: true }))) return;
      try {
        await excluirConversa(await contextoGlobal.garantirCsrf(), conversa.id);
        if (conversaAtual?.id === conversa.id) abrirConversa(null);
        carregarConversas();
      } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
    } },
  ]);
}

async function abrirConversa(conversa) {
  conversaAtual = conversa;
  mensagens = [];
  desenharListaConversas();
  if (!conversa) { desenharMensagens(); return; }

  areaMensagens.replaceChildren(el("div", { classe: "pensando", style: "margin:auto" }, "Carregando conversa…"));
  try {
    const resposta = await buscarMensagens(conversa.id);
    mensagens = resposta?.items ?? [];
    desenharMensagens();
  } catch (motivo) {
    areaMensagens.replaceChildren(el("div", { classe: "aviso perigo", style: "margin:20px" }, icone("alerta"), erroAmigavel(motivo)));
  }
}

// ----- Mensagens -----

function desenharMensagens() {
  areaMensagens.replaceChildren();
  atualizarTokens();

  if (!conversaAtual && !mensagens.length) {
    areaMensagens.append(el("div", { classe: "saudacao-ia" },
      el("img", { src: "alphabot.png", alt: "AlphaBot IA" }),
      el("h3", {}, `${saudacaoPorHorario()}! Como posso ajudar?`),
      el("p", {}, subtituloContextual()),
      el("div", { classe: "sugestoes-ia" },
        sugestoesContextuais().map((sugestao) => el("button", { aoClicar: () => {
          caixaTexto.value = sugestao;
          caixaTexto.dispatchEvent(new Event("input"));
          caixaTexto.focus();
        } }, sugestao)),
      ),
    ));
    return;
  }

  for (let i = 0; i < mensagens.length; i++) {
    const anterior = i > 0 ? mensagens[i - 1] : null;
    areaMensagens.append(montarMensagem(mensagens[i], anterior));
  }
  rolarParaBaixo();
}

function montarMensagem(mensagem, anterior) {
  if (mensagem.role === "user") {
    return el("div", { classe: "mensagem usuario" },
      el("div", { classe: "corpo-mensagem" },
        mensagem.attachments?.length ? el("div", { classe: "anexos-mensagem" },
          mensagem.attachments.map((anexo) => {
            if (ehImagem(anexo.type)) return el("img", { src: anexo.dataUrl, alt: anexo.name });
            return el("div", { classe: "arquivo-mensagem" }, icone("arquivo"), el("span", {}, anexo.name));
          })) : null,
        el("div", { classe: "texto" }, mensagem.content),
        el("time", {}, horaCurta(mensagem.createdAt)),
      ),
    );
  }

  const corpo = el("div", { classe: "corpo-mensagem" });

  // Se a mensagem anterior (usuário) tinha anexos, mostra indicador por arquivo
  if (anterior?.role === "user" && anterior?.attachments?.length) {
    for (const anexo of anterior.attachments) {
      const isImg = ehImagem(anexo.type);
      const area = el("div", { classe: "conteudo-raciocinio" }, `Arquivo ${anexo.name} processado pelo visualizador.`);
      const detalhes = el("details", { classe: "raciocinio" },
        el("summary", {}, isImg ? icone("imagem") : icone("arquivo"), `${anexo.name} — analisado`),
        area,
      );
      detalhes.addEventListener("toggle", () => {
        area.style.display = detalhes.open ? "" : "none";
      });
      corpo.append(detalhes);
    }
  }

  if (mensagem.reasoning) {
    let duracao = "";
    if (anterior?.createdAt && mensagem.createdAt) {
      const s = Math.max(1, Math.round((new Date(mensagem.createdAt).getTime() - new Date(anterior.createdAt).getTime()) / 1000));
      duracao = ` (${formatarDuracao(s)})`;
    }
    corpo.append(el("details", { classe: "raciocinio" },
      el("summary", {}, icone("ajuda"), `Raciocínio${duracao}`),
      el("div", { classe: "conteudo-raciocinio" }, mensagem.reasoning),
    ));
  }
  corpo.append(
    el("div", { classe: "texto", html: markdownSimples(mensagem.content) }),
    el("div", { classe: "rodape-mensagem" },
      el("time", {}, horaCurta(mensagem.createdAt)),
      mensagem.tokens?.completion ? el("span", { classe: "tokens" }, `${formatarNumero(mensagem.tokens.completion)} tokens`) : null,
    ),
  );
  return el("div", { classe: "mensagem" },
    el("img", { classe: "avatar-ia", src: "alphabot.png", alt: "" }),
    corpo,
  );
}

function horaCurta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function atualizarTokens() {
  if (!elementoTokens) return;
  let total = 0;
  for (const m of mensagens) {
    if (m.tokens?.completion) total += m.tokens.completion;
  }
  elementoTokens.textContent = total > 0 ? `${formatarNumero(total)} tokens na conversa` : "";
}

function rolarParaBaixo() {
  areaMensagens.scrollTop = areaMensagens.scrollHeight;
}

// ----- Anexos -----

const MAX_ANEXOS = 6;

function ehImagem(tipo) { return /^image\/(png|jpeg|webp|gif)$/i.test(tipo); }
function ehPdf(tipo, nome) { return tipo === "application/pdf" || nome.endsWith(".pdf"); }
function ehExcel(tipo, nome) { return tipo.includes("spreadsheet") || tipo.includes("excel") || nome.endsWith(".xlsx"); }
function ehTexto(tipo, nome) {
  return /^text\/(plain|csv|markdown)$/i.test(tipo) || tipo === "application/json"
    || nome.endsWith(".txt") || nome.endsWith(".md") || nome.endsWith(".csv") || nome.endsWith(".json") || nome.endsWith(".log");
}

function eArquivoAceito(arquivo) {
  return ehImagem(arquivo.type) || ehPdf(arquivo.type, arquivo.name)
    || ehExcel(arquivo.type, arquivo.name) || ehTexto(arquivo.type, arquivo.name);
}

function tamanhoMaximo(arquivo) {
  if (ehImagem(arquivo.type)) return 2_000_000;
  if (ehPdf(arquivo.type, arquivo.name) || ehExcel(arquivo.type, arquivo.name)) return 5_000_000;
  return 1_000_000;
}

async function adicionarAnexos(arquivos) {
  const aceitos = arquivos
    .filter((arquivo) => eArquivoAceito(arquivo) && arquivo.size <= tamanhoMaximo(arquivo))
    .slice(0, MAX_ANEXOS - anexos.length);
  if (arquivos.length && !aceitos.length) {
    avisar("Formatos aceitos: PNG, JPG, WEBP, GIF, PDF, XLSX, TXT, MD, CSV, JSON, LOG. Máx. 6 arquivos por mensagem.", "info");
    return;
  }
  for (const arquivo of aceitos) {
    const anexo = { name: arquivo.name, type: arquivo.type };
    if (ehTexto(arquivo.type, arquivo.name)) {
      const conteudo = await new Promise((resolver, rejeitar) => {
        const leitor = new FileReader();
        leitor.onload = () => resolver(String(leitor.result));
        leitor.onerror = () => rejeitar(leitor.error);
        leitor.readAsText(arquivo);
      });
      anexo.content = conteudo.slice(0, 50_000);
    } else {
      anexo.dataUrl = await new Promise((resolver, rejeitar) => {
        const leitor = new FileReader();
        leitor.onload = () => resolver(String(leitor.result));
        leitor.onerror = () => rejeitar(leitor.error);
        leitor.readAsDataURL(arquivo);
      });
    }
    anexos.push(anexo);
  }
  desenharAnexos();
  atualizarBotaoEnviar();
}

function iconeArquivo(anexo) {
  if (ehImagem(anexo.type)) return el("img", { src: anexo.dataUrl, alt: anexo.name, title: anexo.name });
  if (ehPdf(anexo.type, anexo.name)) return el("span", { classe: "icone-arquivo", title: anexo.name }, icone("arquivo"), "PDF");
  if (ehExcel(anexo.type, anexo.name)) return el("span", { classe: "icone-arquivo", title: anexo.name }, icone("grafico"), "XLSX");
  return el("span", { classe: "icone-arquivo", title: anexo.name }, icone("arquivo"), "TXT");
}

function desenharAnexos() {
  areaAnexos.replaceChildren();
  anexos.forEach((anexo, indice) => {
    areaAnexos.append(el("div", { classe: "anexo" },
      iconeArquivo(anexo),
      el("button", { classe: "remover-anexo", "aria-label": "Remover anexo", aoClicar: () => {
        anexos.splice(indice, 1);
        desenharAnexos();
        atualizarBotaoEnviar();
      } }, icone("fechar")),
    ));
  });
}

function atualizarBotaoEnviar() {
  botaoEnviar.disabled = ocupado || (!caixaTexto.value.trim() && !anexos.length);
}

// ----- Envio com streaming -----

async function enviar() {
  const texto = caixaTexto.value.trim();
  if (ocupado || (!texto && !anexos.length)) return;

  ocupado = true;
  atualizarBotaoEnviar();

  const anexosEnviados = [...anexos];
  anexos = [];
  desenharAnexos();
  caixaTexto.value = "";
  caixaTexto.style.height = "auto";

  try {
    const csrf = await contextoGlobal.garantirCsrf();

    // Se não tem conversa aberta, crio uma na hora
    if (!conversaAtual) {
      conversaAtual = await criarConversa(csrf);
      conversas = [conversaAtual, ...conversas];
      desenharListaConversas();
    }

    // Coloco a mensagem do usuário na tela imediatamente
    const minhaMensagem = { role: "user", content: texto, attachments: anexosEnviados, createdAt: new Date().toISOString() };
    mensagens.push(minhaMensagem);
    if (mensagens.length === 1) areaMensagens.replaceChildren();
    areaMensagens.append(montarMensagem(minhaMensagem));

    // Balão da resposta, que vai sendo preenchido pelo stream
    let textoResposta = "";
    let textoRaciocinio = "";
    const inicioPensando = Date.now();

    // Blocos de ferramenta individuais por arquivo
    const blocosFerramenta = [];
    const containerFerramentas = el("div", {});

    if (anexosEnviados.length > 0) {
      for (let i = 0; i < anexosEnviados.length; i++) {
        const anexo = anexosEnviados[i];
        const isImg = ehImagem(anexo.type);
        const area = el("div", { classe: "conteudo-raciocinio", style: "display:none" });
        const resumo = el("summary", {},
          isImg ? icone("imagem") : icone("arquivo"),
          el("span", {}, anexo.name),
          el("span", { classe: "pontinhos" }, el("i"), el("i"), el("i")));
        const detalhes = el("details", { classe: "raciocinio", style: "display:none" }, resumo, area);
        detalhes.addEventListener("toggle", () => {
          area.style.display = detalhes.open ? "" : "none";
        });
        containerFerramentas.append(detalhes);
        blocosFerramenta.push({ detalhes, resumo, area, nome: anexo.name, iconeOriginal: isImg ? icone("imagem") : icone("arquivo") });
      }
    }

    // Bloco de raciocínio da IA
    const areaRaciocinio = el("div", { classe: "conteudo-raciocinio", style: "display:none" });
    const resumoRaciocinio = el("summary", {}, icone("ajuda"), el("span", {}, "Pensando"),
      el("span", { classe: "pontinhos" }, el("i"), el("i"), el("i")));
    const detalhesRaciocinio = el("details", { classe: "raciocinio", style: "display:none" }, resumoRaciocinio, areaRaciocinio);
    detalhesRaciocinio.addEventListener("toggle", () => {
      areaRaciocinio.style.display = detalhesRaciocinio.open ? "" : "none";
    });

    const areaTexto = el("div", { classe: "texto" },
      el("span", { classe: "pensando" }, el("span", { classe: "pontinhos" }, el("i"), el("i"), el("i"))));
    const balaoResposta = el("div", { classe: "mensagem" },
      el("img", { classe: "avatar-ia", src: "alphabot.png", alt: "" }),
      el("div", { classe: "corpo-mensagem" }, containerFerramentas, detalhesRaciocinio, areaTexto),
    );
    areaMensagens.append(balaoResposta);
    rolarParaBaixo();

    await enviarMensagemIa(csrf, conversaAtual.id, { content: texto, attachments: anexosEnviados }, {
      aoStatus(dados) {
        const idx = typeof dados.index === "number" ? dados.index : -1;
        if (idx >= 0 && idx < blocosFerramenta.length) {
          const bloco = blocosFerramenta[idx];
          bloco.detalhes.style.display = "";
          bloco.detalhes.open = true;
          bloco.area.style.display = "";
          bloco.area.textContent = dados.text;
          if (dados.done) {
            bloco.resumo.replaceChildren(bloco.iconeOriginal.cloneNode(true), el("span", {}, dados.text));
          }
        }
      },
      aoRaciocinar(pedaco) {
        // Fecha os blocos de ferramenta quando o raciocínio começa
        for (const bloco of blocosFerramenta) {
          if (bloco.detalhes.open) bloco.detalhes.open = false;
        }
        textoRaciocinio += pedaco;
        detalhesRaciocinio.style.display = "";
        areaRaciocinio.textContent = textoRaciocinio;
        if (detalhesRaciocinio.open) rolarParaBaixo();
      },
      aoResponder(pedaco) {
        textoResposta += pedaco;
        areaTexto.innerHTML = markdownSimples(textoResposta);
        rolarParaBaixo();
      },
      aoTerminar(resultado) {
        // Troco o resumo "Pensando" pelo tempo que levou
        const segundos = Math.max(1, Math.round((Date.now() - inicioPensando) / 1000));
        resumoRaciocinio.replaceChildren(icone("ajuda"), `Raciocínio (${formatarDuracao(segundos)})`);
        if (!textoRaciocinio) detalhesRaciocinio.remove();
        areaTexto.innerHTML = markdownSimples(resultado?.assistant?.content ?? textoResposta);
        const rodape = el("div", { classe: "rodape-mensagem" },
          el("time", {}, horaCurta(new Date().toISOString())),
          resultado?.assistant?.tokens?.completion ? el("span", { classe: "tokens" }, `${formatarNumero(resultado.assistant.tokens.completion)} tokens`) : null,
        );
        balaoResposta.querySelector(".corpo-mensagem").append(rodape);
        mensagens.push(resultado?.assistant ?? { role: "assistant", content: textoResposta, reasoning: textoRaciocinio, createdAt: new Date().toISOString() });
        if (resultado?.title && conversaAtual) {
          conversaAtual.title = resultado.title;
          carregarConversas();
        }
        atualizarTokens();
        rolarParaBaixo();
      },
      aoErrar(mensagemErro) {
        detalhesRaciocinio.remove();
        areaTexto.replaceChildren(el("span", { classe: "aviso perigo", style: "margin:0" }, icone("alerta"), mensagemErro));
      },
    });
  } catch (motivo) {
    avisar(erroAmigavel(motivo), "perigo");
  } finally {
    ocupado = false;
    atualizarBotaoEnviar();
    caixaTexto.focus();
  }
}
