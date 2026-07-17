// ============================================================
// painel-usuarios.js — a tela de gestão de usuários (Owner/Admin).
//
// Owner: aprova/recusa Administradores pendentes e vê todos.
// Admin: cria usuários da sua empresa, define as permissões
//   página por página, edita e exclui. Owner também cria.
// Abre num modal a partir do menu Opções.
// ============================================================

import { el, icone, formatarData } from "./utilitarios.js";
import {
  listarUsuarios, usuariosPendentes, decidirAdmin, criarUsuario,
  editarUsuario, excluirUsuario, erroAmigavel,
} from "./api.js";
import { abrirModal, fecharModal, confirmar, avisar, estadoVazio, esqueletoLinhas } from "./componentes.js";
import { usuario as usuarioLogado, areas as areasSistema, ehGestor } from "./permissoes.js";

let contextoGlobal = null;

const nomesPapel = { OWNER: "Fundador", ADMIN: "Administrador", USER: "Usuário" };
const coresSituacao = { ATIVO: "verde", PENDENTE: "laranja", SUSPENSO: "vermelho" };

export function abrirGestaoUsuarios(contexto) {
  contextoGlobal = contexto;
  if (!ehGestor()) { avisar("Só o Fundador e os Administradores gerenciam usuários.", "info"); return; }

  const corpo = el("div", { classe: "gestao-usuarios" }, esqueletoLinhas(4, 50));
  abrirModal({ chapeu: "Moderação", titulo: "Usuários e permissões", tamanho: "gigante", corpo });
  recarregar(corpo);
}

async function recarregar(corpo) {
  corpo.replaceChildren(esqueletoLinhas(4, 50));
  const ehOwner = usuarioLogado()?.papel === "OWNER";
  try {
    const [{ usuarios }, pendentesResp] = await Promise.all([
      listarUsuarios(),
      ehOwner ? usuariosPendentes() : Promise.resolve({ pendentes: [] }),
    ]);
    desenhar(corpo, usuarios, pendentesResp.pendentes ?? []);
  } catch (motivo) {
    corpo.replaceChildren(el("div", { classe: "aviso perigo" }, icone("alerta"), erroAmigavel(motivo)));
  }
}

function desenhar(corpo, usuarios, pendentes) {
  corpo.replaceChildren();

  // Administradores aguardando aprovação (só o Owner vê)
  if (pendentes.length) {
    corpo.append(el("div", { classe: "bloco-pendentes" },
      el("h3", {}, icone("alerta"), `${pendentes.length} administrador(es) aguardando aprovação`),
      el("div", { classe: "lista-pendentes" }, pendentes.map((pendente) => el("div", { classe: "linha-pendente" },
        el("div", {},
          el("strong", {}, pendente.nome || pendente.usuario),
          el("small", {}, ` ${pendente.usuario} · ${pendente.email}`)),
        el("div", { style: "display:flex;gap:6px" },
          el("button", { classe: "botao pequeno primario", aoClicar: () => responderAdmin(corpo, pendente, "aprovar") }, icone("confere"), "Aprovar"),
          el("button", { classe: "botao pequeno perigoso", aoClicar: () => responderAdmin(corpo, pendente, "recusar") }, "Recusar")),
      ))),
    ));
  }

  // Cabeçalho com botão de criar
  corpo.append(el("div", { classe: "cabeca-painel", style: "margin-bottom:12px" },
    el("div", { classe: "lado-esquerdo" }, el("strong", {}, `${usuarios.length} usuário(s)`)),
    el("div", { classe: "lado-direito" },
      el("button", { classe: "botao primario", aoClicar: () => abrirFormularioUsuario(corpo, null) }, icone("mais"), "Novo usuário")),
  ));

  if (!usuarios.length) {
    corpo.append(estadoVazio("usuarios", "Nenhum usuário ainda", "Crie o primeiro usuário da sua empresa."));
    return;
  }

  corpo.append(el("div", { classe: "envoltorio-tabela" },
    el("table", { classe: "tabela" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Usuário"), el("th", {}, "Papel"), el("th", {}, "Situação"),
        el("th", {}, "Acesso"), el("th", {}, "Último login"), el("th", { style: "width:110px" }, ""))),
      el("tbody", {}, usuarios.map((item) => montarLinha(corpo, item))),
    ),
  ));
}

