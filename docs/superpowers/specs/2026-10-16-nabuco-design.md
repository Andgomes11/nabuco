# Design: plugin "nabuco" — time de funcionários-agentes que aprende

- Data: 2026-10-16
- Autor: Anderson Gomes (com Claude)
- Status: aguardando revisão
- Plataformas: Claude Code e OpenAI Codex

## 1. Objetivo

Um plugin instalável uma vez e usável em qualquer projeto, que organiza o desenvolvimento com agentes como um **time de funcionários** com papéis claros, que:

1. trabalha com um fluxo enxuto e verificável (plano aprovado, um escritor por vez, gate de evidência);
2. **aprende com os erros que resolve**, como um programador vira sênior (casos → lições → regras), sempre com aprovação humana;
3. consulta documentação atualizada das libs na versão instalada (sob demanda);
4. permite **visualizar e avaliar** o trabalho e a evolução de cada funcionário (painel Matrix).

### Critérios de sucesso
- Uma tarefa média vai de pedido a "pronto com evidência" com no máximo 1 aprovação de plano e sem o usuário precisar orquestrar agentes manualmente.
- Nenhuma tarefa é declarada pronta sem critérios com evidência registrada.
- Ao longo do uso, as métricas de senioridade (seção 7.5) mostram tendência de melhora e queda de recorrência de erros com lição.
- Funciona igual em Claude Code e Codex a partir de uma única fonte.

### Fora de escopo (v1)
Sala de Replay, Placar semanal, 1:1 gerado por IA, embeddings, ui-ux-pro-max embutido, suporte a outros harnesses (Cursor, OpenCode). Ver seção 11.

## 2. Princípios (de onde vêm)

| Princípio | Fonte |
|---|---|
| Um único escritor por vez; outros contribuem informação | Cognition (2025/2026), Akita |
| Subagentes servem para isolar contexto, não para role-play | HumanLayer/RPI, Anthropic |
| Processo proporcional ao tamanho/risco da tarefa | Anthropic best practices, Böckeler/Fowler (crítica a SDD) |
| Humano aprova o plano; pronto = evidência executada | Anthropic, Akita |
| Checador em contexto limpo, sem cota mínima de achados | Anthropic, crítica ao BMAD |
| Estado da tarefa fora do contexto (arquivo + git) | Anthropic long-running harness |
| Memória curada, com evidência, editada em deltas, recuperação de 1–3 itens | ACE, SWE-Exp, ReasoningBank, ExpeL, Akita (ai-memory) |
| Nunca tocar produção | Akita |
| Qualidade acima de preço; eficiência pelo fluxo (limite de uso do plano) | preferência do usuário |

## 3. Arquitetura e estrutura

Um único plugin com dois manifestos; conteúdo compartilhado; adaptadores gerados.

```
nabuco/
├── .claude-plugin/plugin.json + marketplace.json
├── .codex-plugin/plugin.json          # "skills": "./skills/", "hooks": "./hooks/hooks.json"
├── .agents/plugins/marketplace.json   # marketplace Codex
├── skills/                            # compartilhado; frontmatter só com campos do padrão agentskills.io
│   ├── tarefa/  retro/  licoes/  status/  setup/  painel/
│   ├── docs-atuais/  design-web/  design-mobile/
├── hooks/hooks.json                   # SubagentStart, SubagentStop, Stop (compartilhado)
├── scripts/
│   ├── gate-evidencia.mjs             # chamado via ${CLAUDE_PLUGIN_ROOT} (Codex também define)
│   ├── evento.mjs                     # grava eventos.jsonl / historico.jsonl
│   ├── tarefa.mjs                     # CLI do ciclo da tarefa (nova, criterio, fase, concluir…)
│   ├── setup.mjs  status.mjs  versoes.mjs
│   ├── lib/                           # módulos compartilhados
│   ├── cerebro.mjs                    # busca, destilação, métricas
│   └── painel/                        # servidor Node + front-end do painel
├── papeis/<papel>.md                  # fonte única de cada funcionário
├── modelos.json                       # papel → modelo/effort por harness
├── agents/*.md                        # GERADO (Claude Code)
├── codex-agents/*.toml                # GERADO (Codex); setup copia p/ ~/.codex/agents/
├── assets/avatares/<papel>-<nivel>.png
├── build.mjs                          # papeis/ + modelos.json → agents/ e codex-agents/
└── README.md
```

