// ============================================================
// central-avisos.js — as mensagens rotativas do cabeçalho.
//
// Como funciona:
//  - Existe uma fila de avisos; cada um tem texto curto (o que
//    aparece no cabeçalho) e detalhes (o que abre no modal).
//  - A rotação é DEVAGAR de propósito (45 s por assunto) — só
//    muda mais rápido quando um evento pontual fura a fila.
//  - Avisos importantes ganham pulso pra chamar atenção e ficam
//    na frente até serem vistos (clicados).
// ============================================================

import { el, icone, formatarNumero, tempoRelativo } from "./utilitarios.js";
import { abrirModal } from "./componentes.js";

const TROCA_NORMAL_MS = 45_000; // tempo parado em cada assunto
let avisos = [];                // fila atual { id, texto, detalhes, importante, criadoEm }
let indiceAtual = 0;
let cronometroRotacao = null;
let botao, texto;

export function iniciarCentralAvisos() {
  botao = document.getElementById("central-avisos");
  texto = document.getElementById("texto-central-avisos");
  if (!botao) return;
  botao.addEventListener("click", abrirDetalhesDoAtual);
  agendarRotacao();
}

// Publica (ou atualiza) um aviso. Mesmo id substitui o anterior sem
// bagunçar a rotação. `importante: true` fura a fila e ganha pulso.
export function publicarAviso({ id, texto: textoCurto, detalhes, importante = false }) {
  const existente = avisos.findIndex((aviso) => aviso.id === id);
  const aviso = { id, texto: textoCurto, detalhes, importante, criadoEm: new Date().toISOString(), visto: false };
  if (existente >= 0) {
    aviso.visto = avisos[existente].visto && avisos[existente].texto === textoCurto;
    avisos[existente] = aviso;
  } else {
    avisos.push(aviso);
  }
  if (importante && !aviso.visto) {
    // evento pontual: mostro na hora, sem esperar a vez dele
    indiceAtual = avisos.findIndex((entrada) => entrada.id === id);
    desenhar();
    agendarRotacao();
  } else if (avisos.length === 1) {
    indiceAtual = 0;
    desenhar();
  }
}

export function removerAviso(id) {
  const posicao = avisos.findIndex((aviso) => aviso.id === id);
  if (posicao < 0) return;
  avisos.splice(posicao, 1);
  if (indiceAtual >= avisos.length) indiceAtual = 0;
  desenhar();
}

function agendarRotacao() {
  if (cronometroRotacao) clearInterval(cronometroRotacao);
  cronometroRotacao = setInterval(() => {
    if (avisos.length <= 1) return;
    // Se tem um importante não visto, ele não sai da frente
    const urgente = avisos.findIndex((aviso) => aviso.importante && !aviso.visto);
    indiceAtual = urgente >= 0 ? urgente : (indiceAtual + 1) % avisos.length;
    desenhar();
  }, TROCA_NORMAL_MS);
}

function desenhar() {
  if (!botao) return;
  const atual = avisos[indiceAtual];
  if (!atual) {
    botao.hidden = true;
    return;
  }
  botao.hidden = false;
  botao.classList.toggle("importante", Boolean(atual.importante && !atual.visto));
  // Fade curtinho na troca de texto
  texto.classList.add("trocando");
  setTimeout(() => {
    texto.textContent = atual.texto;
    texto.classList.remove("trocando");
  }, 160);
}

function abrirDetalhesDoAtual() {
  const atual = avisos[indiceAtual];
  if (!atual) return;
  atual.visto = true;
  botao.classList.remove("importante");

  const corpo = el("div", { style: "display:flex;flex-direction:column;gap:12px" });
  if (typeof atual.detalhes === "string") {
    corpo.append(el("p", { style: "font-size:.9rem;line-height:1.6" }, atual.detalhes));
  } else if (atual.detalhes instanceof Node) {
    corpo.append(atual.detalhes);
  } else if (typeof atual.detalhes === "function") {
    corpo.append(atual.detalhes());
  }
  corpo.append(el("p", { style: "font-size:.72rem;color:var(--texto-fraco)" }, `Aviso registrado ${tempoRelativo(atual.criadoEm)}.`));

  // Lista dos demais avisos ativos, pra pessoa navegar entre eles
  const outros = avisos.filter((aviso) => aviso !== atual);
  if (outros.length) {
    corpo.append(el("div", {},
      el("strong", { style: "font-size:.8rem;color:var(--texto-suave)" }, "Outros avisos ativos"),
      el("div", { style: "display:flex;flex-direction:column;gap:4px;margin-top:6px" },
        outros.map((aviso) => el("button", {
          classe: "botao discreto pequeno",
          style: "justify-content:flex-start;text-align:left",
          aoClicar: () => {
            indiceAtual = avisos.indexOf(aviso);
            desenhar();
            abrirDetalhesDoAtual();
          },
        }, aviso.importante && !aviso.visto ? icone("alerta") : icone("info"), aviso.texto)),
      ),
    ));
  }

  abrirModal({ chapeu: "Central de avisos", titulo: atual.texto, corpo });
}

// ------------------------------------------------------------
// Fontes padrão de avisos: dicas que giram quando não tem nada
// de especial acontecendo. Chamado uma vez pelo aplicativo.js.
// ------------------------------------------------------------
export function semearAvisosPadrao(contexto) {
  const dicas = [
    {
      id: "dica-filtros",
      texto: "Dica: combine filtros e selecione todos os resultados de uma vez",
      detalhes: "Na aba Anúncios, o botão Filtros agrupa status, desempenho, formato e faixas. Depois de filtrar, dá pra selecionar todos os resultados (não só a página) e aplicar uma alteração em massa com prévia.",
    },
    {
      id: "dica-publico",
      texto: "As consultas públicas respeitam pausas de segurança automáticas",
      detalhes: "A leitura de páginas públicas espera de 4,5 a 8 segundos entre páginas e de 2,8 a 5 segundos entre anúncios. Se o Mercado Livre limitar uma página, o sistema preserva o que já leu e tenta de novo no final, com um intervalo bem maior.",
    },
    {
      id: "dica-ia",
      texto: "O AlphaBot escreve títulos e descrições de anúncio pra você",
      detalhes: "Além de tirar dúvidas do sistema, o AlphaBot cria títulos (até 60 caracteres com palavras-chave), descrições completas e respostas pra compradores. Cole uma foto do produto na conversa que ele analisa também.",
    },
  ];
  if (!contexto.conectado) {
    dicas.unshift({
      id: "dica-conectar",
      texto: "Conecte a conta pra liberar Vendas, Perguntas e Tendências",
      detalhes: "As abas oficiais usam a API do Mercado Livre com a sua autorização. Sem webcam pro reconhecimento facial? Use a opção “Conectar pelo celular” no menu Opções: o link abre no telefone e a conta conecta aqui no computador.",
    });
  }
  for (const dica of dicas) publicarAviso(dica);
}
