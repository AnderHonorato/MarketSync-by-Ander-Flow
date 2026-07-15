# Mercado Livre Anúncios Manager

Aplicação independente para consultar, filtrar, exportar e alterar com segurança os próprios anúncios de uma conta Mercado Livre. Dados e alterações da conta usam OAuth e endpoints documentados. Em uma aba separada existe uma leitura pública opcional, sem credenciais oficiais, identificada na interface como **não oficial**. Ela usa um navegador local com pausas conservadoras, não altera anúncios e pode ser bloqueada pelo site externo.

## O que o sistema entrega

- entrada e saída com OAuth Authorization Code + PKCE;
- sessão própria em cookie `httpOnly` e proteção CSRF;
- tokens cifrados em repouso e refresh automático serializado;
- identificação do nickname e ID do seller conectado;
- sincronização paginada e cancelável dos anúncios próprios;
- busca, filtros combináveis, chips, ordenação e paginação;
- tabela compacta, seleção entre páginas e detalhes sob demanda;
- filtros oficiais de status, catálogo, promoções, estoque, vendas, idade e qualidade disponível;
- pontuação interna opcional, claramente separada das métricas oficiais;
- operações em massa em duas fases, com prévia, confirmação, idempotência, lotes, auditoria e relatório;
- exportação `.xlsx` com abas para anúncios, variações, atributos, indisponibilidades e metadados;
- tratamento conservador de `429`, `Retry-After`, erros temporários, cache e deduplicação.
- modo opcional por URL pública de página/loja, com leitura progressiva e “Pix observado” separado do Pix oficial;
- visualização em layout próprio e tentativa de abrir a página oficial no modal;
- ajuda contextual, atalhos de cópia e mensagens de atividade no cabeçalho.
- histórico persistente de sessões, autenticações, sincronizações e movimentos importantes;
- comparação visual entre sincronizações, com anúncios adicionados, alterados ou não retornados;
- tema escuro opcional e restauração das preferências ao reabrir a página.

## Requisitos

