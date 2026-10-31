# Changelog

Formato simplificado do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões mais recentes primeiro.

## Não lançado

## 0.8.0 — 2026-10-31

### Adicionado
- Auditor de release (`/nabuco:release` no Claude Code, `$release` no Codex): confere tarefas, versões, comandos e changelog desde a última release.
- Vigia de segurança (`/nabuco:vigia` no Claude Code, `$vigia` no Codex): modo `ambiente` (permissões amplas, hooks, MCPs, plugins, `.env` versionado e segredos no histórico do git, sempre mascarados) e modo `deps` (`npm audit` e OSV, com "não verificado" quando não dá para checar); correções propostas uma por vez e só aplicadas com aprovação. O Gerente roda `deps --novos` ao abrir cada tarefa e sugere uma tarefa `sensivel` se surgir vulnerabilidade alta nova.
- Contratar funcionário (`/nabuco:contratar` no Claude Code, `$contratar` no Codex): entrevista curta, prévia completa e ok antes de gravar; o novo escritor ou checador fica em `~/.nabuco/time/`, é instalado como `nabuco-<papel>` no Claude Code e no Codex e é reconhecido pelo Gerente, cérebro, eventos, métricas, painel, status e setup. CLI `scripts/contratar.mjs` com `validar`, `novo`, `listar`, `instalar` e `remover` (lições e casos ficam); checador só com ferramentas de leitura e nunca sobrescreve agente alheio.
- Relatório do time (`/nabuco:relatorio` no Claude Code, `$relatorio` no Codex): Markdown do que o time fez num período (`--dias`, `--desde`/`--ate`, `--desde-release`), no projeto atual ou em todos, com resumo, tarefas, checadores, escapes, cérebro, funcionários e qualidade dos dados; `--json` e `--gravar` (`.nabuco/relatorios/`). Só lê e nunca envia.
- Consumo de tokens: o hook `SubagentStop` soma o `usage` do transcript de cada funcionário do nabuco no Claude Code (entrada, saída, cache leitura/escrita) em `agente_fim`; Codex e eventos antigos ficam como "não medido".

### Corrigido
- Sincronização × contratados: quando o cérebro traz mudanças em `time/` de outra máquina, os contratados registrados são instalados/atualizados e os agentes `nabuco-<papel>` gerados pelo contratar cujo papel saiu do registro são removidos (agente sem a marca nunca é tocado; falha só vai para o `sync.log`). `contratar listar` marca quem não está instalado no Claude Code e o Gerente não delega a ele.
- Relatórios nunca sobem para o remoto do cérebro: `relatorios/` entra no `.gitignore` no setup e, em cérebros já sincronizados, a sincronização o acrescenta e tira do índice.
- Fim de linha no Windows: com `core.autocrlf=true` (padrão do Git for Windows) a máquina nova trazia o cérebro com CRLF. O `.gitattributes` do cérebro passa a ser `* -text` + `historico.jsonl merge=union` (setup e sincronização) e arquivos já em CRLF voltam a LF.

## 0.7.1 — 2026-10-19

### Corrigido
- Tester e arquiteto (checadores que quase nunca têm achado alto ou médio) passam a ser avaliados por escapes a partir de 3 tarefas; antes ficavam "sem avaliação" mesmo com 3 tarefas.
- Painel mostra quem participou da tarefa ainda aberta, em vez de parecer que nunca trabalhou. Rótulos: "em avaliação (tarefa aberta)", "em avaliação (n/3)" e "n tarefas · sem indicador".

## 0.7.0 — 2026-10-19

### Adicionado
- Sincronização do cérebro (`~/.nabuco`) com um repositório git privado entre máquinas: `setup.mjs --cerebro-remoto <url>` liga o remoto (máquina nova traz o cérebro, a primeira envia); `historico.jsonl` junta as máquinas com `merge=union`; limite do plano, `bin/` e config ficam locais.
- Sincroniza em segundo plano no `SessionStart` e depois de cada caso ou lição; `scripts/sincronizar.mjs` força na hora, com trava contra duas sessões ao mesmo tempo.

