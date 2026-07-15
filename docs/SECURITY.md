# Segurança

## Controles implementados

- cookie de sessão opaco, `httpOnly`, `sameSite=lax` e `secure` em produção;
- sessão armazenada no servidor com expiração e rotação no login;
- token CSRF vinculado à sessão para `POST`, `PUT`, `PATCH` e `DELETE`;
- OAuth Authorization Code com PKCE S256;
- `state` aleatório, expirável, vinculado à sessão e consumido uma única vez;
- tokens do Mercado Livre cifrados em repouso com AES-256-GCM;
- refresh token rotativo persistido atomicamente e protegido por lock por conta;
- credenciais enviadas somente no corpo `application/x-www-form-urlencoded` para `/oauth/token`;
- headers de segurança e CORS restrito ao frontend configurado;
- validação de entrada com schemas e limites de payload;
- seller ID derivado da sessão, nunca aceito como identidade enviada pelo frontend;
- validação de `seller_id` antes de leitura detalhada e de toda alteração;
- idempotência e confirmação em duas fases para operações em massa;
- logs e auditoria sem access token, refresh token, secret ou cookie;
- proteção contra formula injection nas exportações.

## Segredos

Nunca copie valores do `.env` do projeto de referência. Crie uma aplicação separada no DevCenter e gere uma chave de cifragem exclusiva. O arquivo `.env` não deve ser versionado.

O projeto de referência possui um `.env` rastreado pelo Git. As credenciais nele existentes devem ser consideradas expostas e rotacionadas no painel de cada provedor. Essa correção operacional não é feita automaticamente por este projeto para preservar o escopo original.

## Produção

- use HTTPS e `COOKIE_SECURE=true`;
- armazene `TOKEN_ENCRYPTION_KEY` e `ML_CLIENT_SECRET` em secret manager;
- use PostgreSQL/lock distribuído se executar mais de uma instância;
- restrinja e monitore os callbacks cadastrados;
- configure backup cifrado do banco;
- aplique retenção e controle de acesso aos logs de auditoria;
- revise permissões funcionais no DevCenter e conceda apenas `read`, `write` e `offline_access` necessários.
