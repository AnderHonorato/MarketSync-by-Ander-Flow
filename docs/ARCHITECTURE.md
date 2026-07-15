# Arquitetura

## Objetivo

Este projeto é uma aplicação independente para consultar e administrar somente os anúncios pertencentes ao seller autenticado. O projeto `metrys-hub` é referência histórica e não é dependência de build, execução, banco ou autenticação.

## Fluxo de dados

1. O navegador recebe uma sessão opaca em cookie `httpOnly`.
2. O backend cria `state` e PKCE aleatórios e redireciona ao domínio oficial de autorização.
3. O callback consome o `state` uma única vez, troca o `code` no corpo form-encoded e valida a conta com `/users/me`.
4. Access e refresh tokens são cifrados com AES-256-GCM antes de serem persistidos.
5. A sincronização lista IDs pelo recurso do seller e enriquece lotes de no máximo 20 itens.
6. Filtros, ordenação e paginação operam sobre snapshots locais. Dados caros são carregados sob demanda.
7. Toda escrita revalida sessão, CSRF, propriedade e o estado atual do anúncio na API.

## Componentes

- `apps/api`: Express, TypeScript, Prisma e SQLite.
- `apps/web`: React, TypeScript e Vite.
- `docs`: contratos oficiais, API interna, segurança e limitações.
- `e2e`: testes de fluxos visíveis e responsividade.

## Persistência

- sessões opacas e CSRF;
- estados OAuth de uso único e validade curta;
- conta do seller e tokens cifrados;
- snapshots de anúncios e vendas;
- jobs de sincronização canceláveis;
- prévias e execuções de operações em massa;
- trilha de auditoria sem tokens.

SQLite é o padrão local e mantém o projeto simples e independente. Para múltiplas instâncias em produção, migre o provider Prisma para PostgreSQL e use uma fila/lock distribuído, preservando os mesmos contratos.

## Cache e limites

O cache possui TTL, deduplicação de requisições simultâneas e invalidação após alterações. Retries são limitados a falhas temporárias (`429` e `5xx`), usam backoff exponencial com jitter e respeitam `Retry-After`. Erros permanentes não são repetidos.

Os valores de concorrência configuráveis são limites internos conservadores; não representam uma cota oficial.
