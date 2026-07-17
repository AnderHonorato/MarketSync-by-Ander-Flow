# MarketSync — Atualização 1 (interface renovada)

Interface nova do gestor de anúncios, escrita em **HTML, CSS e JavaScript puros e separados**,
com nomes de arquivos, funções e variáveis todos em português. Ela conversa com o **mesmo
backend** do projeto (porta 3100) — nada do projeto original foi substituído ou alterado.

## Como iniciar

Jeito rápido: dê dois cliques em **`iniciar.bat`**. Ele:

1. sobe a API do projeto na porta 3100 (se ainda não estiver no ar);
2. sobe o servidor da interface na porta **5190**;
3. abre o navegador em `http://localhost:5190`.

Manual, se preferir:

```bat
rem na raiz do projeto (mercado-livre-anuncios-manager)
npm run dev -w @ml-manager/api

rem nesta pasta
node servidor\servidor.js
```

## Estrutura

```
atualizacao-1/
├─ iniciar.bat                  ← sobe tudo de uma vez
├─ servidor/
│  └─ servidor.js               ← entrega a página e repassa /api pro backend (sem dependências)
└─ publico/
   ├─ index.html                ← estrutura da página + ícones SVG próprios
   ├─ estilos/
   │  ├─ base.css               ← temas claro/escuro, reset, layout geral
   │  ├─ componentes.css        ← botões, campos, tabelas, modais, avisos…
   │  ├─ paineis.css            ← estilos de cada painel
   │  └─ responsivo.css         ← ajustes pra tablet e celular
   └─ scripts/
      ├─ aplicativo.js          ← sessão, login, tema, navegação, sincronização
      ├─ api.js                 ← cliente da API com repetição e erros amigáveis
      ├─ utilitarios.js         ← formatação de moeda/data, markdown, ajudantes
      ├─ componentes.js         ← avisos flutuantes, modais, paginação…
      ├─ dados-anuncios.js      ← carga completa de anúncios + histórico local de preços
      ├─ painel-inicio.js       ← visão geral (novo)
      ├─ painel-anuncios.js     ← anúncios oficiais, filtros, ações em massa
      ├─ painel-precos.js       ← precificação (novo, vindo do metrys-hub antigo)
      ├─ painel-concorrentes.js ← disputa de catálogo (novo, vindo do metrys-hub antigo)
      ├─ painel-publico.js      ← consultas públicas (não oficial), com cadeado
      ├─ painel-assistente.js   ← AlphaBot IA com streaming e anexos
      └─ painel-historico.js    ← sessões e linha do tempo
```

## Problemas de conexão que foram corrigidos

| Problema encontrado | Como ficou |
| --- | --- |
| O frontend antigo chamava `http://<máquina>:3100` direto. Acessando pela rede, por túnel ou com a porta 3100 bloqueada no firewall, tudo falhava com `MLAM-LOC-001`. | A página agora chama sempre `/api` no **mesmo endereço** em que ela abriu; o `servidor.js` repassa pro backend. Não existe mais segunda porta exposta pro navegador. |
| CORS: o backend só aceita origens conhecidas — qualquer acesso fora de `localhost:5180`/rede local era recusado silenciosamente. | Com o proxy, a requisição chega ao backend como local. CORS deixou de ser um problema pra interface. |
| Depois do login oficial, o Mercado Livre devolvia o usuário pra `WEB_ORIGIN` (5180, a interface antiga). | O `iniciar.bat` sobe a API com `WEB_ORIGIN=http://localhost:5190`, então o retorno do login cai na interface nova. Se a API já estava aberta por fora, o login volta pra 5180 — basta voltar pra 5190, a sessão é a mesma. |
| Sem diagnóstico: quando a API caía, a tela só mostrava erro genérico. | Novo endpoint `/saude` no servidor + indicador **Servidor** no cabeçalho (verde/laranja/vermelho, com dica no tooltip), verificado a cada 30 s. |

## O que mudou no visual e na organização

- **Menu lateral fixo** com as sete áreas nomeadas em linguagem simples; no celular vira
  **menu de baixo** + gaveta. Nada estoura a tela: tabelas rolam dentro do próprio quadro,
  cartões têm proporção controlada e a tipografia é a do sistema (nada "futurista").