## 0.6.1 — 2026-10-19

### Corrigido
- Limite do plano com várias sessões: a sessão parada repassava o último `rate_limits` recebido e alternava com a ativa (51 ↔ 63%), e o consumo da tarefa somava cada volta. Agora o uso é monotônico dentro da janela: a status line não grava valor menor e o cálculo usa o pico.

## 0.6.0 — 2026-10-19

### Adicionado
- Aprendizado: `similares` devolve `motivos` e propõe lição já no primeiro caso quando há achado alto ou médio de checador ou sinal precoce; o caso guarda a severidade do achado.
- `caso-add` marca recorrência sozinho quando o caso se parece com a evidência de uma lição entregue nesta tarefa.
- `buscar` completa com até 2 casos parecidos ("Casos parecidos (ainda sem lição)") e registra `licoes_entregues`.
- Métricas dos checadores: `achados_uteis` (achado que virou correção) e escapes depois da revisão.
- Hook `PostToolUse` (`dono.mjs`) grava a sessão que rodou a CLI de tarefa como dona da tarefa.

### Alterado
- Nível só a partir de 3 tarefas: painel, dossiê e CLI mostram "em avaliação (n/3)" antes disso; só participar não dá nível.
- O gate de evidência segura só a sessão do Gerente da tarefa; outra sessão aberta no mesmo projeto não é bloqueada.

## 0.5.0 — 2026-10-19

### Adicionado
- Linha do tempo ao vivo da tarefa no painel (coluna lateral; no celular, embaixo): fases, delegações, início e fim de agentes com modelo e duração, notas do `T log`, critérios, achados e gate.
- `T delegar --papel <papel> --passo=<passo>` registra o passo entregue a cada funcionário (evento `delegacao`, com o destino em `dados.para` para não contar como participação nas métricas).

### Alterado
- `T log` também emite o evento `nota`.

## 0.4.1 — 2026-10-19

### Corrigido
- O hook ignora `SubagentStop` de agentes internos do Claude Code: fim sem `agent_type` só é gravado se houver o início com o mesmo `agent_id` (e herda o papel dele).

### Alterado
- O Gerente anuncia cada delegação (`→ Papel: passo`) e cada entrega (`← Papel: entrega`), inclusive dos checadores.

## 0.4.0 — 2026-10-19

### Adicionado
- Painel mostra o limite do plano (janela de 5 h e semanal) e o consumo aproximado da tarefa ativa.
- Status line do nabuco grava `rate_limits` em `~/.nabuco/limite.jsonl`; o setup oferece instalar (`--status-line`) preservando a status line anterior.

## 0.3.3 — 2026-10-19

### Corrigido
- Painel mostra o avatar colorido de quem está trabalhando, mesmo sem avaliação; o gerente nunca fica cinza.

## 0.3.2 — 2026-10-19

### Adicionado
- Critério `criterio-editar`: depois do plano aprovado, exige `--ok-usuario` e `--motivo`; uma verificação nova zera a evidência.
- Documentação da validação no Codex (Fases 1 a 3) e ajustes de instalação no Windows.

### Corrigido
- O time não contorna mais bloqueio de ambiente (sandbox, permissão) mudando a config do projeto ou `NABUCO_HOME`.
- Harness do Codex detectado por `CODEX_THREAD_ID`/`turn_id`, inclusive no gate e com `CLAUDECODE` herdado.
- Falha no histórico global não derruba mais o comando cujo evento já foi gravado na tarefa (evitava evento duplicado no retry).
- Sinais sem tarefa ativa desempatam tarefas do mesmo dia pela data de criação, não pelo slug.

## 0.3.1 — 2026-10-17