Fora do plugin:
```
~/.nabuco/                       (repositório git)
├── casos/<papel>/AAAA-MM-<slug>.md
├── licoes/<papel>.md
├── licoes/arquivo/<papel>.md
└── historico.jsonl

<projeto>/.nabuco/
├── licoes/<papel>.md          (lições de escopo "projeto")
├── ativa                      (nome da pasta da tarefa ativa)
└── tarefas/AAAA-MM-DD-<slug>/
    ├── estado.json            (slug, tamanho, tipo, fase)
    ├── plano.md
    ├── progresso.md
    ├── criterios.json
    └── eventos.jsonl
```

### 3.1 Diferenças entre harnesses (absorvidas)

| Ponto | Claude Code | Codex | Solução |
|---|---|---|---|
| Invocação | `/nabuco:tarefa` | `$tarefa` | mesma skill |
| Agentes | `agents/*.md` no plugin | TOML em `~/.codex/agents/` (plugin não empacota agentes) | `build.mjs` gera ambos; `setup` instala os TOML com nome `nabuco-<papel>` (Claude: `nabuco:<papel>`) |
| Campos extras de skill (`model`, `effort`, `context`) | suportados | não | núcleo usa só o spec aberto; extras injetados apenas no adaptador Claude, se necessários |
| Restringir ferramentas por agente | `tools` no frontmatter (validar em agente de plugin) | não há sandbox por agente | Claude: `tools`; se não valer em plugin, setup instala checadores em `~/.claude/agents/`. Codex: instrução + `git diff` conferido pelo Gerente após cada checador |
| Gate | Stop/SubagentStop `{"decision":"block","reason"}` | Stop igual; exige trust em `/hooks` | mesmo script; e passo explícito na skill `tarefa` |
| Instruções de projeto | lê AGENTS.md só sem CLAUDE.md | AGENTS.md | protocolo vive na skill `tarefa`, não depende de AGENTS.md |
| Caminho do plugin | `${CLAUDE_PLUGIN_ROOT}` | `${PLUGIN_ROOT}` e `${CLAUDE_PLUGIN_ROOT}` | usar `${CLAUDE_PLUGIN_ROOT}` |

## 4. Funcionários

Definidos por escopo, ferramentas e limites. Prompt (`papeis/<papel>.md`) curto e imperativo (≤ ~60 linhas): missão, protocolo em passos, limites, formato de entrega.

| Papel | Faz | Não pode | Escreve | Claude | Codex |
|---|---|---|---|---|---|
| Gerente (skill `tarefa`) | classifica, planeja, delega, registra, gate, retro | editar código de produto | só `.nabuco/` | sessão | sessão |
| Dev | implementa + testes | mudar escopo; adicionar dependência fora do plano | sim | inherit/high | herda/high |
| Debugger | reproduz → teste de regressão → causa raiz → fix mínimo | corrigir sem teste falhando antes | sim (sequencial) | opus/high | gpt-6-astra/high |
| Designer | UI web e mobile; tokens antes do código; autocrítica com screenshot | violar HIG/M3 em app nativo | sim (sequencial) | inherit/high | herda/high |
| DevOps | CI, IaC, Docker, scripts para staging | tocar produção, segredos reais, push/deploy | sim (sequencial) | inherit/high | herda/high |
| Docs | README, changelog, docs de API | editar código | só docs | sonnet/medium | gpt-6.1-sol/medium |
| Arquiteto | estrutura, limites, trade-offs | editar | não | opus/high | gpt-6-astra/high |
| Revisor | corretude, legibilidade, aderência ao plano (só o diff) | editar; opinião de gosto | não | opus/high | gpt-6-astra/high |
| Segurança | injeção, auth, segredos, deps vulneráveis, LGPD | editar | não | opus/high | gpt-6-astra/high |
| Tester | roda suíte/E2E, aponta lacunas, confere `criterios.json` | editar (pode executar comandos) | não | sonnet/medium | gpt-6.1-sol/medium |

