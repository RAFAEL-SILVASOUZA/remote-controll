# Auditoria mobile no navegador

Sistema: https://remote.rafael-silva-souza.dev/
Data: 2026-09-16
Conversa de teste: `/conversations/conv-1789569756965-66w0xig51` (Auditoria visual mobile).

## Método

Chrome real com DevTools aberto, emulação de viewport e toque via CDP. Login com a conta autorizada, navegação por login, cadastro, conversas, tokens e chat. Não foi criada conta nem gerado/revogado token. Nenhum arquivo da aplicação foi alterado.

Viewports: 390 × 844, 320 × 844 e 320 × 568. A emulação não reproduz integralmente teclado virtual, Safari ou áreas seguras de um aparelho físico.

Foi criada uma conversa de teste e solicitado trabalho somente de leitura. Foram observados lista de tarefas, ferramentas de leitura/busca e dois subagentes com grupos de atividades separados. O agente encerrou o primeiro turno antes das perguntas; foi necessário solicitar a continuação. Foram respondidas perguntas reais de escolha única e múltipla, incluindo texto livre.

## Achados confirmados

| Prioridade | Evidência | Recomendação |
| --- | --- | --- |
| Crítica | Em 320 × 568, duas perguntas de askUser deixam o histórico com 27 px de altura; Responder começa em y=655, Seguir sem mim em y=703 e o compositor em y=757, fora da viewport. | Limitar a altura do painel de perguntas e permitir rolagem interna, mantendo as ações acessíveis. |
| Alta | Em 390 × 844, o rodapé com essas perguntas ocupa 655 px e deixa apenas 134 px para o histórico. | Redesenhar a apresentação das perguntas para preservar contexto e navegação. |
| Alta | Botões de cabeçalho têm 30 × 30 px; enviar/parar tem 34 × 34 px. Copiar mensagem tem 26 × 26 px e fica oculto até hover/foco. | Alvos de toque de pelo menos 44 px e ações descobríveis sem hover. |
| Alta | Tabela real de seis colunas fica em aproximadamente 299 px, quebrando cabeçalhos e valores em fragmentos de poucas letras. | Rolagem horizontal local para tabelas com largura mínima legível. |
| Média | Campo de nome do token usa aparência nativa, com altura e alinhamento diferentes do botão; em 320 px o botão quebra para a linha seguinte sem espaçamento. | Formulário com label, campos padronizados e empilhamento planejado. |
| Média | Seletor de janela aparece na lista mesmo com atributo hidden. O CSS `.window-picker { display: block }` prevalece sobre a ocultação padrão. | Garantir que elementos hidden permaneçam ocultos. |
| Média | Em 320 px, badges de status comprimem títulos de conversas. | Reorganizar título e metadados em linhas adequadas ao espaço disponível. |
| Média | Texto do campo de mensagem medido em 14,72 px; campos de autenticação também são menores que 16 px no CSS. | Padronizar campos em 16 px; verificar zoom e teclado em dispositivo real. |
| A investigar | Durante atualizações ao vivo, uma mensagem de andamento apareceu repetida e o início de uma resposta mostrou texto de Processing misturado ao conteúdo. | Investigar a reconciliação entre histórico e mensagem em streaming separadamente do CSS. |
| Funcional | Bloco Markdown mermaid aparece como código, sem SVG. A ferramenta real mermaidViewer também foi acionada, mas o remote mostrou apenas a atividade textual “Mermaid diagram rendered”, sem diagrama. | Implementar/verificar o transporte e a apresentação do resultado da ferramenta, além de decidir sobre suporte ao bloco Markdown. |

O código local também confirma que `renderPendingQuestion` limpa e reconstrói o painel em cada atualização da conversa. Há risco de perda de rascunho/foco; não foi reproduzido com uma atualização simultânea à digitação nesta sessão.

Ao enviar o último pedido de teste, a resposta extensa com tabelas deixou de aparecer no DOM da conversa, embora tivesse sido visível e capturada antes. Isso reforça a necessidade de investigar histórico/streaming; a origem no agente, transporte ou renderização ainda não foi isolada.

## O que funcionou

- Login e navegação nas cinco telas.
- Criação da conversa e envio de mensagens pelo navegador.
- Exibição da lista de tarefas e dos dois grupos de subagentes.
- Resposta de askUser com escolhas e texto livre aceita pelo agente.
- Bloco de código longo com rolagem horizontal própria (297 px visíveis, 2075 px de conteúdo).
- Nas amostras de lista e tokens, a largura do documento permaneceu igual à viewport.

## Evidências locais

Capturas em `.superpowers/`: `login-mobile.png`, `signup-mobile.png`, `sessions-mobile.png`, `sessions-320.png`, `tokens-mobile.png`, `tokens-320.png`, `subagents-mobile.png`, `askuser-390.png`, `askuser-320-short.png`, `table-mobile.png` e `diagram-tool-mobile.png`.

## Direção proposta para o redesign

Manter a identidade escura/violeta. Reorganizar perguntas e compositor como prioridade; ampliar controles; padronizar formulários; separar título/status em cards; reservar rolagem horizontal a tabelas e código; tornar ferramentas e subagentes mais legíveis e compactos. Validar novamente os mesmos fluxos em 320, 390, 768 e 1280 px, além de viewport com pouca altura. A implementação ainda não foi iniciada.