- **Temas claro e escuro** de verdade (variáveis CSS), com transições curtas (0,15–0,25 s),
  respeitando quem pede menos movimento no sistema.
- **Início (novo)**: resumo da conta em números (anúncios, estoque, vendas, valor em estoque,
  promoções, catálogo), atalhos explicados e atividade recente — pensado pra quem é leigo
  se localizar de cara.
- **Anúncios**: filtros agrupados por assunto (status, desempenho, formato, faixas/período),
  seleção da página ou de todos os filtrados, prévia obrigatória antes de qualquer alteração
  em massa, progresso da execução, exportação em planilha e detalhe completo (fotos, ficha,
  variações e concorrência de catálogo).
- **Consultas públicas**: resultados em **cartões visuais** (foto, preço, desconto, vendidos,
  avaliação, vendedor, selos de Pix/catálogo/frete) — era o que mais faltava "trazer
  visualmente" em relação ao metrys-hub antigo. Filtros avançados (vendedor, faixa de preço,
  vendas mínimas), seis ordenações, exportação CSV, consultas arquivadas com comparação
  automática ("3 novos · 2 com preço alterado") e o terminal do processo num modal.
- **Assistente**: conversa com raciocínio recolhível chegando em tempo real, anexos de imagem
  por clique/colagem/arraste, sugestões iniciais, renomear/arquivar/excluir conversas.
- **Histórico**: linha do tempo com ícones por tipo de evento e detalhes das sincronizações.

## O que veio do metrys-hub antigo (e já funciona)

Comparei com `C:\Projetos\metrys-hub\frontend\src\pages` e trouxe o que dava pra fazer
com a API que o backend já tem:

- **Precificação** (antigo `Mlprecos.jsx`) → aba **Preços**: preço/original/desconto/promoção,
  histórico local de variação entre sincronizações e exportação CSV.
- **Análise de Concorrência** (antigo `MlConcorrentes.jsx`) → aba **Concorrentes**: lista os
  anúncios de catálogo e consulta a disputa (vencedor, preço pra ganhar, participantes).
- **Central/Dashboard** (antigo `MLDashboard.jsx`) → aba **Início**.
- **Pesquisa de anúncios** (antigo `MlResearch.jsx`) → o modo "Nome do produto" das consultas
  públicas, agora com visual rico e comparação entre consultas.

## Atualização 2 — o que entrou depois

### Novas abas oficiais (rotas novas no backend, em `apps/api/src/routes/extras.ts`)

| Aba | Endpoint oficial usado | O que faz |
| --- | --- | --- |
| **Vendas** | `GET /orders/search?seller=…` | pedidos com comprador, itens, forma de pagamento, resumo financeiro e exportação CSV |
| **Perguntas · SAC** | `GET /questions/search` + `POST /answers` | perguntas de compradores com resposta direto do painel; bolinha no menu e aviso no cabeçalho quando tem pendência |
| **Tendências** | `GET /trends/MLB` + `GET /users/{id}` | buscas em alta (com atalho pra observar na consulta pública) e reputação do vendedor |
| **Visitas** (aba no detalhe do anúncio) | `GET /items/{id}/visits/time_window` | gráfico de visitas dos últimos 30 dias |

O menu lateral agora separa em grupos: **Conta oficial · API**, **Não oficial** e **Geral** —
as duas fontes de dados nunca se misturam.

### Central de avisos no cabeçalho

Mensagens rotativas voltaram, melhores: giram devagar (45 s por assunto), eventos pontuais
furam a fila (sincronização com mudanças, consulta pública concluída/bloqueada, perguntas sem
resposta), avisos importantes pulsam pra chamar atenção e **clicar abre um modal** com os
detalhes e a lista dos demais avisos ativos.

### Consulta pública — correções e contorno de bloqueios

- **Preço com centavos**: o card lia só a parte inteira (R$ 46 em vez de R$ 42,78) e pegava
  o bloco errado (o preço riscado). Agora junta fração+centavos do bloco correto e descarta
  "desconto" quando o original não é maior que o atual.
- **Todas as fotos**: a galeria completa é extraída (JSON-LD + ids de foto do estado da
  página + galeria renderizada), agrupada por identidade da foto e preferindo a versão 2X.
- **Pix**: além do padrão "desconto no Pix", qualquer menção explícita a Pix na página passa
  a contar, com a evidência distinguindo "com desconto" de "menção sem desconto".
