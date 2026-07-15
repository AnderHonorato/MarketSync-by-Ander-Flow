# Limitações oficiais e decisões do produto

Validado em **11/07/2026**. Este documento registra o que o sistema não deve prometer, o que só pode ser implementado de modo condicional e quais alternativas são permitidas pela API oficial.

## Resumo de viabilidade

| Requisito                                              | Situação                          | Decisão do sistema                                                                                           |
| ------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Listar, buscar, filtrar e paginar anúncios próprios    | Suportado                         | Usar busca do seller, multiget de até 20 e scan acima de 1.000                                               |
| Catálogo, elegibilidade e competição                   | Suportado quando aplicável        | Usar `catalog_listing`, elegibilidade e `price_to_win`; não inventar concorrência para item sem catálogo     |
| Promoção atual, futura, encerrada, tipo, preço e datas | Suportado                         | Usar `/seller-promotions`; nunca inferir promoção apenas pela diferença de preços                            |
| Qualidade                                              | Suportado                         | Usar `/item/{id}/performance`; não usar o `/health` genérico descontinuado                                   |
| Visitas                                                | Suportado com custo alto          | Uma publicação por chamada, cache e carregamento sob demanda                                                 |
| Vendas dos últimos 7, 15, 30, 60 e 90 dias             | Suportado                         | Consultar orders por período e agregar `order_items[].quantity` por `item.id`                                |
| Histórico de vendas por item superior a 12 meses       | Não disponível integralmente      | Mostrar “indisponível pela API”; manter snapshots/notificações apenas prospectivamente                       |
| Alterações em massa                                    | Orquestração interna              | Executar endpoints individuais em fila; não existe bulk write genérico                                       |
| Alterar preço                                          | Condicional                       | Bloquear item com automação ativa; validar promoção e resposta efetiva                                       |
| Alterar estoque                                        | Condicional ao modelo logístico   | `available_quantity` no modelo comum; estoque de User Product/localização em Multi Origem; Full não editável |
| Alterar SKU e atributos                                | Parcial                           | Somente atributos permitidos pela categoria/modelo; respeitar replicação do User Product                     |
| Alterar frete                                          | Parcial                           | Oferecer apenas opções validadas para conta, categoria, dimensões e logística                                |
| Pix por anúncio                                        | Não existe como propriedade geral | Expor somente campanha Pix e pagamento Pix efetivo                                                           |
| Relevância oficial                                     | Não existe como campo único       | Se usada, chamar “Pontuação interna”, documentar fórmula e permitir desativar                                |

## Limites objetivos da API

