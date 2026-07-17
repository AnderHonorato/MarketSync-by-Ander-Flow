// ============================================================
// autenticacao.js — a tela de entrada do aplicativo (login local).
// Mostra login, cadastro (Fundador na primeira vez, Administrador
// depois) e recuperação de senha. Quando entra, chama o retorno
// aoEntrar() pra o aplicativo seguir pro conteúdo.
// ============================================================

import { el, icone } from "./utilitarios.js";
import {
  estadoAutenticacao, cadastrar, entrar, perguntaRecuperacao, redefinirSenha,
  obterSessao, erroAmigavel,
} from "./api.js";

let raiz = null;
let aoEntrar = null;
let precisaFundador = false;
let modo = "login"; // login | cadastro | recuperar

export async function iniciarAutenticacao(contexto, retornoAoEntrar) {
  aoEntrar = retornoAoEntrar;
  raiz = document.getElementById("tela-autenticacao");
  try {
    const estado = await estadoAutenticacao();
    precisaFundador = estado.precisaFundador;
    if (estado.logado) { entrou(estado.usuario, estado.areas); return; }
  } catch {
    // se o backend não respondeu, mostro o login mesmo assim (erro aparece ao tentar)
  }
  modo = precisaFundador ? "cadastro" : "login";
  desenhar();
  raiz.hidden = false;
}

function entrou(usuario, areas) {
  raiz.hidden = true;
  aoEntrar?.(usuario, areas);
}

async function garantirCsrf() {
  const sessao = await obterSessao();
  if (!sessao?.csrfToken) throw new Error("O serviço local não iniciou uma sessão válida.");
  return sessao.csrfToken;
}

// ----- Desenho -----

function desenhar() {
  raiz.replaceChildren(el("div", { classe: "cartao-autenticacao" },
    el("div", { classe: "marca" },
      el("img", { id: "auth-icone", src: "icone-claro.png", alt: "MarketSync" }),
      el("div", {}, el("strong", {}, "MarketSync"), el("small", {}, "by Ander Flow")),
    ),
    corpoPorModo(),
  ));
  // Acompanha o tema atual no ícone
  const escuro = document.documentElement.dataset.tema === "escuro";
  raiz.querySelector("#auth-icone").src = escuro ? "icone-escuro.png" : "icone-claro.png";
}

function corpoPorModo() {
  if (modo === "cadastro") return formularioCadastro();
  if (modo === "recuperar") return formularioRecuperar();
  return formularioLogin();
}

function caixaErro() {
  return el("div", { classe: "aviso perigo", id: "auth-erro", hidden: true });
}

function mostrarErro(texto) {
  const caixa = document.getElementById("auth-erro");
  if (!caixa) return;
  caixa.hidden = !texto;
  caixa.replaceChildren(icone("alerta"), el("span", {}, texto));
}

function campo(rotulo, atributos = {}) {
  const entrada = el("input", { classe: "entrada", ...atributos });
  return { elemento: el("label", { classe: "campo" }, el("span", {}, rotulo), entrada), entrada };
}

// ----- Login -----

function formularioLogin() {
  const usuario = campo("Usuário ou e-mail", { autocomplete: "username" });
  const senha = campo("Senha", { type: "password", autocomplete: "current-password" });

  const enviar = async (botao) => {
    mostrarErro("");
    botao.disabled = true;
    try {
      const csrf = await garantirCsrf();
      const resposta = await entrar(csrf, usuario.entrada.value.trim(), senha.entrada.value);
      const estado = await estadoAutenticacao();
      entrou(resposta.usuario, estado.areas);
    } catch (motivo) {
      mostrarErro(erroAmigavel(motivo));
      botao.disabled = false;
    }
  };

  const botao = el("button", { classe: "botao primario", style: "width:100%", aoClicar: (evento) => enviar(evento.currentTarget) }, "Entrar");
  senha.entrada.addEventListener("keydown", (evento) => { if (evento.key === "Enter") enviar(botao); });

  return el("div", {},
    el("h1", {}, "Entrar no MarketSync"),
    el("p", { classe: "descricao-login" }, "Acesse com o usuário e a senha da sua conta."),
    caixaErro(),
    el("div", { classe: "campos-auth" }, usuario.elemento, senha.elemento, botao),
    el("div", { classe: "rodape-auth" },
      el("button", { classe: "botao-texto", aoClicar: () => { modo = "recuperar"; desenhar(); } }, "Esqueci a senha"),
      el("button", { classe: "botao-texto", aoClicar: () => { modo = "cadastro"; desenhar(); } }, "Criar conta de empresa"),
    ),
  );
}

// ----- Cadastro (Fundador ou Administrador) -----

