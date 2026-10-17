# Validação da Fase 1 — 2026-10-17

Claude Code 2.1.302 no Windows 11, Node 24.20.0. Sessões reais em modo headless (`claude -p`, stream-json com eventos de hook) num repositório descartável. Codex CLI não instalado nesta máquina.

| Item | Claude Code | Codex | Observação |
|---|---|---|---|
| Instalação local | ✅ | pendente | `claude plugin marketplace add <pasta>` + `install nabuco@nabuco`: 6 skills, 9 agentes, 3 hooks, ~1,3k tok sempre ativos |
| Instalação via GitHub privado | ✅ | pendente | `marketplace add Andgomes11/nabuco` clonou via HTTPS com as credenciais; `/nabuco:status` roda do cache `~/.claude/plugins/cache/nabuco/nabuco/0.1.0` |
| `tools` restringe agente de plugin | ✅ vale | n/a | `nabuco:revisor` só tinha Read, Grep, Glob; respondeu SEM-FERRAMENTA e o arquivo não foi criado → `checadores_locais: false` |
| Tarefa trivial ponta a ponta | ✅ | pendente | `soma`: trivial/feature, critério `node --test`, Dev implementou, Gerente rodou e registrou evidência, `concluir` passou |
| Tarefa média (plano + aprovação + Revisor) | ✅ | pendente | `media` (tamanho forçado): parou em `aguardando_aprovacao`; após "ok" numa sessão nova: Dev → 3 critérios → `checando` → Revisor (opus) "nada a reportar" → concluída |
| Gate bloqueia no Stop | ✅ | pendente | `subtrai` com pedido de parar após o Dev: `gate_bloqueou` (c1 pendente) → Gerente mudou para `aguardando_usuario` e perguntou; retomada em sessão nova verificou e concluiu |
| `${CLAUDE_PLUGIN_ROOT}` no Windows | ✅ | pendente | expandiu nos três hooks (Stop, SubagentStart, SubagentStop) |
| Eventos de subagente (campos do payload) | ✅ | pendente | `agente_inicio`/`agente_fim` com `papel`, `agent_id`, `modelo`, `effort`, `duracao_ms` e `"harness":"claude"` |

## Observações
- Sem pedido de tamanho, "dividir com erro em b=0 e testes" foi classificado como `trivial` — coerente com a regra "cabe numa frase".
- Numa retomada com pedido curto em português ("ok, pode verificar e concluir"), o Gerente respondeu em inglês. Não afeta o fluxo.
- Num repositório sem commits não há `git diff`; o Gerente entregou ao Revisor o conteúdo dos arquivos novos.

## Ajustes feitos
- Nenhum: nada falhou no Claude Code.