- Opção "máxima" (configurável em `modelos.json`): `fable` (Claude) / `gpt-6-astra` (Codex) nos papéis de raciocínio.
- `effort` sempre explícito (fontes divergem sobre o padrão).
- Override pelo usuário: agente homônimo em `.claude/agents/`/`~/.claude/agents/`, `CLAUDE_CODE_SUBAGENT_MODEL`, ou editar `modelos.json` e rodar build.
- **Formato de entrega** de todo funcionário: `mudanças`, `decisões`, `evidência` (comando + saída resumida), `lições usadas` (id + 👍/👎), `bloqueios`.

### 4.1 Designer — composição
- `design-web`: texto próprio inspirado na skill oficial `frontend-design` (crédito no NOTICE, sem copiar conteúdo): direção estética anti-genérica, plano de tokens, autocrítica.
- `design-mobile`: referências próprias curtas de Apple HIG e Material 3 (com data e link oficial) + checklist mobile: alvo de toque 44pt/48dp, Dynamic Type/escala de fonte, safe areas, dark mode, VoiceOver/TalkBack.
- Regra explícita: em app nativo, convenção da plataforma vence ousadia estética.
- Integrações opcionais se instaladas: ui-ux-pro-max (base multiplataforma), plugin Figma oficial, `chrome-devtools-mcp:a11y-debugging`.
- nv-design descartado (escopo estreito, derivado de curso pago).

## 5. Fluxo da skill `tarefa` (Gerente)

1. **Classificar** tamanho e tipo.
   - Trivial (cabe numa frase, sem comportamento sensível): sem plano, sem checadores, só gate.
   - Média: plano curto + Revisor.
   - Sensível (auth, pagamento, dados, migrations, infra, API pública): plano com checkpoints por fase + Revisor, Segurança e Tester.
   - Tipo → escritor: bug→Debugger; UI→Designer; infra/CI→DevOps; demais→Dev; estrutural→Arquiteto opina antes do plano.
   - Usuário pode forçar o tamanho.
2. **Entender**: ler código relevante; `docs-atuais` para libs envolvidas (versão do lockfile → doc dessa versão).
3. **Planejar** (média/sensível): criar pasta da tarefa com `plano.md` (objetivo, método, restrições, validação; ≤ ~40 linhas) e `criterios.json` (cada critério com comando de verificação). **Parar e aguardar aprovação.**
4. **Executar**: um escritor por vez. Entrada: plano, critérios, `progresso.md`, lições recuperadas (seção 7.3). Saída no formato de entrega; Gerente anexa ao `progresso.md` (decisões, estado, próximo passo). `/nabuco:tarefa` sem argumentos retoma do `progresso.md`.
5. **Checar** (por risco): checadores em paralelo, contexto limpo (diff + plano + critérios), só achados que afetam corretude, sem cota. Gerente filtra e devolve ao escritor. Máximo 2 rodadas; depois, decisão do usuário.
6. **Gate de evidência**: todo critério `passou` com saída registrada. Duas camadas: (a) `tarefa.mjs concluir` recusa concluir com critério pendente ou sem evidência; (b) hook **Stop** (só o agente principal) bloqueia o fim do turno quando a tarefa ativa está nas fases `executando` ou `checando` — o Gerente precisa concluir com evidência ou passar explicitamente para `aguardando_usuario` antes de parar. `SubagentStop` só registra eventos (bloquear checadores ao terminar seria errado). Fases: `planejando`, `aguardando_aprovacao`, `executando`, `checando`, `aguardando_usuario`, `concluida`, `abandonada`.
7. **Fechar**: resumo ao usuário com evidências; Docs se API pública mudou; abrir retrospectiva.

Limites globais: nunca tocar produção; nunca push/deploy; commit só com ok do usuário; nenhuma dependência nova fora do plano aprovado.

