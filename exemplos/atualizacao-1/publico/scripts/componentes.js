// ============================================================
// componentes.js — pedaços de interface reaproveitados:
// avisos flutuantes, modais, paginação, estado vazio, copiar…
// ============================================================

import { el, icone, copiarTexto } from "./utilitarios.js";

// ----- Avisos flutuantes (canto da tela) -----

export function avisar(mensagem, tipo = "info", duracao = 4200) {
  const area = document.getElementById("area-avisos");
  const nomeIcone = tipo === "sucesso" ? "confere" : tipo === "perigo" ? "alerta" : "info";
  const aviso = el("div", { classe: `aviso-flutuante ${tipo}` }, icone(nomeIcone), el("span", {}, mensagem));
  area.append(aviso);
  setTimeout(() => {
    aviso.classList.add("saindo");
    setTimeout(() => aviso.remove(), 300);
  }, duracao);
  return aviso;
}

// ----- Modais -----

let modalAberto = null;

// Abre um modal genérico. Fecha no X, clicando fora ou apertando Esc.
export function abrirModal({ chapeu, titulo, corpo, rodape, tamanho = "", aoFechar }) {
  fecharModal();
  const camada = document.getElementById("camada-modal");

  const botaoFechar = el("button", { classe: "botao-icone", "aria-label": "Fechar", aoClicar: () => fecharModal() }, icone("fechar"));
  const cabeca = el("div", { classe: "cabeca-modal" },
    el("div", {},
      chapeu ? el("p", { classe: "chapeu" }, chapeu) : null,
      el("h2", {}, titulo ?? ""),
    ),
    botaoFechar,
  );

  const modal = el("section", { classe: `modal ${tamanho}` }, cabeca, el("div", { classe: "corpo-modal" }, corpo));
  if (rodape) modal.append(el("div", { classe: "rodape-modal" }, rodape));

  camada.innerHTML = "";
  camada.append(modal);
  camada.hidden = false;

  const fecharPorFora = (evento) => { if (evento.target === camada) fecharModal(); };
  const fecharPorTecla = (evento) => { if (evento.key === "Escape") fecharModal(); };
  camada.addEventListener("mousedown", fecharPorFora);
  document.addEventListener("keydown", fecharPorTecla);

  modalAberto = {
    fechar() {
      camada.hidden = true;
      camada.innerHTML = "";
      camada.removeEventListener("mousedown", fecharPorFora);
      document.removeEventListener("keydown", fecharPorTecla);
      aoFechar?.();
    },
    elemento: modal,
  };
  return modalAberto;
}

export function fecharModal() {
  if (modalAberto) {
    const referencia = modalAberto;
    modalAberto = null;
    referencia.fechar();
  }
}

// Confirmação simples: retorna uma promessa que resolve true/false
export function confirmar({ titulo, mensagem, textoConfirmar = "Confirmar", perigoso = false, textoCancelar = "Cancelar" }) {
  return new Promise((resolver) => {
    let respondido = false;
    const responder = (valor) => {
      if (respondido) return;
      respondido = true;
      fecharModal();
      resolver(valor);
    };
    abrirModal({
      titulo,
      corpo: el("p", { style: "font-size:.9rem;color:var(--texto-suave)" }, mensagem),
      rodape: [
        el("button", { classe: "botao", aoClicar: () => responder(false) }, textoCancelar),
        el("button", { classe: `botao ${perigoso ? "perigoso" : "primario"}`, aoClicar: () => responder(true) }, textoConfirmar),
      ],
      aoFechar: () => responder(false),
    });
  });
}

// ----- Botão de copiar (aparece ao lado de códigos e links) -----

export function botaoCopiar(valor, rotulo = "Copiar") {
  if (!valor) return null;
  const botao = el("button", {
    classe: "copiar",
    title: rotulo,
    "aria-label": rotulo,
    aoClicar: async (evento) => {
      evento.stopPropagation();
      if (await copiarTexto(valor)) {
        botao.classList.add("copiado");
        botao.replaceChildren(icone("confere"));
        setTimeout(() => {
          botao.classList.remove("copiado");
          botao.replaceChildren(icone("copiar"));
        }, 1400);
      }
    },
  }, icone("copiar"));
  return botao;
}

// ----- Estado vazio -----

export function estadoVazio(nomeIcone, titulo, texto) {
  return el("div", { classe: "estado-vazio" },
    icone(nomeIcone),
    el("strong", {}, titulo),
    texto ? el("p", {}, texto) : null,
  );
}

// ----- Esqueleto de carregamento (linhas cinzas piscando) -----