| Recurso                       | Limite/restrição oficial                                                     | Impacto                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/users/{id}/items/search`    | `limit` padrão 50 e máximo 100                                               | Opções de 200 e “Ver todos” são paginação interna, nunca `limit=200`               |
| Busca de mais de 1.000 itens  | Exige `search_type=scan`; `scroll_id` expira em 5 minutos                    | Não misturar com offset; consumir continuamente e permitir reinício seguro         |
| `/items?ids=...`              | Máximo 20 IDs                                                                | Hidratação em lotes de 20                                                          |
| Itens de promoção             | Máximo 50; cursor `search_after` com TTL 5 minutos e sem paginação para trás | Guardar somente durante a coleta ativa; UI mantém seus próprios índices de página  |
| Visitas por intervalo         | Um anúncio por consulta; janela máxima de 150 dias                           | Carregamento preguiçoso, cache e fila; nada de N chamadas simultâneas sem controle |
| Visitas totais                | Histórico documentado dos últimos dois anos                                  | Não prometer visitas desde a criação para itens mais antigos                       |
| Orders                        | Pedidos armazenados por até 12 meses; paginação padrão 50                    | Não reconstruir datas de vendas antigas além desse período                         |
| Automação de preço por seller | `limit` máximo 100                                                           | Paginar antes de habilitar preview de preço em massa                               |
| Rate limit                    | Não existe RPM global público e fixo; varia por Client ID e endpoint         | Não codificar um número como “limite do Mercado Livre”; adaptar a `429`            |

## Pix: o que pode e o que não pode

### Permitido

- Consultar os métodos do site em `GET /sites/MLB/payment_methods`; o recurso oficial lista `pix` como `bank_transfer`.
- Identificar o meio efetivamente usado em uma venda por `orders[].payments[].payment_method_id`.
- Identificar campanha Pix quando a promoção tiver simultaneamente:
  - `type: BANK`;
  - `sub_type: COFINANCED`;
  - `payment_method: PIX`.
- Listar itens candidatos, pendentes ou ativos dessa campanha e, quando convidados, aderir/sair pelos recursos oficiais de `seller-promotions`.

### Proibido ou incorreto

- Tratar Pix como configuração individual permanente de todo anúncio.
- Criar filtro “aceita Pix” a partir de `accepts_mercadopago`, `immediate_payment` ou do site suportar Pix.
- Concluir que um item teve venda Pix apenas por participar de campanha Pix.
- Prometer campanha Pix fora do MLB ou para seller/item sem convite.

O texto correto da interface é **“Campanha Pix”** ou **“Venda paga por Pix”**, conforme o dado consultado.

Referência: [Campanha cofinanciada para Pix](https://developers.mercadolivre.com.br/pt_br/como-comecar/campanha-co-participacao-para-pix).

## Vendas e anúncios “sem venda”

- `sold_quantity=0`, obtido com token proprietário, comprova que o item atual não possui vendas acumuladas.
- Para períodos de 7 a 90 dias, usar `/orders/search` com `seller`, status e intervalo de datas; agregar as quantidades por `order_items[].item.id`.
- Definir e documentar a regra: por padrão, contar pedido pago e descontar/corrigir cancelamentos, devoluções e reembolsos conforme o estado final sincronizado.
- A busca de seller continua incluindo pedidos cancelados; portanto, ausência de filtro e simples contagem de orders gera métrica errada.
- Pedidos anteriores a 12 meses não ficam disponíveis na busca. Para item antigo com `sold_quantity>0`, a API informa que vendeu, mas não permite localizar todas as datas antigas.
- Em migração para User Products, vendas antigas podem permanecer associadas ao `item_id` anterior, mesmo com `sold_quantity` refletido no novo modelo.
- O sistema pode armazenar snapshots e consumir notificações daqui para frente, mas não pode fabricar histórico retroativo.

Referências: [Gerenciar orders](https://developers.mercadolivre.com.br/pt_br/busca-de-produtos-por-vendedor/gerenciamento-de-vendas) e [User Products](https://developers.mercadolivre.com.br/pt_br/user-products).

## Tempo ativo

- `date_created`, `last_updated`, `start_time`, `stop_time`/`end_time`, status e substatus são consultáveis.
- A API de item não fornece um histórico completo de todos os intervalos pausado/ativo.
- É permitido calcular **“dias desde a criação”** até hoje ou encerramento.
- Não chamar esse valor de **“dias líquidos ativo”** se períodos pausados não estiverem registrados localmente.
- Para precisão futura, registrar transições recebidas por notificações e snapshots, sem polling agressivo.

## Relevância, posição e conversão

Não existe um campo oficial universal chamado “relevância do anúncio”. Os seguintes sinais são independentes:

- `/performance`: qualidade cadastral, score 0–100 e ações;
- `reputation_health_gauge`: perda de exposição associada a reclamações/cancelamentos;
- `/price_to_win`: competição específica do catálogo;
- visitas: tráfego observado;
- orders/sold quantity: vendas;
- catálogo/elegibilidade e promoções: condições comerciais.

Não há endpoint geral documentado que informe a posição orgânica exata do anúncio ou uma taxa de conversão pronta. Se o produto calcular algo, deve:

1. chamar o resultado de **Pontuação interna** ou **Conversão interna**;
2. exibir a fórmula e a janela temporal;

### Fórmula atual da Pontuação interna

A pontuação opcional vai de 0 a 100 e não representa ranking do Mercado Livre: vendas acumuladas contribuem com até 35 pontos (`log10(vendidos + 1) × 15`), estoque positivo com 15, status ativo com 20, associação ao catálogo com 10 e o campo oficial de qualidade, quando disponível, com até 20. O usuário pode desativar a pontuação; nesse caso ela não é retornada nem usada para ordenação. 3. tratar divisão por zero e dados incompletos; 4. permitir desativar a pontuação; 5. nunca apresentar a métrica derivada como indicador oficial do Mercado Livre.

## Preço e preço anterior

- Para item sem automação dinâmica, o preço padrão pode ser alterado com `PUT /items/{item_id}`.
- Para item com automação ativa, desde 18/03/2026:
  - payload apenas com `price` recebe `400`;
  - payload com `price` e outros campos recebe `200`, mas o preço é ignorado e há warning.
- Antes de qualquer lote, consultar `/pricing-automation/users/{seller_id}/items` ou a tag `dynamic_standard_price`.
- Não desligar automação automaticamente. Gestão de automação é ação distinta, explícita e destrutiva para a estratégia do seller.
- Promoções podem ser removidas ou alteradas por mudança de preço; consultar `seller-promotions` antes da prévia.
- `original_price` representa contexto comercial/promocional atual, não um histórico geral confiável.
- O endpoint de histórico de pricing automation registra eventos da automação, não todas as mudanças manuais.
- Se o projeto precisar de “preço anterior” geral, deve registrar snapshots próprios prospectivamente e rotular a origem.
- A documentação da nova edição de preço standard pela API Prices ainda indica indisponibilidade; não inventar `POST`/`PUT` para esse recurso futuro.

Referências: [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/automatizacoes-de-precos), [Sincronização](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes) e [API de preços](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/api-de-precos).

## Estoque

- Seller comum: atualizar `available_quantity` no item/variação.
- Seller com `warehouse_management`: não usar cegamente `available_quantity`; consultar estoque do `user_product_id` e atualizar `seller_warehouse` com `x-version`.
- Seller com `multiwarehouse`: pode ter mais de um depósito; validar `store_id` e `network_node_id` pertencentes ao seller.
- Estoque `meli_facility`/Full é gerido pelo Mercado Livre e não pode ser alterado pelo seller.
- `x-version` obsoleto retorna `409`; fazer novo GET e recalcular, em vez de repetir o mesmo PUT.
- Alterar estoque do User Product pode afetar mais de um anúncio associado.

Referência: [Estoque Multi Origem](https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem).

## SKU, atributos, variações e User Products

- O SKU oficial deve usar o atributo `SELLER_SKU`; `seller_custom_field` é um campo distinto e legado.
- Atributos variam por categoria. Validar `/categories/{id}/attributes` e `/technical_specs/input`.
- Não editar atributos `read_only` ou inferidos; respeitar obrigatórios, unidades, tipos e listas de valores.
- Em User Products, atributos e imagens compartilhados podem se replicar assincronamente para todos os itens da família.
- No novo modelo não é permitido criar variações por `POST`/`PUT` em `/items` como no fluxo legado.
- A prévia em massa deve avisar quando a alteração alcança o User Product e outros anúncios, não somente o item selecionado.

Referências: [Atributos](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/atributos), [Variações](https://developers.mercadolivre.com.br/pt_br/tendencias/variacoes) e [User Products](https://developers.mercadolivre.com.br/pt_br/user-products).

## Frete

- A disponibilidade depende das preferências do seller, categoria, dimensões, preço, tipo de publicação e logística.
- Validar `shipping_preferences`, preferências da categoria e `shipping_modes` antes de mostrar a ação.
- `mandatory_free_shipping` não pode ser desligado como se fosse opção comum.
- Full e outras logísticas geridas pelo Mercado Livre não podem ser convertidas arbitrariamente.
- Frete personalizado e frete grátis personalizado só se aplicam aos cenários/categorias documentados.
- Uma ação genérica “alterar frete de todos” sem pré-validação deve permanecer desabilitada.

Referência: [Mercado Envios](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/mercado-envios).

## Promoções

- O tipo e status devem vir de `/seller-promotions`; comparar `price` e `original_price` sozinho não comprova promoção.
- Participação depende de tipo, convite/candidatura, reputação, estado do item e demais regras da campanha.
- `PRICE_DISCOUNT`, DOD e LIGHTNING não possuem edição direta genérica; a orientação é remover e reaplicar quando permitido.
- O `DELETE /seller-promotions/items/{item_id}` sem identificação da promoção remove todas as ofertas elegíveis do item e não inclui DOD/LIGHTNING. Tratar como operação destrutiva separada.
- Campanhas podem devolver desconto adicional aplicado pelo Mercado Livre (`boosted_offer` e campos relacionados); não recalcular ignorando esses campos.
- A paginação de itens da campanha usa `search_after`, máximo 50, TTL 5 minutos e não permite voltar.

Referência: [Gerenciar promoções](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas).

## Alterações em massa

Não há bulk write genérico de itens. O projeto deve implementar fila/orquestração, e não simular um endpoint inexistente.

Guardrails obrigatórios:

1. seleção explícita e distinção entre página atual e todos os resultados;
2. resolução progressiva dos IDs oficiais;
3. nova validação de propriedade, estado e versão no backend;
4. prévia atual → novo valor e impactos indiretos;
5. confirmação reforçada para `closed`, remoção de promoção, automação ou frete;
6. baixa concorrência e lotes configuráveis;
7. deduplicação/idempotência interna;
8. cancelamento apenas antes do envio de cada chamada; requisição já aceita não pode ser “desfeita” genericamente;
9. relatório por item, com warning e causa oficial;
10. nenhuma tentativa de elevar throughput com múltiplos tokens, sessões, IPs ou Client IDs artificiais.

## Rate limit

- O Mercado Livre não publica uma única cota fixa para toda a API.
- O controle principal varia por Client ID/aplicação e endpoint; o tamanho do payload não aumenta a cota.
- Em `429`, reduzir concorrência, aplicar backoff exponencial com jitter e respeitar `Retry-After` quando presente.
- Não fazer retries massivos; limitar tentativas e manter o trabalho na fila.
- Cachear recursos relativamente estáveis, como schema de categoria e preferências.
- Deduplicar leituras simultâneas e usar notificações como sinal para consultar a API, em vez de polling frequente.
- Não misturar `scroll_id` com `offset/limit` e não deixar scroll aberto até expirar.

Referência: [Rate limit / erro 429](https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/rate-limit-erro-429).

## Ações que não devem existir na interface

- “Anúncio aceita Pix” sem campanha Pix oficial.
- “Relevância oficial” calculada pelo aplicativo.
- “Posição exata no resultado” sem endpoint oficial.
- “Carregar todos” por uma requisição ilimitada.
- “Alterar preço” em item com automação ativa sem ação explícita sobre a automação.
- “Alterar estoque Full”.
- “Reativar anúncio encerrado”.
- “Editar qualquer atributo” sem schema/validação.
- “Alterar frete de todos” sem elegibilidade individual.
- “Atualização em massa instantânea” ou concorrência irrestrita.

## Filtro de campanha Pix

O filtro **Com campanha Pix** usa apenas campanhas oficiais do tipo `BANK`, subtipo `COFINANCED`, com `payment_method=PIX`. A sincronização consulta as campanhas do seller, confirma os detalhes da campanha e associa os itens retornados por `/seller-promotions/promotions/{promotion_id}/items`. Itens apenas candidatos não são marcados como participantes. Pagamentos Pix escolhidos pelo comprador no checkout continuam sendo dados da venda, não uma característica individual configurável do anúncio.

Enquanto um anúncio participa de uma campanha Pix, alterações diretas de preço são bloqueadas na prévia. Status, estoque e outros campos continuam sujeitos às regras normais do anúncio e da API.

## Leitura pública opcional por URL

Quando ativada explicitamente, esta fonte não oficial visita uma página pública `/pagina/` ou `/loja/` e, de forma conservadora, os anúncios nela encontrados.

- aceita apenas HTTPS nos hosts públicos do Mercado Livre Brasil;
- limita cada leitura a 30 anúncios, em sequência e com intervalo entre páginas;
- não usa cookies de conta, automação de login, rotação de IP ou técnicas para contornar bloqueios;
- considera “Pix observado” somente quando encontra texto visível e contextual sobre pagamento, preço ou desconto com Pix;
- não conclui que o checkout aceitará Pix e nunca mistura essa observação com campanha Pix obtida pela API;
- pode deixar de funcionar quando o HTML público mudar ou quando o Mercado Livre bloquear a leitura.

A página oficial é tentada em um `iframe` no modal. Se o Mercado Livre impedir a incorporação por suas políticas de segurança, o anúncio permanece disponível pelo botão para abrir em nova guia.

- “Histórico completo” de vendas, visitas, pausas ou preços quando a API não o fornece.

## Regra de evolução

Antes de habilitar nova funcionalidade de leitura ou escrita:

1. localizar a documentação oficial atual;
2. registrar método, recurso, parâmetros, escopo, disponibilidade por site e limites em `OFFICIAL_API.md`;
3. testar com usuário/item de teste elegível;
4. implementar feature flag para escrita nova;
5. validar a resposta lida após a mutação;
6. registrar aqui qualquer limitação observada;
7. para recursos oficiais, não substituir a API por scraping, cookies, endpoints internos ou engenharia reversa; a leitura pública opcional deve permanecer isolada, ativável e identificada como não oficial.