### Corrigido
- Dossiê e métricas: tendência nula quando o atributo não tem "antes" real; dossiê informa a versão usada e pede as fontes com ela; votos das lições levam aos eventos `licao_usada` (nova rota `/api/fontes/<papel>/licao/<id>`).
- Gate sem critérios mostra "nenhum critério definido" em vez de "todos passaram".
- Painel: mantém a última leitura boa da tarefa e tenta de novo se o estado falhar; avisa no cabeçalho quando `criterios.json` fica ilegível; lembra o avatar que falhou e avisa falha ao carregar o modelo; congela os monitores quando o servidor é encerrado e volta ao receber um estado novo; aceita Host sem porta na porta 80 (`127.0.0.1` e `localhost`); chuva em movimento não pisca quando só a velocidade muda; sublinhado tracejado do número clicável colado ao número.
- Painel: monitor só fica trabalhando com eventos deste projeto (o nível segue global); atividade do gerente conta eventos com papel nulo ou `gerente`; assinatura do SSE reflete os arquivos lidos no envio; a skill do painel mostra o stderr se o servidor sair logo.
- Segurança do painel: CSP com `frame-ancestors`, `base-uri` e `form-action 'none'`; chave no `index.html` substituída pela forma de função do `replaceAll`.
- Eventos: `agente_inicio` e `agente_fim` sem `agent_id` não casam via `undefined`; só um fim posterior fecha.
- Lições: tags curtas (`ui`, `db`, `ci`) não somem na comparação de similares; higiene propõe revisão de lição sem data de último uso.

### Alterado
- Painel cacheia o histórico parseado e lê só o trecho acrescentado.

## 0.3.0 — 2026-10-17

### Adicionado
- Painel: estado ao vivo, dossiê dos funcionários e fontes das métricas, servidor local com chave e SSE, front-end Matrix.
- Skill `painel`.
- Avatares dev-4, seguranca-4 e revisor-4, e documentação dos avatares.

### Corrigido
- Só o início mais recente do agente conta como trabalhando.
- SSE com último estado por cliente, limite de fila e resposta 400 segura para requisição malformada.

## 0.2.3 — 2026-10-17

### Corrigido
- Voto idempotente por tarefa; `similares` ignora o próprio caso já gravado.

## 0.2.2 — 2026-10-17

### Corrigido
- `similares` usa o maior entre o Jaccard das tags e o do texto (sintoma e causa raiz).

## 0.2.1 — 2026-10-17

### Corrigido
- Ajustes de redação em `retro`, `tarefa` e README.
- Pasta global não vira projeto e a lição não se perde ao mover de escopo.
- `correcao_usuario` após o pronto é atribuída à tarefa concluída (`--tarefa`); `sinais --tarefa` aceita só nome de pasta.
- Escapes só para escritores; o checador não ganha nível por participar.
- O evento é registrado antes do commit da home; gravação atômica do arquivo de lições.
- `retro` lista ao usuário os transitórios descartados e trata o bug resolvido como candidato a caso (`bug_resolvido`).
- `similares` valida tags (lista de textos) com exit 2.

## 0.2.0 — 2026-10-17

### Adicionado
- 9 funcionários e build para Claude Code e Codex.
- Ciclo da tarefa em arquivos (`tarefa.mjs`) e registro de eventos, também por CLI, com hooks de subagente.
- Gate de evidência no hook Stop, com trava anti-loop independente do harness.
- `docs-atuais` com detecção de versões instaladas.
- Scripts de setup e status; skills do Gerente (`tarefa`, `setup`, `status`).
- Skills de design web e mobile.
- Manifestos, marketplaces, hooks e README.
- Cérebro: texto e formato de lições, casos e CLI, comandos de lições (criar, editar, votar, aposentar, promover), busca de lições por correspondência e votos, sinais da retrospectiva e higiene de lições, métricas de senioridade por funcionário.
- Skills `retro` e `licoes`; o time passa a usar e votar lições.

### Corrigido
- Argumentos com `=` e retomada após liberação do gate na skill `tarefa`.
- Diagnóstico de ferramentas no setup e orientações da skill `tarefa`.
- Endurecimentos menores (BOM, `hasOwn`, config corrompido, dica do `.gitignore`).
- Lições preservam texto livre, seções que não são lição e títulos/NFD manuais.
- Escape de quebra de linha na tabela de métricas.

## 0.1.0 — 2026-10-17

### Adicionado
- Fundação do plugin (json, frontmatter, caminhos, constantes).