function montarLinha(corpo, item) {
  const euMesmo = item.id === usuarioLogado()?.id;
  const totalAreas = areasSistema().length;
  const acesso = item.papel === "USER"
    ? `${item.permissoes.length} de ${totalAreas} áreas`
    : "Tudo";
  return el("tr", {},
    el("td", {}, el("div", {},
      el("strong", {}, item.nome || item.usuario),
      el("div", { style: "font-size:.74rem;color:var(--texto-fraco)" }, `${item.usuario} · ${item.email}`))),
    el("td", {}, el("span", { classe: `selo ${item.papel === "OWNER" ? "azul" : item.papel === "ADMIN" ? "roxo" : ""}` }, nomesPapel[item.papel] ?? item.papel)),
    el("td", {}, el("span", { classe: `selo ${coresSituacao[item.situacao] ?? ""}` }, item.situacao)),
    el("td", {}, acesso),
    el("td", {}, item.ultimoLoginEm ? formatarData(item.ultimoLoginEm, true) : "—"),
    el("td", {}, item.papel === "OWNER" ? el("span", { style: "color:var(--texto-fraco);font-size:.76rem" }, "protegido") : el("div", { style: "display:flex;gap:2px;justify-content:flex-end" },
      el("button", { classe: "botao-icone", title: "Editar", aoClicar: () => abrirFormularioUsuario(corpo, item) }, icone("lapis")),
      euMesmo ? null : el("button", { classe: "botao-icone", title: "Excluir", aoClicar: () => removerUsuario(corpo, item) }, icone("lixeira")),
    )),
  );
}

async function responderAdmin(corpo, pendente, decisao) {
  if (decisao === "recusar" && !(await confirmar({ titulo: "Recusar administrador", mensagem: `A conta de ${pendente.usuario} será removida. Confirmar?`, textoConfirmar: "Recusar", perigoso: true }))) return;
  try {
    await decidirAdmin(await contextoGlobal.garantirCsrf(), pendente.id, decisao);
    avisar(decisao === "aprovar" ? "Administrador aprovado." : "Administrador recusado.", "sucesso");
    recarregar(corpo);
  } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
}

async function removerUsuario(corpo, item) {
  const aviso = item.papel === "ADMIN"
    ? `Excluir ${item.usuario} apaga também TODOS os usuários vinculados a essa empresa. Não dá pra desfazer.`
    : `A conta de ${item.usuario} será apagada. Não dá pra desfazer.`;
  if (!(await confirmar({ titulo: "Excluir usuário", mensagem: aviso, textoConfirmar: "Excluir", perigoso: true }))) return;
  try {
    await excluirUsuario(await contextoGlobal.garantirCsrf(), item.id);
    avisar("Usuário excluído.", "sucesso");
    recarregar(corpo);
  } catch (motivo) { avisar(erroAmigavel(motivo), "perigo"); }
}

// ----- Formulário de criar/editar usuário -----

