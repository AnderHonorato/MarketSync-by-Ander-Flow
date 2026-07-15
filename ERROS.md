# Catálogo de erros

Este arquivo traduz os códigos exibidos na interface. Ao relatar um problema, informe o código e o que estava fazendo.

| Código | Significado | Ação recomendada |
| --- | --- | --- |
| `MLAM-LOC-001` | O serviço local na porta 3100 não respondeu. | Reinicie o aplicativo pelo comando principal. |
| `MLAM-AUT-001` | A função exige uma conta de anúncios conectada. | Conecte a conta no cabeçalho. |
| `MLAM-AUT-002` | A conexão do aplicativo ainda não está pronta. | Revise a configuração do aplicativo fora da tela do cliente. |
| `MLAM-AUT-003` | A sessão de conexão expirou ou foi perdida. | Inicie a conexão novamente. |
| `MLAM-AUT-004` | A confirmação de acesso expirou ou não corresponde à sessão. | Inicie a conexão novamente. |
| `MLAM-AUT-005` | A identidade devolvida não corresponde à autorização. | Desconecte e repita com a conta correta. |
| `MLAM-AUT-006` | A sessão da conta expirou. | Reconecte a conta. |
| `MLAM-AUT-007` | A operação não foi autorizada. | Confirme a conta e as permissões. |
| `MLAM-SEG-001` | O token de segurança da sessão expirou. | Atualize a página. |
| `MLAM-PUB-001` | O Mercado Livre solicitou verificação de acesso. | Aguarde alguns minutos; não repita continuamente. |
| `MLAM-PUB-002` | A busca pública foi limitada temporariamente. | Respeite o intervalo e tente mais tarde. |
| `MLAM-PUB-003` | A página pública recusou ou não entregou conteúdo. | Verifique o link e tente depois. |
| `MLAM-PUB-004` | O leitor local de páginas não iniciou. | Reinicie o aplicativo e verifique o Chrome instalado. |
| `MLAM-PUB-005` | Nenhum anúncio foi identificado na página. | Confira a URL ou o nome pesquisado. |
| `MLAM-PUB-006` | Já existe uma consulta em andamento. | Aguarde ou cancele a consulta atual. |
| `MLAM-PUB-007` | A página não informou como chegar ao próximo grupo de anúncios. | A consulta preserva os resultados encontrados; tente outra URL da loja. |
| `MLAM-PUB-008` | Um anúncio individual não pôde ser detalhado. | Consulte o painel de erros; os demais anúncios continuam. |
| `MLAM-PUB-009` | A consulta estava em andamento quando o serviço local reiniciou. | Inicie uma nova consulta; os resultados anteriores continuam salvos no navegador. |
| `MLAM-PUB-010` | Uma forma de leitura foi limitada e a consulta mudou automaticamente para a alternativa segura. | Nenhuma ação é necessária; detalhes visuais podem ficar incompletos. |
| `MLAM-LIM-001` | Limite de solicitações atingido. | Aguarde antes de repetir. |
| `MLAM-DAD-001` | O registro solicitado não existe mais. | Atualize os dados. |
| `MLAM-OPR-001` | A operação foi cancelada. | Nenhuma ação é necessária. |
| `MLAM-SRV-001` | Erro interno identificado pelo serviço. | Reinicie e, se persistir, informe o código. |
| `MLAM-SRV-002` | Serviço temporariamente indisponível. | Tente novamente mais tarde. |
| `MLAM-IA-001` | A assistente Metrys não encontrou uma configuração ativa. | Revise a configuração da IA no servidor. |
| `MLAM-IA-002` | A assistente não respondeu. | Tente novamente mais tarde. |
| `MLAM-IA-003` | Limite temporário da assistente. | Aguarde antes de reenviar. |
| `MLAM-IA-004` | A configuração da assistente foi recusada. | Revise a chave e a disponibilidade do serviço. |
| `MLAM-IA-005` | A conversa não existe nesta sessão. | Atualize a lista de conversas. |
| `MLAM-IA-006` | A conversa está arquivada. | Reabra a conversa para continuar. |
| `MLAM-APP-001` | Erro não catalogado com mensagem técnica disponível. | Informe o código e a ação realizada. |
| `MLAM-APP-002` | Erro inesperado sem detalhes. | Informe o código e a ação realizada. |

## Mensagens que não pertencem ao sistema

- `shouldScanElementsForQRCodes`, quando acompanhado de um endereço `chrome-extension://`, é gerado por uma extensão instalada no Chrome. Desative ou atualize a extensão indicada pelo identificador mostrado no console.
- `Download the React DevTools` é apenas uma sugestão do ambiente de desenvolvimento, não um erro.
- `frame-ancestors 'none'` é uma proteção do site externo contra incorporação. O sistema não usa mais iframe para páginas oficiais e oferece abertura segura em nova guia.
