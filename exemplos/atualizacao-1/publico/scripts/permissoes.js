// ============================================================
// permissoes.js — decide o que o usuário logado enxerga.
//
// Guarda o usuário atual e a lista de áreas liberadas. Esconde
// os botões do menu que ele não pode acessar e, se ele cair numa
// área bloqueada (por link salvo, por exemplo), mostra a censura
// por cima com o aviso de "sem acesso".
// ============================================================

import { el, icone } from "./utilitarios.js";

let usuarioAtual = null;
let areasSistema = []; // catálogo vindo do backend: [{ chave, nome, grupo, sempre }]

export function definirUsuario(usuario, areas) {
  usuarioAtual = usuario;
  if (Array.isArray(areas)) areasSistema = areas;
}

export function usuario() {
  return usuarioAtual;
}

export function areas() {
  return areasSistema;
}

export function ehGestor() {
  return usuarioAtual?.papel === "OWNER" || usuarioAtual?.papel === "ADMIN";
}

// Owner/Admin acessam tudo; USER só o que foi liberado (o "sempre" já
// vem embutido nas permissões efetivas que o backend calcula, mas aqui
// também garanto o Início e as áreas marcadas como sempre).
export function podeAcessar(chave) {
  if (!usuarioAtual) return false;
  if (usuarioAtual.papel === "OWNER" || usuarioAtual.papel === "ADMIN") return true;
  const area = areasSistema.find((a) => a.chave === chave);
  if (area?.sempre) return true;
  return (usuarioAtual.permissoes ?? []).includes(chave);
}

// Aplica o gate no menu: esconde os botões de páginas bloqueadas.
export function aplicarGateNoMenu() {
  document.querySelectorAll("[data-painel]").forEach((botao) => {
    const chave = botao.dataset.painel;
    // Botões utilitários sem área correspondente (ex.: "Mais" do mobile) ficam
    const temArea = areasSistema.some((a) => a.chave === chave);
    if (!temArea) return;
    botao.hidden = !podeAcessar(chave);
  });
  // Esconde os títulos de grupo que ficaram sem nenhum item visível
  document.querySelectorAll(".grupo-navegacao").forEach((titulo) => {
    let irmao = titulo.nextElementSibling;
    let algumVisivel = false;
    while (irmao && !irmao.classList.contains("grupo-navegacao")) {
      if (irmao.matches("[data-painel]") && !irmao.hidden) algumVisivel = true;
      irmao = irmao.nextElementSibling;
    }
    titulo.hidden = !algumVisivel;
  });
}

// Camada de censura mostrada por cima de uma aba bloqueada.
export function telaBloqueada(nomeArea) {
  return el("div", { classe: "area-censurada" },
    el("div", { classe: "cadeado-censura" }, icone("cadeado")),
    el("h2", {}, "Acesso bloqueado"),
    el("p", {}, `Seu perfil não tem permissão para acessar “${nomeArea}”. Fale com o administrador da sua empresa para liberar esta área.`),
    el("span", { classe: "selo vermelho" }, icone("cadeado"), "Área restrita"),
  );
}
