# Changelog

Formato simplificado do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões mais recentes primeiro.

## Não lançado

### Adicionado
- Auditor de release (`/nabuco:release` no Claude Code, `$release` no Codex): confere tarefas, versões, comandos e changelog desde a última release.
- Vigia de segurança (`/nabuco:vigia` no Claude Code, `$vigia` no Codex): modo `ambiente` (permissões amplas, hooks, MCPs, plugins, `.env` versionado e segredos no histórico do git, sempre mascarados) e modo `deps` (`npm audit` e OSV, com "não verificado" quando não dá para checar); correções propostas uma por vez e só aplicadas com aprovação. O Gerente roda `deps --novos` ao abrir cada tarefa e sugere uma tarefa `sensivel` se surgir vulnerabilidade alta nova.
- Contratar funcionário (`/nabuco:contratar` no Claude Code, `$contratar` no Codex): entrevista curta, prévia completa e ok antes de gravar; o novo escritor ou checador fica em `~/.nabuco/time/`, é instalado como `nabuco-<papel>` no Claude Code e no Codex e é reconhecido pelo Gerente, cérebro, eventos, métricas, painel, status e setup. CLI `scripts/contratar.mjs` com `validar`, `novo`, `listar`, `instalar` e `remover` (lições e casos ficam); checador só com ferramentas de leitura e nunca sobrescreve agente alheio.

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