export function esqueletoLinhas(quantidade = 5, altura = 46) {
  const caixa = el("div", { style: "display:flex;flex-direction:column;gap:8px" });
  for (let i = 0; i < quantidade; i += 1) {
    caixa.append(el("div", { classe: "esqueleto", style: `height:${altura}px` }));
  }
  return caixa;
}

// ----- Paginação -----

// Monta a barra de paginação completa: info, botões de página e tamanho.
// O chamador passa o estado atual e recebe os eventos de troca.
export function montarPaginacao({ pagina, totalPaginas, total, tamanhoPagina, aoTrocarPagina, aoTrocarTamanho, tamanhos = [30, 50, 100, 200] }) {
  const barra = el("div", { classe: "paginacao" });

  barra.append(el("span", { classe: "info-pagina" },
    total != null ? `${total} resultado${total === 1 ? "" : "s"} · página ${pagina} de ${Math.max(totalPaginas, 1)}` : `Página ${pagina}`,
  ));

  const paginas = el("div", { classe: "paginas" });
  const criarBotao = (rotulo, alvo, atributos = {}) =>
    el("button", { ...atributos, aoClicar: () => aoTrocarPagina(alvo) }, rotulo);

  paginas.append(criarBotao(icone("seta-esquerda", 14), pagina - 1, { disabled: pagina <= 1, "aria-label": "Página anterior" }));

  // Mostro no máximo 7 números: primeira, últimas, vizinhas e reticências
  const numeros = new Set([1, totalPaginas, pagina - 1, pagina, pagina + 1]);
  const lista = [...numeros].filter((n) => n >= 1 && n <= totalPaginas).sort((a, b) => a - b);
  let anterior = 0;
  for (const numero of lista) {
    if (numero - anterior > 1) paginas.append(el("span", { style: "color:var(--texto-fraco);padding:0 2px" }, "…"));
    paginas.append(criarBotao(String(numero), numero, { classe: numero === pagina ? "atual" : "" }));
    anterior = numero;
  }

  paginas.append(criarBotao(icone("seta-direita", 14), pagina + 1, { disabled: pagina >= totalPaginas, "aria-label": "Próxima página" }));
  barra.append(paginas);

  if (aoTrocarTamanho) {
    const seletor = el("select", {
      "aria-label": "Itens por página",
      aoMudar: (evento) => aoTrocarTamanho(Number(evento.target.value)),
    }, tamanhos.map((t) => el("option", { value: String(t), selected: t === tamanhoPagina }, `${t} por página`)));
    barra.append(seletor);
  }

  return barra;
}

// ----- Menu suspenso ancorado num botão -----

let menuAbertoAgora = null;

export function abrirMenuSuspenso(ancora, itens) {
  fecharMenuSuspenso();
  const menu = el("div", { classe: "menu-suspenso" });
  for (const item of itens) {
    if (item === "separador") { menu.append(el("hr")); continue; }
    menu.append(el("button", {
      classe: item.perigoso ? "perigoso" : "",
      aoClicar: () => { fecharMenuSuspenso(); item.aoClicar(); },
    }, item.icone ? icone(item.icone) : null, el("span", {}, item.rotulo)));
  }
  document.body.append(menu);

  // Posiciono perto do botão, sem deixar sair da tela
  const posicao = ancora.getBoundingClientRect();
  const larguraMenu = menu.offsetWidth || 210;
  menu.style.top = `${Math.min(posicao.bottom + 6, window.innerHeight - menu.offsetHeight - 10)}px`;
  menu.style.left = `${Math.max(8, Math.min(posicao.right - larguraMenu, window.innerWidth - larguraMenu - 8))}px`;

  const fecharSeFora = (evento) => {
    if (!menu.contains(evento.target) && evento.target !== ancora) fecharMenuSuspenso();
  };
  setTimeout(() => document.addEventListener("mousedown", fecharSeFora), 0);
  menuAbertoAgora = {
    fechar() {
      menu.remove();
      document.removeEventListener("mousedown", fecharSeFora);
    },
  };
}

export function fecharMenuSuspenso() {
  menuAbertoAgora?.fechar();
  menuAbertoAgora = null;
}

// ----- Caixa de marcar estilizada -----

export function caixaMarcar(marcado, aoMudar, rotulo = "") {
  const entrada = el("input", { type: "checkbox" });
  entrada.checked = marcado;
  entrada.addEventListener("change", () => aoMudar(entrada.checked));
  const caixa = el("label", { classe: "marcar", aoClicar: (evento) => evento.stopPropagation() },
    entrada,
    el("span", { classe: "caixinha" }, icone("confere")),
    rotulo ? el("span", {}, rotulo) : null,
  );
  return { elemento: caixa, entrada };
}