- **Bloqueios**: a consulta **nunca mais morre perdendo o que já leu**. Página bloqueada no
  meio → preserva os itens e repete no final com espera de 25–45 s. Bloqueio logo na primeira
  página → até 3 tentativas com esperas crescentes (30–60 s). Se ainda assim ficar parcial,
  o aviso do cabeçalho explica e recomenda aguardar alguns minutos.
- **Ativação persistente**: depois de liberar com o código, a área continua ativa entre
  recarregadas — só desativa no interruptor.

### Conectar sem webcam (reconhecimento facial no celular)

O Mercado Livre às vezes exige reconhecimento facial. Sem câmera no PC, use **“Conectar pelo
celular”** (na tela de entrada ou no menu Opções): o sistema gera o link de autorização, você
abre no telefone (copiando ou mandando pro WhatsApp), faz a verificação lá e **a conta conecta
no computador** — o vínculo é feito pela sessão que gerou o link, não pelo aparelho.
O `iniciar.bat` também sobe o túnel do ngrok automaticamente (o domínio vem do
`ML_REDIRECT_URI` no `.env`; o token do agente já ficou configurado).

### IA e histórico

- O prompt do AlphaBot foi ampliado no backend: agora ele **escreve títulos, descrições e
  respostas a compradores de verdade**, além de tudo sobre vender no Mercado Livre.
- As sugestões da tela inicial mudam conforme os eventos (pergunta pendente vira rascunho,
  consulta concluída vira análise) e sorteiam ideias novas a cada visita.
- Histórico ganhou cartões de resumo (eventos de hoje, sincronizações, falhas…), busca por
  texto, filtro por período, filtro "só falhas" e os dados completos de cada evento.

## Atualização 3 — login local, hierarquia e permissões

Agora o sistema tem **login próprio** (separado da conta do Mercado Livre), com
três níveis de acesso:

- **Fundador (Owner)** — a primeira conta criada. Acesso total, aprova/recusa
  Administradores e modera todos os usuários. Conta protegida (não dá pra excluir
  enquanto for o único).
- **Administrador** — conta de empresa. Cadastra-se sozinho e entra como
  **pendente**; só loga depois que o Fundador aprovar. Cria e gerencia os próprios
  usuários, define permissões página por página, exclui esses usuários. Pode
  excluir a própria conta (com confirmação por texto), o que apaga em cascata
  todos os usuários vinculados.
- **Usuário** — criado pelo Administrador nas Opções → Gerenciar usuários, com
  nome, e-mail, CPF, telefone e endereço. O Administrador marca **quais abas** ele
  acessa (checkbox por página). O que estiver bloqueado some do menu; se a pessoa
  tentar forçar o acesso, aparece a **censura** com faixas diagonais, cadeado e o
  texto “Acesso bloqueado”.

Recuperação de senha é **local**, por pergunta secreta (sem servidor de e-mail).

**Onde fica:** backend em `apps/api` (modelo `AppUser`, `routes/autenticacao.ts`,
`routes/gestao-usuarios.ts`, `lib/permissoes.ts`, `middleware/usuario.ts`); frontend
em `scripts/autenticacao.js`, `scripts/permissoes.js`, `scripts/painel-usuarios.js`.
Testado por `tests/autenticacao.test.ts` (4 testes) e no navegador de ponta a ponta.

O **instalador** (`iniciar.bat`) foi reforçado: instala dependências na primeira
vez, roda o setup que **migra o banco** (cria a tabela de usuários mesmo em
instalações antigas, sem apagar nada) e só então sobe API, ngrok e interface.

## Funcionalidades da lista (comparação com o Shopping de Preços)

Já entrou nesta atualização:

- **Respostas pré-definidas (modelos)** na aba Perguntas · SAC — monte um texto uma
  vez e aplique com um clique. É a “resposta automática” do concorrente.

Em construção (cada uma já tem a **permissão/aba reservada** em `lib/permissoes.ts`,
então o gate e a censura funcionam assim que o backend de cada uma for ligado):

