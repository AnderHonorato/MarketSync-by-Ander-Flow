# API interna

Todas as rotas abaixo usam sessão própria em cookie `httpOnly`. Rotas mutáveis exigem o header `X-CSRF-Token` recebido em `GET /api/session`.

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/session` | Estado da sessão e token CSRF |
| GET | `/api/auth/mercadolivre/start` | Inicia OAuth com state e PKCE |
| GET | `/api/auth/mercadolivre/callback` | Valida callback e vincula a conta |
| POST | `/api/auth/logout` | Remove tokens locais e encerra a sessão |
| GET | `/api/account` | Conta conectada e capacidades |
| GET/POST/DELETE | `/api/sync` | Consulta, inicia ou cancela sincronização |
| GET | `/api/history?limit=100` | Lista sessões e eventos visíveis para a sessão/conta atual |
| POST | `/api/history/activity` | Registra movimentos permitidos da interface |
| POST | `/api/history/heartbeat` | Atualiza o tempo ativo aproximado da sessão |
| GET | `/api/listings` | Busca, filtros, ordenação e paginação local |
| GET | `/api/listings/:id` | Detalhes e dados oficiais sob demanda |
| POST | `/api/bulk/preview` | Valida seleção e cria prévia idempotente |
| POST | `/api/bulk/execute` | Confirma e inicia operação revisada |
| GET | `/api/bulk/:id` | Acompanha resultados individuais |
| GET | `/api/export.xlsx` | Exporta anúncios da conta autenticada |

Erros usam `{ "error": { "code": "...", "message": "..." } }`. Tokens e segredos nunca fazem parte das respostas.

O histórico retorna somente metadados sanitizados. Endereço IP, hash de IP, tokens, cookies, segredos e credenciais não são expostos pela API.