### 5.1 Formatos
`criterios.json`:
```json
{ "tarefa": "2026-10-16-login-social", "criterios": [
  { "id": "c1", "descricao": "login com Google cria usuário", "verificacao": "npm test -- auth.google",
    "status": "pendente|passou|falhou", "evidencia": "142 passed (saída resumida)", "em": "ISO-8601" } ] }
```
`progresso.md`: seções `Estado atual`, `Próximo passo`, `Decisões` (append-only, com autor), `Log` (append-only).

## 6. Eventos

`eventos.jsonl` por tarefa (e cópia consolidada em `~/.nabuco/historico.jsonl`), uma linha por evento:
```json
{"ts":"ISO","tarefa":"slug","projeto":"nome","harness":"claude|codex","tipo":"...","papel":"...","dados":{}}
```
Tipos: `tarefa_criada` (tamanho, tipo), `plano_aprovado`/`plano_rejeitado`, `agente_inicio`/`agente_fim` (modelo, effort, duração — via hooks), `achado` (checador, severidade), `rodada_correcao`, `gate_bloqueou` (critérios pendentes), `criterio` (id, status), `licao_usada` (id, util: true/false), `correcao_usuario`, `caso_criado`, `licao_criada`/`licao_editada`/`licao_aposentada`/`licao_promovida`, `tarefa_fechada`.
Gravação: hooks (automáticos) + skills via `node ${CLAUDE_PLUGIN_ROOT}/scripts/evento.mjs`.

## 7. Cérebro (aprendizado por erros)

### 7.1 Camadas
1. **Casos** (`~/.nabuco/casos/<papel>/`): diário de erros resolvidos. Nunca injetado no prompt; consultado por busca.
2. **Lições** (`licoes/<papel>.md`, global; ou `.nabuco/licoes/` do projeto): padrões destilados; limite 30 por papel; só 1–3 relevantes injetadas.
3. **Regras**: lições promovidas a hook/lint/teste.

### 7.2 Formatos
Caso (só com sinal objetivo — teste/comando que provou):
```markdown
sintoma: <mensagem de erro literal / comando>
contexto: <stack, arquivo, tarefa>
hipótese errada: <o que se pensou primeiro>
causa raiz: <...>
correção: <...>
verificação: <comando + resultado>
sinal precoce: <o que deveria ter sido notado antes>
custo: <turnos/tempo> · tags: <...> · papel: <...>
```
Lição:
```markdown
## <papel>-NNNN · <título imperativo>
- gatilho: <sintoma/condição observável>
- expectativa: <se for isso, deve-se ver Y; se não, hipótese errada>
- faça: <ação>
- por quê: <causa>
- evidência: <links para casos> · escopo: global|projeto
- 👍 N  👎 M · última: AAAA-MM-DD
```

### 7.3 Recuperação
`cerebro.mjs buscar` por grep/tokenização sobre gatilho, tags, tokens do sintoma e arquivos da tarefa; ranking por correspondência + 👍−👎 + recência; retorna no máximo 3 lições (+ link do caso). Debugger pode chamar sob demanda. Sem embeddings até ~200 casos.

### 7.4 Retrospectiva (`/nabuco:retro`, também ao fechar tarefa)
1. Coletar sinais do `progresso.md`/eventos: falhas, retrabalho, achados, critérios que falharam antes de passar, correções do usuário.
2. Propor casos (com evidência) e 0–3 lições por funcionário envolvido (inclui Gerente). Filtros: descartar falhas transitórias (rede, token, PATH, serviço fora); duplicata → incrementar contador; contradição → mostrar ambas.
3. Destilar lição quando ≥2 casos similares (tags/sintoma) ou 1 caso de custo alto.
4. Usuário aprova/edita/muda escopo/descarta item a item.
5. Aplicar como **deltas** (nunca reescrever o arquivo inteiro); commit no git de `~/.nabuco/`.
Higiene: >30 lições → propor fusão/aposentadoria; sem uso em 90 dias ou 👎>👍 → revisão/arquivo; muitos 👍, 0 👎 e verificável mecanicamente → propor promoção a regra.