function abrirFormularioUsuario(corpoLista, existente) {
  const ehEdicao = Boolean(existente);
  const perfil = existente?.perfil ?? {};

  const c = (rotulo, valor = "", extra = {}) => {
    const entrada = el("input", { classe: "entrada", value: valor, ...extra });
    return { elemento: el("label", { classe: "campo" }, el("span", {}, rotulo), entrada), entrada };
  };

  const usuario = c("Nome de usuário (login)", existente?.usuario ?? "", ehEdicao ? { disabled: true } : { placeholder: "sem espaços" });
  const nome = c("Nome completo", existente?.nome ?? "");
  const email = c("E-mail", existente?.email ?? "", { type: "email" });
  const cpf = c("CPF", existente?.cpf ?? "");
  const senha = c(ehEdicao ? "Nova senha (deixe vazio para manter)" : "Senha", "", { type: "password", placeholder: "mínimo 6 caracteres" });
  const telefone = c("Telefone", perfil.telefone ?? "");
  const cep = c("CEP", perfil.cep ?? "");
  const logradouro = c("Endereço", perfil.logradouro ?? "");
  const numero = c("Número", perfil.numero ?? "");
  const complemento = c("Complemento", perfil.complemento ?? "");
  const bairro = c("Bairro", perfil.bairro ?? "");
  const cidade = c("Cidade", perfil.cidade ?? "");
  const uf = c("UF", perfil.uf ?? "", { maxlength: "2" });
  const resposta = ehEdicao ? null : c("Resposta de recuperação", "", { placeholder: "usada se esquecer a senha" });

  // Permissões por página (só faz sentido pra USER; novos são USER)
  const ehUser = !existente || existente.papel === "USER";
  const marcados = new Set(existente?.permissoes ?? []);
  const gruposNome = { oficial: "Conta oficial · API", "nao-oficial": "Não oficial", geral: "Geral" };
  const grade = el("div", { classe: "grade-permissoes" });
  if (ehUser) {
    for (const nomeGrupo of ["oficial", "nao-oficial", "geral"]) {
      const doGrupo = areasSistema().filter((area) => area.grupo === nomeGrupo);
      if (!doGrupo.length) continue;
      grade.append(el("div", { classe: "grupo-permissao" },
        el("strong", {}, gruposNome[nomeGrupo] ?? nomeGrupo),
        el("div", {}, doGrupo.map((area) => {
          const entrada = el("input", { type: "checkbox" });
          entrada.checked = area.sempre || marcados.has(area.chave);
          entrada.disabled = Boolean(area.sempre);
          entrada.dataset.chave = area.chave;
          return el("label", { classe: "marcar-permissao" }, entrada,
            el("span", { classe: "caixinha" }, icone("confere")),
            el("span", {}, area.nome), area.sempre ? el("small", {}, " (sempre)") : null);
        })),
      ));
    }
  }

  const salvar = async (botao) => {
    botao.disabled = true;
    try {
      const csrf = await contextoGlobal.garantirCsrf();
      const perfilNovo = {
        telefone: telefone.entrada.value.trim(), cep: cep.entrada.value.trim(),
        logradouro: logradouro.entrada.value.trim(), numero: numero.entrada.value.trim(),
        complemento: complemento.entrada.value.trim(), bairro: bairro.entrada.value.trim(),
        cidade: cidade.entrada.value.trim(), uf: uf.entrada.value.trim().toUpperCase(),
      };
      const permissoes = [...grade.querySelectorAll("input[data-chave]")].filter((e) => e.checked).map((e) => e.dataset.chave);

      if (ehEdicao) {
        const dados = { nome: nome.entrada.value.trim(), cpf: cpf.entrada.value.trim(), email: email.entrada.value.trim(), perfil: perfilNovo };
        if (existente.papel === "USER") dados.permissoes = permissoes;
        if (senha.entrada.value) dados.novaSenha = senha.entrada.value;
        await editarUsuario(csrf, existente.id, dados);
        avisar("Usuário atualizado.", "sucesso");
      } else {
        await criarUsuario(csrf, {
          usuario: usuario.entrada.value.trim(),
          nome: nome.entrada.value.trim(),
          email: email.entrada.value.trim(),
          cpf: cpf.entrada.value.trim(),
          senha: senha.entrada.value,
          perfil: perfilNovo,
          permissoes,
          respostaRecuperacao: resposta.entrada.value.trim() || "recuperacao",
        });
        avisar("Usuário criado.", "sucesso");
      }
      fecharModal();
      abrirGestaoUsuarios(contextoGlobal); // reabre a lista já atualizada
    } catch (motivo) {
      avisar(erroAmigavel(motivo), "perigo");
      botao.disabled = false;
    }
  };

  abrirModal({
    chapeu: ehEdicao ? "Editar usuário" : "Novo usuário",
    titulo: ehEdicao ? (existente.nome || existente.usuario) : "Criar usuário da empresa",
    tamanho: "largo",
    corpo: el("div", { classe: "form-usuario" },
      el("div", { classe: "grade-form-usuario" },
        usuario.elemento, nome.elemento, email.elemento, cpf.elemento, senha.elemento,
        el("div", { classe: "subtitulo-form" }, "Endereço e contato"),
        telefone.elemento, cep.elemento, logradouro.elemento, numero.elemento,
        complemento.elemento, bairro.elemento, cidade.elemento, uf.elemento,
        resposta ? resposta.elemento : null,
      ),
      ehUser ? el("div", {}, el("div", { classe: "subtitulo-form" }, "Permissões de acesso (marque as áreas liberadas)"), grade) : null,
    ),
    rodape: [
      el("button", { classe: "botao", aoClicar: () => { fecharModal(); abrirGestaoUsuarios(contextoGlobal); } }, "Voltar"),
      el("button", { classe: "botao primario", aoClicar: (evento) => salvar(evento.currentTarget) }, ehEdicao ? "Salvar" : "Criar usuário"),
    ],
  });
}