| Aba reservada | Endpoint oficial | Status |
| --- | --- | --- |
| Promoções e cupons | `/seller-promotions`, `/lightning_deals` | a fazer |
| Automação de preços | `/prices/automation` (repricing) | a fazer |
| Envios e etiquetas | `/shipments`, `/shipment_labels` | a fazer |
| Financeiro | `/billing/…`, `/payments`, custos por vender | a fazer |
| Notas fiscais (opt-in) | Faturador ML | a fazer — **sempre opcional/manual** |
| Mensagens pós-venda | `/messages/…` | a fazer |
| Reclamações | `/post-purchase/v1/claims/search` | a fazer |
| Qualidade dos anúncios | `/items/{id}/health` | a fazer |
| Publicidade (Ads) | Mercado Ads / Product Ads | a fazer |
| Webhooks (notificações) | tópicos `orders`, `questions`, `items`, `claims` | a fazer |
| Alertas de concorrente | reconsulta de ranking + central de avisos | a fazer |

> **Nota sobre a NF-e:** conforme combinado, a emissão de nota fiscal será
> **sempre opcional e manual** — nunca automática. Fica atrás de um interruptor
> desligado por padrão.

## Atualização 4 — chat da equipe, pausa programada e blindagem

### Chat da equipe (estilo WhatsApp)

Nova aba **Chat da equipe** (grupo Geral, sempre liberada): conversas 1 a 1 com
balões, separador por dia, ✓/✓✓ de lida, **fixar**, **arquivar**, **apagar
conversa só pra mim** e **apagar mensagem** (vira "mensagem apagada" pros dois
lados). Quem fala com quem: o **Fundador fala com todos**; Administrador e seus
usuários falam entre si (mesma empresa) e com o Fundador — empresas diferentes
não se enxergam. **Foto de perfil** em Opções → Foto de perfil (ou clicando no
avatar do cabeçalho): a imagem é reduzida a 128px no navegador e aparece no chat
e no site. Bolinha de não lidas no menu, atualizada a cada 45 s.
Backend em `apps/api/src/routes/chat.ts`, testado por `tests/chat.test.ts`.

### Consulta pública — pausa programada e mais produtos

- **"Pausar a cada X produtos"** (controle ao lado do interruptor de ativar):
  a busca para na quantidade escolhida e pergunta **"Deseja continuar a busca?"**
  — continuar retoma na hora sem repetir nada (e pausa de novo a cada X);
  finalizar passa direto pra leitura dos detalhes do que já foi encontrado.
- **A trava dos ~160 produtos foi encontrada e corrigida**: as listas do
  Mercado Livre escondem o link "Seguinte" (rolagem infinita), e a leitura
  parava ali. Agora o próximo endereço é montado manualmente (`_Desde_49`,
  `_Desde_97`…) enquanto a página render itens novos. Além disso, no modo loja
  existe a **etapa 2**: o sistema lê um anúncio, descobre o número do vendedor
  e varre o catálogo público dele (`_CustId_` numérico, o formato que a busca
  aceita de verdade).
- **Pix**: outro bug real corrigido — o texto dos elementos era colado sem
  espaço ("pagamentoPixBoleto"), e a palavra Pix passava despercebida. Agora a
  extração separa os elementos e a menção é detectada (com teste cobrindo).

### Segurança por área na API

Todas as rotas sensíveis agora exigem **login local + a permissão da aba**:
`/listings`, `/sync`, `/bulk`, `/export`, `/pedidos`, `/perguntas`,
`/tendencias`, `/unofficial/*`, `/ai`, `/history`, `/chat`… Um usuário sem a
permissão "Vendas" recebe `AREA_BLOQUEADA` na API — não é só a tela que
esconde, o dado não sai do servidor. A única exceção é o **modo inicial**
(instalação sem nenhum usuário), senão não daria pra criar o Fundador.

### Instalador 1.2.0 (Electron)

- Visual refeito com a **mesma identidade do site** (tema escuro, azul padrão,
  logo real, indicadores de saúde Servidor/Interface iguais aos do cabeçalho).
- **Botão "Editar .env"** abre as credenciais no Bloco de Notas.
- **Correção**: o botão Reiniciar subia a interface antiga (porta 5180); agora
  reinicia igual ao Iniciar (API + interface nova na 5190).
- **Atualização de verdade**: em instalações existentes, o Setup agora
  sobrescreve o código (apps, exemplos, scripts) preservando `.env` e banco.
- Executável novo: `instalador/dist/MarketSync Setup 1.2.0.exe`.