- Node.js 20.19 ou superior;
- npm 10 ou superior;
- uma aplicação própria no [DevCenter do Mercado Livre](https://developers.mercadolivre.com.br/) somente para recursos oficiais;
- conta principal/administradora do seller para concluir a autorização;
- HTTPS em produção.

## Instalação

```powershell
cd C:\Projetos\metrys-hub\mercado-livre-anuncios-manager
npm install
npm run setup
npm run db:generate
npm run db:migrate
```

`npm run setup` cria o `.env` quando necessário, gera uma chave de criptografia local, aplica as migrações pendentes e inicializa o SQLite. O modo público abre sem credenciais. Para recursos oficiais, preencha `ML_CLIENT_ID`, `ML_CLIENT_SECRET` e o callback HTTPS exato cadastrado no DevCenter. O comando `npm run dev` também executa o preparo automaticamente.

Se o executável nativo de migração do Prisma for bloqueado pelo Windows/antivírus, use o inicializador SQLite local versionado:

```powershell
npm run db:init:local -w @ml-manager/api
```

Esse fallback executa a mesma migração SQL do projeto com o SQLite incluído no Node.js 22; ele não altera o projeto Metrys Hub original.

Preencha o `.env` antes de iniciar. Gere uma chave de cifragem de 32 bytes:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copie o resultado para `TOKEN_ENCRYPTION_KEY`. Nunca exponha essa chave, o secret do aplicativo ou tokens no frontend.

## Configuração no Mercado Livre

1. Use a aplicação cadastrada para esta integração.
2. Habilite as permissões funcionais necessárias para Produtos/Publicações, Vendas, Promoções, Catálogo e Automatizações de preços conforme as funções desejadas.
3. Garanta os escopos OAuth `read`, `write` e `offline_access`.
4. Cadastre exatamente o callback HTTPS fixo usado no `.env`. Neste computador, o callback preparado é:

   `xxxxx.ngrok-free.dev/api/ml/callback`

5. Inicie o túnel com `npm run dev:https` antes de conectar a conta.
6. Mantenha `PUBLIC_APP_URL=http://localhost:5180`: o callback HTTPS associa a autorização à sessão local por um `state` opaco, de uso único e com expiração curta.

O `redirect_uri` enviado na autorização e na troca do code deve ser idêntico ao cadastrado no DevCenter.

## Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
|---|---:|---|
| `ML_CLIENT_ID` | sim | App ID da nova aplicação |
| `ML_CLIENT_SECRET` | sim | Secret da nova aplicação; somente backend |
| `ML_REDIRECT_URI` | sim | callback exato cadastrado |
| `TOKEN_ENCRYPTION_KEY` | sim | chave Base64 de 32 bytes para AES-256-GCM |
| `DATABASE_URL` | sim | banco próprio; padrão SQLite local |
| `PORT` | sim | porta do backend, padrão `3100` |
| `WEB_ORIGIN` | sim | origem exata permitida no CORS |
| `PUBLIC_APP_URL` | sim | destino seguro após o callback |
| `COOKIE_SECURE` | produção | deve ser `true` sob HTTPS |
| `CACHE_TTL_SECONDS` | não | TTL do cache de leitura |
| `SYNC_CONCURRENCY` | não | concorrência interna da sincronização |
| `BULK_CONCURRENCY` | não | concorrência interna de alterações |
| `BULK_DELAY_MS` | não | intervalo conservador entre alterações |
| `VITE_API_BASE_URL` | sim | URL do backend usada pelo frontend |

## Execução

Desenvolvimento, com backend e frontend:

```powershell
npm run dev
```

Desenvolvimento com o callback HTTPS necessário para conectar a conta:

```powershell
npm run dev:https
```

O segundo comando inicia também o domínio ngrok fixo configurado. Antes de conectar, entre normalmente em `mercadolivre.com.br` no mesmo navegador; bloqueios na página de login do marketplace acontecem antes do callback e não indicam falha das credenciais locais.

- frontend: `http://localhost:5180`
- backend: `http://localhost:3100`

Build e execução de produção:

```powershell
npm run build
$env:NODE_ENV = 'production'
$env:COOKIE_SECURE = 'true'
npm start
```

## Fluxo OAuth e renovação

1. O backend cria uma sessão opaca, PKCE e `state` aleatórios.
2. O navegador é redirecionado ao domínio oficial do Mercado Livre.
3. O callback HTTPS localiza a tentativa original pelo hash do `state`, valida expiração e uso único e nunca usa o `state` como identidade de usuário.
4. O `code` é trocado no corpo form-encoded do `POST /oauth/token`.
5. `/users/me` valida a identidade real do token.
6. Access e refresh tokens são cifrados e persistidos.
7. Antes de uma chamada autenticada, o backend usa `expires_in` retornado pela API e renova quando necessário.
8. O refresh é serializado por conta porque apenas o refresh token mais recente é válido e cada token é de uso único.
9. Se houver `invalid_grant` ou revogação, a conta é marcada para reconexão e os tokens locais são removidos com segurança.

## Sincronização e paginação

Para até 1.000 anúncios, o sistema usa `/users/{seller}/items/search` com `offset` e `limit` de no máximo 100. Para volumes maiores, usa `search_type=scan`, consome o `scroll_id` continuamente e respeita sua validade curta. Os IDs são hidratados via multiget em lotes de no máximo 20.

A opção “Ver todos” não cria uma única requisição gigante: ela percorre páginas internas, mostra progresso, permite cancelamento e mantém a renderização paginada/virtualizável. Descrição, galeria completa, visitas, promoções, performance e catálogo são carregados apenas quando necessários.

### Histórico, persistência e comparação

A aba **Histórico** registra sessões, tempo ativo aproximado, autenticação, desconexão, sincronizações, operações em massa e movimentos relevantes da interface. Esses registros ficam no banco local e não incluem tokens, cookies ou credenciais.

Após cada sincronização, os dados atuais são comparados ao snapshot anterior. A tabela destaca anúncios adicionados e alterados e detalha os campos que mudaram. Quando um anúncio deixa de aparecer na consulta, ele é marcado como **não retornou**; isso não afirma que o anúncio foi apagado no Mercado Livre.

Tema, aba, filtros, seleção e resultados públicos ficam salvos localmente e são restaurados ao reabrir a página. Seleções para alterações oficiais em massa não são restauradas, evitando executar uma ação antiga por engano. **Resetar tudo** exige digitar `CONFIRMAR` e apaga conta local, tokens cifrados, snapshots, histórico, conversas da Metrys e preferências. Essa operação não apaga anúncios no Mercado Livre.

## Filtros e métricas

Os filtros de status, estoque, catálogo, promoção, idade, preço, quantidade vendida, SKU, categoria, condição e tipo de anúncio podem ser combinados. Os filtros temporais de vendas usam pedidos oficiais de até 12 meses e snapshots prospectivos.

Não existe um campo oficial genérico de “relevância”. Quando ativada, a **Pontuação interna** combina dados disponíveis e é exibida como métrica derivada, nunca como ranking oficial. A fórmula e os pesos ficam visíveis na interface e na documentação interna.

Pix não é uma propriedade geral do anúncio na API. Quando a API retorna uma campanha `BANK/COFINANCED` com `payment_method=PIX`, ela aparece como **Campanha Pix oficial**. Separadamente, a leitura pública pode abrir cada página e marcar **Pix observado** somente quando encontra a oferta escrita no conteúdo visível. Ausência ou bloqueio de leitura fica como não verificado, nunca como aceitação confirmada.

## Operações em massa

Uma operação nunca é executada ao abrir a tela. O fluxo é:

1. seleção explícita;
2. prévia obtida no backend;
3. validação de propriedade e do estado atual;
4. comparação antes/depois e avisos;
5. token de confirmação curto e idempotency key;
6. confirmação explícita;
7. fila com concorrência limitada;
8. resultado individual, auditoria e relatório.

São expostas apenas ações documentadas e válidas para cada item. `closed` é irreversível. Alteração de preço é bloqueada quando há automação ativa. Estoque Multi Origem e Full seguem regras próprias; o sistema não força `available_quantity` quando esse campo não é editável.

## Exportação Excel

O nome segue `anuncios-mercado-livre-AAAA-MM-DD-HHmm.xlsx`. A exportação aceita página atual, selecionados, resultados filtrados e carregados. Valores iniciados por `=`, `+`, `-` ou `@` são escapados contra formula injection. Fotos são exportadas como URLs por padrão.

## Tratamento de erros e limites

- `400`: validação visível; sem retry automático;
- `401`: refresh uma vez; se falhar, reconectar;
- `403`: verificar seller, escopos, aplicação, conta e permissões; sem retry cego;
- `404`: registrar item ausente/encerrado;
- `409`: bloquear duplicidade/idempotência;
- `429`: respeitar `Retry-After`, backoff exponencial com jitter e reduzir concorrência;
- `5xx`/rede: poucas tentativas com backoff; relatório de falha se persistir.

O Mercado Livre não publica uma cota numérica global única. Os limites internos configurados neste projeto são conservadores e não afirmam uma RPM oficial.

## Testes

```powershell
npm test
npm run test:coverage
npm run build
npm run test:e2e
```

Os testes automatizados usam doubles HTTP e banco isolado; não executam alterações reais em uma conta. O OAuth real e escritas reais exigem uma aplicação e usuários de teste configurados no DevCenter.

## Documentação adicional

- [Arquitetura](docs/ARCHITECTURE.md)
- [API oficial utilizada](docs/OFFICIAL_API.md)
- [API interna](docs/INTERNAL_API.md)
- [Limitações](docs/LIMITATIONS.md)
- [Segurança](docs/SECURITY.md)

## Limitações importantes

- histórico de pedidos: até 12 meses, conforme documentação atual;
- visitas por intervalo: janela máxima documentada de 150 dias;
- tempo ativo líquido descontando todas as pausas históricas não é fornecido integralmente;
- conversão é uma métrica derivada quando calculada;
- posição orgânica individual não é disponibilizada como campo geral;
- descrição não possui multiget documentado;
- encerramento não pode ser revertido;
- operações de promoção variam por tipo, convite e país;
- estoque Full é administrado pelo Mercado Livre;
- filtros ou ações ausentes na API permanecem explicitamente indisponíveis.

Este projeto não contém dados fictícios de produção nem botões simulados. Sem credenciais, a interface abre no modo público; funções oficiais continuam bloqueadas. Os testes usam banco isolado e fixtures somente no ambiente de teste.
