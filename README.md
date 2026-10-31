# nabuco

Time de funcionários-agentes para **Claude Code** e **OpenAI Codex**: um Gerente coordena Dev, Debugger, Designer, DevOps, Docs, Arquiteto, Revisor, Segurança e Tester — com plano aprovado, um escritor por vez e **gate de evidência** (nada é "pronto" sem o comando que prova).

> Fase 3 (painel Matrix) sobre o cérebro de aprendizado: casos → lições → regras.

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
codex plugin add nabuco@nabuco
```
Rode `$setup` e depois `/hooks` para confiar nos hooks do nabuco (o Codex pede isso de novo a cada atualização do plugin).

No Windows:
- Sem sandbox configurado o Codex cai para somente leitura e não consegue nem ler as skills. Adicione ao `~/.codex/config.toml`:
  ```toml
  [windows]
  sandbox = "unelevated"
  ```
  Nesse modo o Node não consegue abrir subprocessos (`spawn EPERM`): `node --test` precisa de `--test-isolation=none` e o commit automático do cérebro falha (os arquivos são gravados mesmo assim).
- O sandbox também protege `~/.codex`, então o `$setup` não consegue instalar os agentes por lá. Se ele avisar `EPERM`, rode `node <plugin>/scripts/setup.mjs` num terminal comum.
- Se o PowerShell recusar `codex` por política de execução, use `codex.cmd`.

Requisitos: Node 20+ e git. O repositório é privado: os harnesses usam as suas credenciais do GitHub.

## Uso

| Ação | Claude Code | Codex |
|---|---|---|
| Executar uma tarefa | `/nabuco:tarefa <descrição>` | `$tarefa <descrição>` |
| Retomar a tarefa ativa | `/nabuco:tarefa` | `$tarefa` |
| Ver o time e a instalação | `/nabuco:status` | `$status` |
| Retrospectiva da tarefa | `/nabuco:retro` | `$retro` |
| Ver e cuidar das lições | `/nabuco:licoes` | `$licoes` |
| Abrir o painel Matrix | `/nabuco:painel` | `$painel` |
| Auditar uma release | `/nabuco:release` | `$release` |
| Vigiar segurança do ambiente e dependências | `/nabuco:vigia` | `$vigia` |

Cada tarefa vive em `.nabuco/tarefas/<data>-<slug>/` no projeto (`plano.md`, `progresso.md`, `criterios.json`, `estado.json`, `eventos.jsonl`). Adicione `.nabuco/` ao `.gitignore` se não quiser versionar.

## Cérebro

O time aprende com os erros que resolveu, em três camadas:
- **Casos** (`~/.nabuco/casos/<papel>/`): diário de erros resolvidos, sempre com o comando que provou a correção.
- **Lições** (`~/.nabuco/licoes/<papel>.md`, globais, ou `.nabuco/licoes/<papel>.md`, do projeto): padrões destilados, até 30 por funcionário; o Gerente entrega no máximo 3 relevantes a cada escritor, que informa quais usou; o Gerente registra o voto 👍/👎. Faltando lições relevantes, a busca completa com até 2 casos parecidos.
- **Quando um caso vira lição:** a retro propõe a lição já no primeiro caso quando há um sinal precoce para ensinar ou quando um checador pegou o erro (achado alto ou médio), sem esperar o erro se repetir. Se o erro volta depois de a lição ter sido entregue na tarefa, o caso é marcado como recorrência sozinho.
- **Senioridade:** o escritor é medido por aceitação de primeira, recorrência e escapes. O checador é medido pelos achados que viraram correção e pelos problemas que escaparam da revisão dele. O nível só aparece a partir de 3 tarefas; antes disso fica "em avaliação".
- **Regras**: lições confiáveis promovidas a hook, lint ou teste.

Ao fechar uma tarefa, `/nabuco:retro` (`$retro`) propõe casos e lições a partir das falhas; `/nabuco:licoes` (`$licoes`) lista, mostra métricas de senioridade, edita, aposenta e promove.
**Nenhum caso ou lição é criado ou alterado sem a sua aprovação**, item a item (votos e eventos são registrados automaticamente). As mudanças em `~/.nabuco/` são commitadas no git de lá; nunca no repositório do projeto.

**Mesmo time em todos os projetos e máquinas:** lições globais, casos e histórico ficam em `~/.nabuco`, valem para qualquer projeto e o nível de cada funcionário é calculado sobre todos eles. Para levar o time a outra máquina (e ter cópia), o `/nabuco:setup` oferece sincronizar `~/.nabuco` com um repositório git privado (`setup.mjs --cerebro-remoto <url>`). A sincronização roda em segundo plano no início de cada sessão e depois de cada caso ou lição; o limite do plano e a configuração local não sobem. Para forçar: `node <plugin>/scripts/sincronizar.mjs`.

O gate de evidência segura só a sessão do Gerente da tarefa: a que rodou a CLI de tarefa por último (no Claude Code). Outra sessão aberta no mesmo projeto não é bloqueada.

## Painel

`/nabuco:painel` (`$painel`) sobe um servidor local e abre o painel no navegador: um monitor por funcionário (estado, atividade, nível), a tarefa ativa, o gate e o dossiê de cada um (atributos, diário, lições, equipamento). Clicar num número mostra os eventos que o geraram.
- Somente leitura, só em `127.0.0.1`, protegido por chave na URL (não compartilhe o endereço).
- Funciona offline, sem dependências. Para fechar, encerre o processo.
- Avatares em `assets/avatares/<papel>-<nivel>.jpg`; imagem ausente cai numa silhueta.
- Opções: `--porta <n>`, `--sem-abrir`.
- **Linha do tempo** (coluna ao lado dos monitores; no celular, embaixo): mostra ao vivo os eventos da tarefa ativa. Inclui fases, cada delegação do Gerente (`→ Dev: <passo>`), início e fim de cada agente com o modelo e a duração, as notas do `T log`, os critérios, os achados dos checadores e o gate.
- **Limite do plano** (só Claude Code, planos Pro/Max): o cabeçalho mostra o uso da janela de 5 h e da semanal, com o horário de renovação, e quanto a tarefa ativa consumiu desde que foi criada. O consumo da tarefa é aproximado, porque o limite é da conta e inclui outras sessões no mesmo período. Não existe consumo por funcionário. O dado vem da status line do nabuco, que o `/nabuco:setup` oferece instalar (`setup.mjs --status-line`). Ela grava em `~/.nabuco/limite.jsonl` e, se você já tinha uma status line, continua mostrando a sua.

## Release

`/nabuco:release` (`$release`) audita a próxima versão desde a release anterior (data do commit da maior tag semver alcançável do HEAD, com ou sem `v`; sem tag, o último relatório liberado; sem nenhum, todas as tarefas) e só libera com evidência de cada item:
- **Tarefas**: todas as de `.nabuco/tarefas/` do período precisam estar concluídas (a ativa em andamento conta como não concluída); abandonada é só aviso.
- **Versões**: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `pyproject.toml` e `Cargo.toml` que existirem precisam ser legíveis, concordar, bater com `--versao X.Y.Z` (se informado) e ser maiores que a release anterior (tag ou relatório-base).
- **Comandos**: os de `.nabuco/release.json` (`{"comandos": ["npm test"]}`), ou `npm test` se houver script `test`; todos precisam sair com 0.
- **Changelog**: `CHANGELOG.md` com uma seção com conteúdo para a versão.

O relatório vai para `.nabuco/releases/<versao>.md` (saída 0 = liberada, 1 = reprovada); o de uma versão já liberada não é sobrescrito (suba a versão). O auditor só lê o projeto: nunca cria tag, commit, push nem publica.

## Vigia

`/nabuco:vigia` (`$vigia`) olha a segurança além do diff, em dois modos (`/nabuco:vigia ambiente` ou `deps` roda só um):
- **ambiente**: permissões amplas (`bypassPermissions`, `allow` com `Bash`/`*`, Codex `never` + `danger-full-access`), hooks (inventário; `curl | sh`, `iex`, base64 executado), MCPs (segredo literal em `env`/`headers`/`args`, `http://` remoto, `npx -y` sem versão), plugins e marketplaces, `.env` versionado e segredos no histórico do git (`--max-commits`, padrão 1000).
- **deps**: vulnerabilidades conhecidas via `npm audit` (com `package-lock.json`) e [OSV](https://osv.dev) para `requirements.txt`, `poetry.lock`, `Cargo.lock`, `go.mod`, `pnpm-lock.yaml` e `yarn.lock`. Falha de rede ou de comando vira **não verificado**, nunca "sem vulnerabilidades".

Achados têm severidade alta, media, baixa ou info (saída 1 se houver alta ou media). A skill propõe a correção de cada um, um por vez, e só aplica o que você aprovar; atualizar dependência vira sugestão de tarefa `sensivel`.
O `deps` guarda em `.nabuco/vigia/deps.json`, por lockfile verificado por completo, a data, o hash e os ids achados; com `--novos` não recheca o lockfile que não mudou nas últimas 24h e mostra só ids que não estavam lá (o que ficou **não verificado** aparece sempre). O Gerente roda `deps --novos` ao abrir cada tarefa.

Lê `~/.claude/settings.json`, `.claude/settings*.json`, `.mcp.json`, os `mcpServers` do `~/.claude.json` (nada mais dele), os plugins e marketplaces instalados e `~/.codex/config.toml`. Nunca lê o `~/.codex/auth.json` nem credenciais.
Nunca mostra um segredo inteiro (só os 4 primeiros caracteres e `…`), nunca reescreve o histórico do git nem faz force push (segredo no histórico → rotacione a chave no provedor), nunca roda `npm audit fix --force` e nunca faz commit.

## Modelos por funcionário

Edite `modelos.json` e rode `npm run build` (gera `agents/` e `codex-agents/` — não edite esses arquivos à mão). No Claude Code também dá para sobrescrever um agente criando outro com o mesmo nome em `~/.claude/agents/`, ou forçar um modelo para todos com `CLAUDE_CODE_SUBAGENT_MODEL`.

## Desenvolvimento

```
npm test            # testes (node:test, sem dependências)
npm run build       # regenera agentes a partir de papeis/ + modelos.json
npm run build:check # falha se os gerados estiverem desatualizados
```
