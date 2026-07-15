# API oficial do Mercado Livre

Pesquisa validada em **11/07/2026**, exclusivamente na documentação e nos recursos oficiais do Mercado Livre Developers. Este documento é o contrato de integração do projeto: nenhuma rota, campo, filtro ou mutação fora desta lista deve ser presumida como disponível.

Base da API: `https://api.mercadolibre.com`

## Autorização e escopos

- Recursos privados e todas as mutações devem usar `Authorization: Bearer <access_token>` do seller conectado.
- O backend deve obter o `seller_id` da sessão/token e não aceitar outro seller arbitrário enviado pelo frontend.
- No DevCenter, o escopo **Somente leitura** permite `GET`; o escopo **Leitura e escrita** é necessário para `POST`, `PUT` e `DELETE.
- A API ainda valida propriedade e elegibilidade em cada recurso. Ter escopo de escrita não autoriza alterar anúncio, pedido ou promoção de outro seller.
- Não enviar access token na query string. Não expor token, refresh token ou Client Secret no navegador ou nos logs.

Referência: [Permissões funcionais](https://developers.mercadolivre.com.br/pt_br/produto-autenticacao-autorizacao/permissoes-funcionais).

## Matriz de endpoints

### Anúncios, catálogo e métricas

| Finalidade | Método e recurso | Parâmetros/corpo relevantes | Paginação e limites documentados | Escopo | Viabilidade e observações | Documentação oficial |
|---|---|---|---|---|---|---|
| Listar anúncios do seller | `GET /users/{seller_id}/items/search` | `status`, `sku`, `seller_sku`, `catalog_listing`, `tags`, `listing_type_id`, `reputation_health_gauge`, `orders`, `include_filters`, `offset`, `limit` | Padrão `limit=50`, máximo 100. Para mais de 1.000 resultados usar scan | Leitura | **Sim.** Retorna IDs; os detalhes devem ser hidratados em multiget | [Itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) |
| Percorrer mais de 1.000 anúncios | `GET /users/{seller_id}/items/search?search_type=scan` e próximas páginas com `scroll_id` | `search_type=scan`, depois `scroll_id`; remover `offset` | `scroll_id` expira em 5 minutos. Não combinar scan com `offset/limit` incompatíveis | Leitura | **Sim.** Consumir continuamente até resultado final/nulo; adequado para sincronização/exportação progressiva | [Itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) |
| Buscar por SKU | `GET /users/{seller_id}/items/search?sku=...` ou `?seller_sku=...` | `sku` consulta o legado `seller_custom_field`; `seller_sku` consulta o atributo `SELLER_SKU` | Regras da busca do seller | Leitura | **Sim.** Não tratar os dois campos como equivalentes | [Itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) |
| Detalhar anúncios em lote | `GET /items?ids={id1,id2,...}&attributes={campos}` | `ids`, `attributes`, token do proprietário para campos privados | Máximo de 20 itens por multiget | Leitura | **Sim.** Usar lotes de até 20 e selecionar apenas os campos necessários | [Itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) |
| Detalhar um anúncio | `GET /items/{item_id}` | `include_attributes=all` quando necessário | Um item | Leitura | **Sim.** Com token proprietário, estoque e vendidos são exatos; consultas públicas podem omitir ou aproximar campos | [Publicar produtos](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos) |
| Descrição | `GET /items/{item_id}/description` | `item_id` | Um item | Leitura | **Sim, sob demanda.** Não carregar descrições de toda a base no primeiro acesso | [Publicar produtos](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos) |
| Catálogo vs. tradicional | `GET /users/{seller_id}/items/search?catalog_listing=true|false` | `catalog_listing`; pode combinar `status` | Regras da busca do seller | Leitura | **Sim.** Também ler `catalog_listing` e `catalog_product_id` no item | [Elegibilidade de catálogo](https://developers.mercadolivre.com.br/pt_br/elegibilidade-de-catalogo) |
| Elegibilidade para catálogo | `GET /items/{item_id}/catalog_listing_eligibility`; `GET /multiget/catalog_listing_eligibility?ids=...`; ou busca com `tags=catalog_listing_eligible` | `item_id` ou `ids` | Há multiget oficial; manter lotes conservadores | Leitura | **Sim.** Estados incluem `READY_FOR_OPTIN`, `ALREADY_OPTED_IN`, `NOT_ELIGIBLE`, `PRODUCT_INACTIVE`, `COMPETING` e `CLOSED` | [Elegibilidade de catálogo](https://developers.mercadolivre.com.br/pt_br/elegibilidade-de-catalogo) |
| Competição no catálogo | `GET /items/{item_id}/price_to_win?version=v2` | `version=v2` | Um item por chamada | Leitura | **Sim, quando aplicável ao catálogo.** Retorna `status`, `price_to_win`, `visit_share`, `boosts`, `reason`, `catalog_product_id` e `winner` | [Concorrência em catálogo](https://developers.mercadolivre.com.br/pt_br/concorrencia-em-catalogo) |
| Qualidade do anúncio | `GET /item/{item_id}/performance` | Atenção ao singular `/item/` | Um item; exige token do proprietário | Leitura | **Sim.** `score` vai de 0 a 100; também retorna nível, buckets, regras e ações. O `/health` genérico foi substituído por `/performance` | [Qualidade das publicações](https://developers.mercadolivre.com.br/pt_br/como-comecar/qualidade-das-publicacoes) |
| Perda de exposição por reputação | `GET /users/{seller_id}/items/search?reputation_health_gauge=healthy|warning|unhealthy` | `reputation_health_gauge` | Regras da busca do seller | Leitura | **Sim.** É diferente do score de qualidade: reflete impacto por reclamações/cancelamentos | [Itens e buscas](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) |
| Visitas totais | `GET /visits/items?ids={item_id}` | `ids` | Documentação atual limita a um item; total dos últimos dois anos | Leitura | **Sim, sob demanda/cache.** Não existe multiget amplo oficial | [Visitas](https://developers.mercadolivre.com.br/pt_br/atributos/recurso-visits) |
| Visitas por intervalo | `GET /items/visits?ids={item_id}&date_from={ISO}&date_to={ISO}` | `date_from`, `date_to`, um `item_id` | Janela máxima de 150 dias | Leitura | **Sim.** Dividir períodos maiores em janelas e somar sem sobreposição | [Visitas](https://developers.mercadolivre.com.br/pt_br/atributos/recurso-visits) |
| Série diária de visitas | `GET /items/{item_id}/visits/time_window?last={N}&unit=day&ending={YYYY-MM-DD}` | `last`, `unit=day`, `ending` opcional | Um item; janela máxima equivalente a 150 dias | Leitura | **Sim.** Útil para métrica interna e gráficos; carregamento preguiçoso | [Visitas](https://developers.mercadolivre.com.br/pt_br/atributos/recurso-visits) |
| Pedidos/vendas por período | `GET /orders/search?seller={seller_id}&order.status=paid&order.date_created.from={ISO}&order.date_created.to={ISO}&sort=date_desc` | `seller`, `order.status`, filtros `order.date_created.*`, `order.date_closed.*`, `order.date_last_updated.*`, `q`, `offset`, `limit`, `sort` | Padrão 50; pedidos persistidos por até 12 meses | Leitura | **Sim.** Agrupar `order_items[].item.id` e somar `quantity`; tratar cancelamentos/reembolsos conforme a regra da métrica | [Gerenciar orders](https://developers.mercadolivre.com.br/pt_br/busca-de-produtos-por-vendedor/gerenciamento-de-vendas) |
| Detalhar pedido e pagamento | `GET /orders/{order_id}` | `order_id` | Um pedido | Leitura | **Sim.** A forma efetiva de pagamento está em `payments[]`; pode haver resposta `206 Partial Content` | [Gerenciar orders](https://developers.mercadolivre.com.br/pt_br/busca-de-produtos-por-vendedor/gerenciamento-de-vendas) |

### Atualizações de anúncios, preço, estoque e frete

| Finalidade | Método e recurso | Parâmetros/corpo relevantes | Limite/concorrência | Escopo | Viabilidade e observações | Documentação oficial |
|---|---|---|---|---|---|---|
| Pausar | `PUT /items/{item_id}` | `{"status":"paused"}` | Um item por chamada | Leitura e escrita | **Sim.** Pausa do seller é diferente de `out_of_stock` | [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) |
| Reativar | `PUT /items/{item_id}` | `{"status":"active"}` | Um item por chamada | Leitura e escrita | **Sim**, somente de estados reativáveis e após validação da API | [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) |
| Encerrar | `PUT /items/{item_id}` | `{"status":"closed"}` | Um item por chamada | Leitura e escrita | **Sim, destrutivo.** `closed` é definitivo; só é possível republicar, não reativar | [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) |
| Estoque comum | `PUT /items/{item_id}` | `{"available_quantity":N}` | Um item por chamada | Leitura e escrita | **Sim.** Zero pode pausar como `out_of_stock`; valor positivo pode reativar se não estiver `paused_by_seller` | [Sincronização de publicações](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) |
| Estoque por variação | `PUT /items/{item_id}/variations/{variation_id}` | `available_quantity` e somente campos permitidos da variação | Uma variação por chamada | Leitura e escrita | **Sim**, no modelo legado compatível. No novo modelo User Products, respeitar a estrutura do UP | [Variações](https://developers.mercadolivre.com.br/pt_br/tendencias/variacoes) |
| Consultar estoque distribuído | `GET /user-products/{user_product_id}/stock` | `user_product_id`; guardar header `x-version` | Um User Product | Leitura | **Sim** para sellers/itens com esse modelo | [Estoque Multi Origem](https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem) |
| Atualizar estoque Multi Origem | `PUT /user-products/{user_product_id}/stock/type/seller_warehouse` | Header `x-version`; `locations[{store_id,network_node_id,quantity}]` | Por User Product/localizações; `409` em versão obsoleta | Leitura e escrita | **Sim, condicional.** Detectar tags `warehouse_management` e `multiwarehouse`. Estoque Full (`meli_facility`) não é editável pelo seller | [Estoque Multi Origem](https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem) |
| Alterar preço padrão | `PUT /items/{item_id}` | `{"price":novo_valor}` | Um item por chamada | Leitura e escrita | **Sim apenas sem automação de preço ativa.** Percentual/valor/arredondamento são calculados internamente; enviar valor absoluto validado | [Sincronização](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) |
| Ler preços e preço efetivo | `GET /items/{item_id}/prices`; `GET /items/{item_id}/sale_price?context=channel_marketplace` | `context`; outros contextos somente quando documentados | Um item | Leitura | **Sim.** Não tratar `original_price` como histórico completo de preços | [API de preços](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/api-de-precos) |
| Listar itens com automação de preço | `GET /pricing-automation/users/{seller_id}/items?offset={N}&limit={N}` | `offset`, `limit` | Padrão 50, máximo 100 | Leitura | **Sim e obrigatório antes de preço em massa.** A tag do item `dynamic_standard_price` também identifica automação | [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/automatizacoes-de-precos) |
| Consultar/gerir automação de um item | `GET|POST|PUT|DELETE /pricing-automation/items/{item_id}/automation` | `rule_id`, `min_price`, `max_price` para escritas | Um item | GET: leitura; demais: leitura e escrita | **Condicional.** Não remover ou mudar automação implicitamente para viabilizar alteração de preço | [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/automatizacoes-de-precos) |
| Histórico de preço automatizado | `GET /pricing-automation/items/{item_id}/price/history?days={N}&page={N}&size={N}` | `days` padrão 30, `page` padrão 0, `size` padrão 10 | Paginado | Leitura | **Sim**, apenas para eventos da automação; não é histórico geral de preço padrão | [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/automatizacoes-de-precos) |
| Alterar SKU | `PUT /items/{item_id}` com atributo `SELLER_SKU`; para variação usar seus `attributes` | ID `SELLER_SKU`, valor conforme schema | Um item/variação | Leitura e escrita | **Sim, condicional.** `seller_custom_field` é campo legado/interno distinto | [Variações e SKU](https://developers.mercadolivre.com.br/pt_br/tendencias/variacoes) |
| Validar atributos da categoria | `GET /categories/{category_id}/attributes`; `GET /categories/{category_id}/technical_specs/input` | `category_id` | Por categoria; pode ser cacheado | Leitura | **Sim.** Respeitar `required`, `read_only`, `inferred`, tipos, unidades e valores permitidos | [Atributos](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/atributos) |
| Alterar atributos permitidos | `PUT /items/{item_id}` | Array `attributes` com IDs e valores válidos | Um item | Leitura e escrita | **Parcial.** Não editar `read_only`/inferidos. Em User Products, atributos compartilhados podem se replicar assincronamente a outros itens | [Atributos](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/atributos) e [User Products](https://developers.mercadolivre.com.br/pt_br/user-products) |
| Consultar opções de frete | `GET /users/{seller_id}/shipping_preferences`; `GET /categories/{category_id}/shipping_preferences`; validação em `POST /users/{seller_id}/shipping_modes` | Contexto do item, categoria, preço, dimensões e atributos | Por seller/categoria/item | Leitura; a validação oficial usa POST e requer escrita | **Sim.** Validar antes de oferecer qualquer alteração | [Mercado Envios](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/mercado-envios) |
| Alterar frete | `PUT /items/{item_id}` | Objeto `shipping`, como `free_shipping`, `local_pick_up` e modo compatível | Um item | Leitura e escrita | **Parcial.** Depende de conta, categoria, dimensões, logística e tags como `mandatory_free_shipping`; Full não é configurável livremente | [Mercado Envios](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/mercado-envios) |

### Promoções e Pix

| Finalidade | Método e recurso | Parâmetros/corpo relevantes | Paginação/limites | Escopo | Viabilidade e observações | Documentação oficial |
|---|---|---|---|---|---|---|
| Listar campanhas disponíveis ao seller | `GET /seller-promotions/users/{seller_id}?app_version=v2` | `app_version=v2` | Conforme resposta | Leitura | **Sim.** Um seller pode ter múltiplos convites e tipos | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Promoções associadas a um anúncio | `GET /seller-promotions/items/{item_id}?app_version=v2` | `item_id`, `app_version=v2` | Um item | Leitura | **Sim.** Fonte oficial para `type`, `status`, preço, `original_price`, datas, percentuais e boost | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Detalhes de uma campanha | `GET /seller-promotions/promotions/{promotion_id}?promotion_type={type}&app_version=v2` | `promotion_id`, `promotion_type` | Uma campanha | Leitura | **Sim.** O payload varia por tipo | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Itens de uma campanha | `GET /seller-promotions/promotions/{promotion_id}/items?promotion_type={type}&status={status}&status_item={active|paused}&item_id={id}&limit=50&search_after={cursor}&app_version=v2` | `promotion_type`; filtros opcionais `status`, `status_item`, `item_id` | Padrão/máximo 50; `search_after` TTL 5 min; somente avanço | Leitura | **Sim.** Sem `status_item`, por padrão retorna itens ativos | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Criar desconto individual | `POST /seller-promotions/items/{item_id}?app_version=v2` | `deal_price`, `top_deal_price` opcional, `start_date`, `finish_date`, `promotion_type=PRICE_DISCOUNT` | Um item; prazo máximo 14 dias | Leitura e escrita | **Condicional.** Seller verde, item ativo/novo/não gratuito; desconto de 5% a menos de 80%. Para editar, remover e reaplicar | [Desconto individual](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/desconto-individua) |
| Participar/modificar/sair de campanha | `POST|PUT|DELETE /seller-promotions/items/{item_id}?app_version=v2` | Payload/query específicos do tipo: `promotion_id`, `promotion_type`, `offer_id`, preços quando aceitos | Um item por chamada | Leitura e escrita | **Parcial.** Só habilitar ações documentadas para o tipo e quando o item for candidato/convidado. DOD, LIGHTNING e PRICE_DISCOUNT não têm edição direta genérica | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Remover todas as ofertas de um item | `DELETE /seller-promotions/items/{item_id}?app_version=v2` sem promoção específica | `item_id` | Um item; não se aplica a DOD/LIGHTNING | Leitura e escrita | **Sim, mas destrutivo.** Não confundir com remoção seletiva e exigir confirmação reforçada | [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas) |
| Campanha de desconto Pix | Detalhe: `GET /seller-promotions/promotions/{promotion_id}?promotion_type=BANK&app_version=v2`; itens: `GET .../promotions/{promotion_id}/items?promotion_type=BANK&app_version=v2`; adesão/saída: `POST|DELETE /seller-promotions/items/{item_id}` | `type=BANK`, `sub_type=COFINANCED`, `payment_method=PIX`, `promotion_id`, `offer_id` | Somente MLB e por convite | GET: leitura; adesão/saída: escrita | **Sim como “Campanha Pix”.** Não significa que Pix seja propriedade geral do anúncio | [Campanha cofinanciada para Pix](https://developers.mercadolivre.com.br/pt_br/como-comecar/campanha-co-participacao-para-pix) |
| Métodos de pagamento do site | `GET /sites/MLB/payment_methods` | `site_id=MLB` | Lista | Leitura | **Sim.** O recurso oficial atual retorna `id=pix` e `payment_type_id=bank_transfer` | [Recurso oficial](https://api.mercadolibre.com/sites/MLB/payment_methods) |
| Identificar venda paga por Pix | `GET /orders/{order_id}` e inspeção de `payments[].payment_method_id`/`payment_type` | Não há filtro de anúncios por Pix documentado | Um pedido | Leitura | **Sim para a venda realizada**, não para classificar genericamente o anúncio como “aceita Pix” | [Gerenciar orders](https://developers.mercadolivre.com.br/pt_br/busca-de-produtos-por-vendedor/gerenciamento-de-vendas) |

## Estratégias obrigatórias de paginação

| Recurso | Estratégia |
|---|---|
| Até 1.000 anúncios do seller | `offset` + `limit`, respeitando máximo 100 |
| Mais de 1.000 anúncios | `search_type=scan` e `scroll_id`; cursor expira em 5 minutos |
| Multiget de itens | Dividir IDs em lotes de até 20 |
| Itens de promoção | `limit<=50` + `search_after`; cursor expira em 5 minutos e não volta página |
| Orders | `offset` + `limit`; padrão documentado 50; restringir por data/status |
| Itens com automação de preço | `offset` + `limit<=100` |
| “Ver todos” na interface | Agregação interna progressiva das páginas oficiais, com cancelamento e virtualização; nunca uma requisição ilimitada |

## Contrato para alterações em massa

Não existe endpoint oficial genérico para atualizar vários anúncios em uma única mutação. O recurso multiget é somente leitura. Portanto, toda operação em massa deve:

1. resolver os IDs selecionados por páginas oficiais;
2. buscar estado atual e validar `seller_id` no backend;
3. classificar cada item por modelo (legado, variação, User Product, Multi Origem, Full), promoções e automação de preço;
4. calcular a prévia sem executar chamadas de escrita;
5. pedir confirmação explícita;
6. processar um item/User Product por chamada, em lotes e com concorrência baixa/configurável;
7. impedir duplicidade com chave de idempotência interna da operação;
8. registrar sucesso, warning e erro por item, sem tokens;
9. em `429`, interromper o aumento de carga, respeitar `Retry-After` quando presente e aplicar backoff exponencial com jitter;
10. nunca tentar contornar cota por IP, múltiplas sessões, tokens ou aplicações artificiais.

Referências: [Rate limit / erro 429](https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/rate-limit-erro-429) e [Boas práticas](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos/boas-praticas-para-usar-a-plataforma).

## Decisão para preço

Antes de qualquer alteração de preço:

1. verificar se o item aparece em `/pricing-automation/users/{seller_id}/items` ou tem tag `dynamic_standard_price`;
2. consultar promoções ativas/programadas do item;
3. bloquear preço manual se a automação estiver ativa: desde 18/03/2026, um payload apenas com `price` recebe `400`; com outros campos, o preço é ignorado e há warning;
4. para item sem automação, calcular o novo preço e enviar `PUT /items/{item_id}` com o valor absoluto;
5. verificar o valor devolvido pela API em vez de assumir que o `200` alterou o preço;
6. não usar um endpoint futuro da API Prices: a edição de preço standard por esse recurso ainda aparece como indisponível na documentação atual.

## Decisão para Pix

Existem três conceitos diferentes:

- **Método disponível no site/checkout:** `/sites/MLB/payment_methods` informa Pix, mas isso não cria uma propriedade `pix=true` por anúncio.
- **Pagamento efetivamente usado:** conhecido depois da compra em `orders[].payments[]`.
- **Campanha Pix:** associação oficial entre anúncio e Pix, somente quando a promoção tem `type=BANK`, `sub_type=COFINANCED` e `payment_method=PIX`, disponível no MLB por convite.

Consequentemente, a interface pode oferecer os filtros **“Em campanha Pix”**, **“Candidato a campanha Pix”** e **“Vendas pagas por Pix”**. Não deve oferecer o filtro genérico **“Anúncio aceita Pix”**.

## Rate limit e erros

- A documentação não publica um número global fixo de requisições. O controle principal varia por Client ID/aplicação e endpoint.
- Implementar cache, deduplicação, fila, concorrência controlada e backoff exponencial com jitter.
- Tratar `429` como sinal para reduzir consumo; respeitar `Retry-After` quando fornecido.
- Não repetir automaticamente erros permanentes `400`, `401`, `403`, `404` ou validações de negócio.
- `409` de versão/optimistic locking exige nova leitura do recurso antes de decidir retry.
- `423_ENTITY_LOCKED` em promoções pode ser tentado depois de pequena espera, com limite de tentativas.
- `206 Partial Content` é resposta utilizável, mas deve registrar os campos indicados no header `X-Content-Missing`.

Referência: [Rate limit / erro 429](https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/rate-limit-erro-429).

