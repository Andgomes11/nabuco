# Validação no Codex (Fases 1 a 3)

- Data: 2026-10-19
- Codex CLI 0.163.0 (modelo da sessão `gpt-6.1-sol`, effort `high`), plugin nabuco 0.3.1 instalado do GitHub
- Ambiente: Windows 11, repositório descartável `%TEMP%\nabuco-smoke-codex`, `codex exec` headless sem as variáveis do Claude Code. Fases 2 e 3 com `NABUCO_HOME` numa cópia do cérebro (`%TEMP%\val-codex-home`)
- Configuração necessária: `-c windows.sandbox="unelevated" -s workspace-write`, mais `~/.nabuco` (ou a cópia) como pasta gravável

| # | Item | Resultado |
|---|---|---|
| 1 | Login (`codex login --device-auth`) | ✅ o login pelo navegador não concluía quando rodado de dentro do Claude Code |
| 2 | Marketplace e plugin via GitHub privado (`codex plugin marketplace add` + `codex plugin add nabuco@nabuco`) | ✅ |
| 3 | `$setup` | ⚠️ `EPERM` ao criar `~/.codex/agents` (o sandbox protege `~/.codex`); `setup.mjs` rodado fora do sandbox instalou os 9 agentes |
| 4 | `/hooks`: confiança nos hooks Stop, SubagentStart e SubagentStop | ✅ gravada em `[hooks.state]` do `config.toml` |
| 5 | Tarefa trivial ponta a ponta (`soma`) | ✅ Dev rodou como `nabuco-dev`; critério com evidência; `concluir` passou |
| 6 | Gate na fase `planejando` | ✅ não bloqueia (esperado) |
| 7 | Gate na fase `executando` com critérios pendentes | ✅ `Stop Blocked`; o Gerente passou para `aguardando_usuario` |
| 8 | Eventos de subagente | ✅ `agente_inicio`/`agente_fim` com `"harness":"codex"`, `agent_id` real, papel, modelo e effort |
| 9 | Harness nos eventos da CLI e do gate | ❌ → corrigido: saíam como `desconhecido` |
| 10 | `$retro` sem tarefa indicada | ❌ → corrigido: escolhia a tarefa errada no mesmo dia |
| 11 | `$retro`: bug resolvido vira caso; caso e lição gravados com aprovação item a item | ✅ commit automático do cérebro falhou com `git EPERM` (sandbox), arquivos gravados |
| 12 | `$licoes` (lista e métricas) | ✅ |
| 13 | Lição usada em tarefa nova parecida (`total`) | ✅ `buscar` encontrou `debugger-0001`; `licao_usada` com `util: true` |
| 14 | Painel lendo dados gerados no Codex | ✅ níveis de Debugger/Dev, dossiê com equipamento `codex`, caso no diário e voto na lição |

## Payload real dos hooks no Codex

- Os hooks recebem `turn_id` no payload; `${CLAUDE_PLUGIN_ROOT}` expande corretamente no Windows.
- Os comandos rodados pelo modelo **não** têm `CODEX_HOME` nem `CODEX_SANDBOX`; têm `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, `CODEX_VERSION` e `CODEX_CI`.
- Um Codex aberto de dentro do Claude Code herda `CLAUDECODE` e as demais `CLAUDE_*`.

## Ajustes feitos

- `detectarHarness` reconhece `CODEX_THREAD_ID`/`CODEX_SESSION_ID` e dá prioridade às marcas do Codex sobre `CLAUDECODE` herdado; `CLAUDE_PROJECT_DIR` (só existe em hook do Claude) continua decidindo por `claude`.
- O gate repassa o payload do hook para `detectarHarness` (`gate_bloqueou`/`gate_liberado` saíam como `desconhecido`).
- `registrar`: se o evento já foi gravado na tarefa, uma falha no histórico global vira aviso. Antes o comando falhava, o Gerente repetia e o evento duplicava (`plano_aprovado` duas vezes).
- `cerebro sinais` sem tarefa ativa: no mesmo dia, desempata pelo `criada` do `estado.json`, e não pela ordem alfabética do slug.
- README: instalação com `codex plugin add`, `windows.sandbox`, `EPERM` do `$setup` e `codex.cmd`.

## Comportamentos do time no Codex

- O Gerente editou `criterios.json` com `apply_patch` para trocar o comando de verificação (a CLI não tinha como editar um critério), sem gerar evento. → Novo `T criterio-editar`: livre antes do plano aprovado; depois, só com `--ok-usuario --motivo`. Verificação nova volta o critério para pendente. Tudo registrado no evento `criterio` (`acao: "editado"`). A skill `tarefa` proíbe editar `estado.json`, `criterios.json` e `eventos.jsonl` à mão.
- Para contornar o sandbox, o Dev alterou o `package.json` do projeto (`--test-isolation=none`). Quando `~/.nabuco` não estava gravável, o Gerente apontou `NABUCO_HOME` para `.nabuco/runtime` por conta própria, em vez de perguntar. → Regra na skill `tarefa` e nos escritores (dev, debugger, designer, devops): bloqueio de ambiente não se contorna; vai para **bloqueios** ou `aguardando_usuario`. A skill `setup` orienta a rodar o `setup.mjs` fora do Codex quando der `EPERM`.