function formularioCadastro() {
  const usuario = campo("Nome de usuário", { autocomplete: "username", placeholder: "ex.: minha-empresa" });
  const nome = campo("Nome completo", { placeholder: "Como você quer ser chamado" });
  const email = campo("E-mail", { type: "email", autocomplete: "email" });
  const senha = campo("Senha", { type: "password", autocomplete: "new-password", placeholder: "Mínimo de 6 caracteres" });
  const pergunta = campo("Pergunta de recuperação", { placeholder: "Ex.: nome do meu primeiro pet?" });
  const resposta = campo("Resposta de recuperação", { placeholder: "Só você precisa saber" });

  const enviar = async (botao) => {
    mostrarErro("");
    botao.disabled = true;
    try {
      const csrf = await garantirCsrf();
      const resultado = await cadastrar(csrf, {
        usuario: usuario.entrada.value.trim(),
        nome: nome.entrada.value.trim(),
        email: email.entrada.value.trim(),
        senha: senha.entrada.value,
        perguntaRecuperacao: pergunta.entrada.value.trim(),
        respostaRecuperacao: resposta.entrada.value.trim(),
      });
      if (resultado.fundador) {
        const estado = await estadoAutenticacao();
        entrou(resultado.usuario, estado.areas);
      } else {
        // Admin novo fica pendente de aprovação do Fundador
        modo = "login";
        desenhar();
        mostrarErro("");
        const caixa = document.getElementById("auth-erro");
        caixa.className = "aviso sucesso";
        caixa.hidden = false;
        caixa.replaceChildren(icone("confere"), el("span", {}, "Conta criada! Um Fundador precisa aprovar seu acesso antes do primeiro login."));
      }
    } catch (motivo) {
      mostrarErro(erroAmigavel(motivo));
      botao.disabled = false;
    }
  };

  return el("div", {},
    el("h1", {}, precisaFundador ? "Criar conta do Fundador" : "Criar conta de empresa"),
    el("p", { classe: "descricao-login" }, precisaFundador
      ? "Esta é a primeira conta do sistema: ela será o Fundador, com acesso total e poder de moderar todos os usuários."
      : "Contas de empresa entram como Administrador e precisam da aprovação do Fundador antes do primeiro acesso."),
    caixaErro(),
    el("div", { classe: "campos-auth" },
      usuario.elemento, nome.elemento, email.elemento, senha.elemento,
      el("div", { classe: "linha-dupla" }, pergunta.elemento, resposta.elemento),
      el("button", { classe: "botao primario", style: "width:100%", aoClicar: (evento) => enviar(evento.currentTarget) },
        precisaFundador ? "Criar Fundador e entrar" : "Criar conta"),
    ),
    precisaFundador ? null : el("div", { classe: "rodape-auth" },
      el("button", { classe: "botao-texto", aoClicar: () => { modo = "login"; desenhar(); } }, "Já tenho conta · Entrar"),
    ),
  );
}

// ----- Recuperação -----

function formularioRecuperar() {
  const usuario = campo("Usuário ou e-mail");
  const areaPergunta = el("div", { hidden: true });
  let perguntaTexto = "";

  const buscarPergunta = async (botao) => {
    mostrarErro("");
    botao.disabled = true;
    try {
      const csrf = await garantirCsrf();
      const { pergunta } = await perguntaRecuperacao(csrf, usuario.entrada.value.trim());
      perguntaTexto = pergunta;
      const resposta = campo(pergunta || "Resposta de recuperação");
      const novaSenha = campo("Nova senha", { type: "password", placeholder: "Mínimo de 6 caracteres" });
      const redefinir = async (b) => {
        mostrarErro("");
        b.disabled = true;
        try {
          const csrf2 = await garantirCsrf();
          await redefinirSenha(csrf2, usuario.entrada.value.trim(), resposta.entrada.value.trim(), novaSenha.entrada.value);
          modo = "login";
          desenhar();
          const caixa = document.getElementById("auth-erro");
          caixa.className = "aviso sucesso";
          caixa.hidden = false;
          caixa.replaceChildren(icone("confere"), el("span", {}, "Senha redefinida! Entre com a nova senha."));
        } catch (motivo) { mostrarErro(erroAmigavel(motivo)); b.disabled = false; }
      };
      areaPergunta.replaceChildren(resposta.elemento, novaSenha.elemento,
        el("button", { classe: "botao primario", style: "width:100%", aoClicar: (evento) => redefinir(evento.currentTarget) }, "Redefinir senha"));
      areaPergunta.hidden = false;
      usuario.entrada.disabled = true;
      botao.hidden = true;
    } catch (motivo) {
      mostrarErro(erroAmigavel(motivo));
      botao.disabled = false;
    }
  };

  return el("div", {},
    el("h1", {}, "Recuperar senha"),
    el("p", { classe: "descricao-login" }, "Informe seu usuário, responda a pergunta de recuperação e escolha uma nova senha."),
    caixaErro(),
    el("div", { classe: "campos-auth" },
      usuario.elemento,
      el("button", { classe: "botao", style: "width:100%", aoClicar: (evento) => buscarPergunta(evento.currentTarget) }, "Continuar"),
      areaPergunta,
    ),
    el("div", { classe: "rodape-auth" },
      el("button", { classe: "botao-texto", aoClicar: () => { modo = "login"; desenhar(); } }, "Voltar ao login"),
    ),
  );
}
