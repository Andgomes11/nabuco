# nabuco

Time de funcionários-agentes para **Claude Code** e **OpenAI Codex**: um Gerente coordena Dev, Debugger, Designer, DevOps, Docs, Arquiteto, Revisor, Segurança e Tester — com plano aprovado, um escritor por vez e **gate de evidência** (nada é "pronto" sem o comando que prova).

> Fase 1 (núcleo). Próximas fases: cérebro de aprendizado (casos → lições → regras) e painel Matrix.

## Instalação

**Claude Code**
```
/plugin marketplace add Andgomes11/nabuco
/plugin install nabuco@nabuco
/nabuco:setup
```

**Codex**
```
codex plugin marketplace add Andgomes11/nabuco
```
Habilite o plugin, rode `$setup` e depois `/hooks` para confiar nos hooks do nabuco (o Codex pede isso de novo a cada atualização do plugin).

Requisitos: Node 20+ e git. O repositório é privado: os harnesses usam as suas credenciais do GitHub.

## Uso

| Ação | Claude Code | Codex |
|---|---|---|
| Executar uma tarefa | `/nabuco:tarefa <descrição>` | `$tarefa <descrição>` |
| Retomar a tarefa ativa | `/nabuco:tarefa` | `$tarefa` |
| Ver o time e a instalação | `/nabuco:status` | `$status` |

Cada tarefa vive em `.nabuco/tarefas/<data>-<slug>/` no projeto (`plano.md`, `progresso.md`, `criterios.json`, `estado.json`, `eventos.jsonl`). Adicione `.nabuco/` ao `.gitignore` se não quiser versionar.

## Modelos por funcionário

Edite `modelos.json` e rode `npm run build` (gera `agents/` e `codex-agents/` — não edite esses arquivos à mão). No Claude Code também dá para sobrescrever um agente criando outro com o mesmo nome em `~/.claude/agents/`, ou forçar um modelo para todos com `CLAUDE_CODE_SUBAGENT_MODEL`.

## Desenvolvimento

```
npm test            # testes (node:test, sem dependências)
npm run build       # regenera agentes a partir de papeis/ + modelos.json
npm run build:check # falha se os gerados estiverem desatualizados
```