### 7.5 Métricas de senioridade
Por papel, com tamanho da amostra: recorrência (erro com lição que voltou), turnos até causa raiz, tentativas até verde, aceitação na 1ª tentativa, escapes (bug pego pelo usuário após "pronto"), % lições 👍, promoções a regra. Nível (Júnior/Pleno/Sênior/Especialista) derivado dessas métricas, **pode cair**, e mostra "provisório" com amostra < 10. Nunca por volume.

## 8. Painel Matrix

- `/nabuco:painel`: servidor Node local (127.0.0.1, porta livre, chave na URL), lê `historico.jsonl` + `eventos.jsonl` do projeto, atualiza ao vivo (SSE), abre o navegador.
- **Monitores**: um por funcionário; chuva de código com velocidade = atividade; vermelho/parado = travado aguardando usuário; apagado = ocioso. Cabeçalho com tarefa, fase e gate.
- **Avatares**: imagens geradas por IA em `assets/avatares/<papel>-<nivel>.png` (prompts em `avatares/PROMPTS.md`); efeitos de estado aplicados por CSS/canvas; fallback em silhueta se faltar imagem. Regra: todo elemento visual corresponde a um dado.
- **Dossiê** (clique): nível ("clearance") e amostra, equipamento (modelo/effort), atributos com tendência (Faro, Precisão, Confiabilidade), diário de batalha (casos), "programas carregados" (lições com 👍/👎, ruins destacadas), talentos (regras). Cada número clicável até os eventos de origem.
- Evitar: XP por volume, ranking entre funcionários, animações sem dado.

## 9. Instalação e setup

- Claude: `/plugin marketplace add Andgomes11/nabuco` → `/plugin install nabuco`.
- Codex: `codex plugin marketplace add Andgomes11/nabuco` → habilitar → trust dos hooks em `/hooks`.
- `/nabuco:setup` (`$setup`): criar `~/.nabuco/` + git init; instalar `codex-agents/*.toml` em `~/.codex/agents/`; checar Node ≥ 20; validar `modelos.json` e frontmatter gerado (campos/modelos inválidos são ignorados silenciosamente pelos harnesses); testar restrição `tools` em agente de plugin e aplicar fallback; sugerir `.nabuco/` no `.gitignore`.

## 10. Testes do plugin

1. Unitários (`node:test`): gate-evidencia, evento, cerebro (buscar, destilar, métricas), build.
2. Validação de build: agentes gerados batem com os formatos de Claude e Codex.
3. Cenários (repos fixture com bug/tarefa conhecidos), rodados headless (`claude -p`, `codex exec`, `claude plugin eval`): gate bloqueia sem evidência; checador não altera arquivos; busca retorna a lição esperada para um sintoma; retomada via `progresso.md`.
4. Dogfooding a partir da Fase 2.

## 11. Fases

| Fase | Entrega |
|---|---|
| 1. Núcleo | papéis + build (Claude/Codex), skills `tarefa`, `setup`, `status`, `docs-atuais`, `design-web`, `design-mobile`, gate, eventos, manifestos/marketplaces |
| 2. Cérebro | casos, lições, regras, `cerebro.mjs`, `retro`, `licoes`, métricas |
| 3. Painel | servidor, monitores, avatares, dossiê |

Depois da v1: Sala de Replay, Placar semanal (métricas tipo DORA, pass^k), 1:1 gerado por IA com citações, ui-ux-pro-max embutido, embeddings, outros harnesses.

## 12. Riscos e validações pendentes

- `tools` em subagente de plugin (Claude) não documentado → teste no setup + fallback.
- Codex: sem isolamento de escrita por agente → instrução + diff conferido.
- Codex: hooks exigem trust manual e re-trust a cada mudança → README.
- Codex: matcher do evento Stop e expansão de `${CLAUDE_PLUGIN_ROOT}` no Windows → validar na Fase 1.
- Formato novo `plugin.json` na raiz ("Agent Plugins") vs `.codex-plugin/` legado → usar legado na v1, monitorar.
- Custo/limite de uso de multi-agente (~15x tokens de um chat) → checadores por risco.
- Memória poluída → evidência obrigatória, aprovação humana, deltas, 👍/👎, aposentadoria.
