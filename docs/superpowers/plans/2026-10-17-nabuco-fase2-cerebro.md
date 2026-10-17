# nabuco — Fase 2 (Cérebro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao time a capacidade de aprender com os erros resolvidos: casos → lições → regras, com recuperação de 1–3 lições por tarefa, votos 👍/👎, retrospectiva aprovada pelo usuário, higiene e métricas de senioridade por funcionário.

**Architecture:** Toda a lógica determinística fica num novo CLI `scripts/cerebro.mjs` apoiado por módulos puros em `scripts/lib/` (texto, lições, casos, busca, sinais, métricas), testados com `node:test` como na Fase 1. O modelo nunca edita arquivos de lição à mão: ele propõe, o usuário aprova e a skill chama o CLI, que grava **deltas** (só o bloco afetado muda) e commita no git de `~/.nabuco/`. As skills `retro` e `licoes` são novas; `tarefa` e os papéis passam a recuperar lições, repassá-las ao escritor e registrar votos.

**Tech Stack:** Node.js ≥ 20 (ESM `.mjs`, só módulos nativos), Markdown, JSON, Git.

**Spec:** `docs/superpowers/specs/2026-10-16-nabuco-design.md` (seções 5, 6 e 7 principalmente)

## Global Constraints

- Tudo da seção Global Constraints do plano da Fase 1 continua valendo (Node ≥ 20, zero dependências, ESM, `node:path`, Windows com espaço/acentos no caminho, texto em pt-BR, frontmatter de skill no padrão aberto, hooks nunca derrubam o harness, papéis ≤ 80 linhas, commits `tipo: descrição` sem `Co-Authored-By`).
- Caso só existe com sinal objetivo: `verificacao` (comando + resultado) é obrigatório.
- Lições por papel: limite **30** ativas; busca retorna **no máximo 3**; sem embeddings.
- Toda escrita em lição/caso é **delta**: o restante do arquivo fica byte a byte igual.
- Nada é gravado no cérebro sem aprovação do usuário (as skills garantem; o CLI só executa).
- Commits automáticos só no git de `~/.nabuco/` — **nunca** no repositório do projeto (`<projeto>/.nabuco/licoes/` não é commitado).
- Nível de senioridade nunca por volume; pode cair; "provisório" com amostra < 10.
- Entrada estruturada longa (caso, lição) chega por arquivo JSON (`--de <arquivo>`), nunca por JSON na linha de comando (aspas no Windows).

## Review Focus

1. **Arquivo de lições editado à mão pelo usuário** (linhas extras, bloco sem 👍/👎, cabeçalho diferente, CRLF, BOM): parse não quebra, blocos desconhecidos são preservados intactos na regravação. (teste na Task 1)
2. **Cérebro vazio / `~/.nabuco` inexistente / sem git**: `buscar`, `metricas`, `higiene`, `sinais` respondem com listas vazias e exit 0; escrita funciona sem git (aviso em stderr, sem falhar). (testes nas Tasks 2, 4, 6)
3. **`historico.jsonl` com linhas corrompidas ou de versões antigas** (sem `projeto`, sem `dados`): métricas ignoram a linha e seguem. (teste na Task 6)
4. **Sintoma com acentos, caixa diferente e pontuação** ("Não foi possível" vs "nao foi possivel:"): a busca casa igual. (teste na Task 1)
5. **Mesmo id de lição no projeto e no global** (projetos diferentes numeram independentemente): mover uma lição de projeto para global renumera em vez de sobrescrever. (teste na Task 3)

---

## Estrutura de arquivos (Fase 2)

```
scripts/
├── cerebro.mjs                 # CLI: caso-add, casos, similares, licao-add, licao-editar,
│                               #      licao-reforcar, voto, aposentar, promover, licoes,
│                               #      buscar, sinais, higiene, metricas
└── lib/
    ├── texto.mjs               # tokenizar, similaridade (Jaccard), transitorio
    ├── licoes.mjs              # parse/serialização de blocos de lição, deltas, ids
    ├── casos.mjs               # gravar/ler casos (formato da seção 7.2)
    ├── git.mjs                 # commitHome(msg)
    ├── busca.mjs               # ranking de lições
    ├── sinais.mjs              # sinais da retrospectiva de uma tarefa
    └── metricas.mjs            # métricas de senioridade e nível
skills/retro/SKILL.md           # nova
skills/licoes/SKILL.md          # nova
skills/tarefa/SKILL.md          # modificada: busca, voto, retro, correcao_usuario
papeis/*.md                     # modificados: item "lições usadas" na entrega
scripts/lib/constantes.mjs      # modificado
scripts/tarefa.mjs              # modificado: evidência de falha no evento
tests/texto.test.mjs  licoes.test.mjs  casos.test.mjs  cerebro.test.mjs
tests/busca.test.mjs  sinais.test.mjs  metricas.test.mjs
```

Dados (fora do plugin), conforme spec 3:
```
~/.nabuco/casos/<papel>/AAAA-MM-<slug>.md
~/.nabuco/licoes/<papel>.md          ~/.nabuco/licoes/arquivo/<papel>.md
<projeto>/.nabuco/licoes/<papel>.md
```

## Decisões que o spec deixou abertas (valem para todas as tasks)

- **Papéis do cérebro:** os 9 de `PAPEIS` **mais `gerente`** (spec 7.4: "inclui Gerente").
- **Formato do arquivo de lições:** linha 1 `# Lições — <papel>`, depois blocos exatamente como a spec 7.2, com duas linhas opcionais no fim do bloco: `- regra: <onde foi aplicada>` (promovida) e `- aposentada: AAAA-MM-DD · <motivo>` (só no arquivo morto). Um bloco começa em `## ` e vai até o próximo `## ` ou o fim. `última` é a data do último voto (na criação, a data de criação).
- **Ids:** `<papel>-NNNN`, `NNNN` = 1 + maior número já usado para o papel somando global, arquivo morto e lições do projeto atual.
- **Duplicata:** título+gatilho com similaridade Jaccard ≥ **0,6** com uma lição ativa → `licao-add` recusa (exit 1) e imprime o id da parecida; a retro então usa `licao-reforcar` (acrescenta o link do caso à evidência). `--forcar` ignora a checagem.
- **Contradição:** não é detectada mecanicamente; a skill `retro` instrui o modelo a mostrar as duas lições ao usuário.
- **Custo alto** (destila lição com 1 caso só): `turnos ≥ 8`.
- **Transitório** (descartar na retro): texto que casa `/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|rate.?limit|429|503|token (expirado|expired|inválido|invalid)|command not found|não é reconhecido|is not recognized|ENOENT.*(node|npm|git)\b/i`.
- **Promoção a regra:** o CLI só marca a lição com `- regra: <onde>`; o hook/lint/teste em si é escrito como tarefa normal do time. Lição promovida sai da busca e não conta no limite de 30.
- **Escopo projeto → global:** `licao-editar --escopo global` move o bloco; se o id já existir no global, recebe o próximo id livre (evento `licao_editada` com `dados.id_anterior`).
- **Escapes:** evento `correcao_usuario` com `dados.apos_pronto: true`.

---

### Task 1: texto e lições (módulos puros)

**Files:**
- Modify: `scripts/lib/constantes.mjs`
- Create: `scripts/lib/texto.mjs`, `scripts/lib/licoes.mjs`
- Test: `tests/texto.test.mjs`, `tests/licoes.test.mjs`

**Interfaces:**
- Produces (constantes): `PAPEIS_CEREBRO` (`[...PAPEIS, 'gerente']`), `ESCRITORES = ['debugger','designer','dev','devops','docs']`, `LIMITE_LICOES = 30`, `MAX_BUSCA = 3`, `LIMIAR_DUPLICATA = 0.6`, `CUSTO_ALTO_TURNOS = 8`, `DIAS_SEM_USO = 90`, `MIN_POSITIVOS_PROMOCAO = 5`, `AMOSTRA_MINIMA = 10`, `JANELA_TAREFAS = 30`.
- Produces (texto): `tokenizar(s: string) → string[]` (minúsculas, sem diacríticos, separa em não-alfanumérico, descarta tokens < 3 letras e stopwords pt/en: `para com que nao uma por dos das the and for with from`), `similaridade(a: string, b: string) → number` (Jaccard dos conjuntos de tokens, 0..1), `ehTransitorio(s: string) → boolean` (regex das Decisões).
- Produces (licoes): `lerLicoes(texto: string) → { cabecalho: string, blocos: Bloco[] }` onde `Bloco = { id, titulo, gatilho, expectativa, faca, porque, evidencia: string[], escopo, positivos, negativos, ultima, regra|null, aposentada|null, bruto: string }`; `serializarBloco(b: Bloco) → string`; `substituirBloco(texto, id, novoBloco|null) → string` (null remove); `acrescentarBloco(texto, papel, bloco) → string` (cria cabeçalho se texto vazio); `proximoId(papel, textos: string[]) → string`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/texto.test.mjs`:
- `tokenizar('Não foi possível: TypeError em user.ts')` deve igualar `tokenizar('nao foi possivel typeerror em USER.ts')` e conter `'typeerror'` e `'possivel'`.
- `similaridade('erro de cache no build', 'build com erro de cache') ≥ 0.6`; `similaridade('a', '') === 0`.
- `ehTransitorio('npm ERR! code ECONNRESET')` e `ehTransitorio("'node' não é reconhecido como um comando")` → true; `ehTransitorio('AssertionError: expected 3')` → false.

`tests/licoes.test.mjs` (fixture: arquivo com cabeçalho, 2 blocos no formato da spec, uma linha livre do usuário entre eles, CRLF e BOM):
- `lerLicoes` devolve 2 blocos com `positivos`/`negativos`/`ultima` corretos e `evidencia` como lista de links.
- `serializarBloco(lerLicoes(t).blocos[0])` reproduz o bloco no formato da spec 7.2.
- `substituirBloco(t, 'dev-0002', {...b, positivos: 3})`: só a linha 👍 do bloco 2 muda; o resto (inclusive a linha livre, CRLF do bloco 1) é idêntico — compare `t.replace(blocoAntigo, '')` com o equivalente do resultado.
- `substituirBloco(t, 'dev-0001', null)` remove só o bloco 1.
- Bloco sem linha 👍/👎 → `positivos === 0`, `negativos === 0`, não lança.
- `proximoId('dev', [t, '## dev-0007 · x\n'])` → `'dev-0008'`; `proximoId('dev', [])` → `'dev-0001'`.
- `acrescentarBloco('', 'dev', b)` começa com `# Lições — dev\n\n## dev-`.

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/texto.test.mjs tests/licoes.test.mjs` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar** `constantes.mjs`, `texto.mjs`, `licoes.mjs` com as assinaturas acima. `lerLicoes` remove BOM e guarda em `bruto` o texto original do bloco (com o fim de linha original) para que `substituirBloco` troque exatamente esse trecho; `serializarBloco` usa `\n`.

- [ ] **Step 4: Rodar** — `node --test` → todos PASS (inclusive os 75 da Fase 1).

- [ ] **Step 5: Commit** — `git add scripts/lib tests && git commit -m "feat: texto e formato de lições do cérebro"`

---

### Task 2: casos, git e esqueleto do CLI `cerebro`

**Files:**
- Create: `scripts/lib/casos.mjs`, `scripts/lib/git.mjs`, `scripts/cerebro.mjs`
- Test: `tests/casos.test.mjs`, `tests/cerebro.test.mjs`

**Interfaces:**
- Consumes: Task 1; `nabucoHome`, `acharProjeto` (`lib/caminhos.mjs`); `registrar` (`lib/eventos.mjs`); `lerJson` (`lib/json.mjs`).
- Produces (casos): `CAMPOS_CASO = ['sintoma','contexto','hipotese_errada','causa_raiz','correcao','verificacao','sinal_precoce']`; `validarCaso(c) → string[]` (erros; obrigatórios: `papel` ∈ `PAPEIS_CEREBRO`, `sintoma`, `causa_raiz`, `correcao`, `verificacao`; `tags` array de strings; `turnos` inteiro ≥ 0 opcional; `recorrencia_de` id opcional); `gravarCaso(home, c) → caminhoRelativo` (`casos/<papel>/AAAA-MM-<slug do sintoma>.md`, sufixo `-2`, `-3`… se existir); `lerCasos(home, papel?) → Caso[]` (cada um com `arquivo` relativo à home); `formatarCaso(c) → string` (linhas exatas da spec 7.2, com `hipótese errada:`, `causa raiz:`, `sinal precoce:` e a última linha `custo: <turnos> turnos · tags: a, b · papel: p`).
- Produces (git): `commitHome(home, mensagem) → boolean` — `git add -A` + `git commit -q -m` em `home`; sem `.git`, sem git ou falha → aviso em stderr e `false`, nunca lança.
- Produces (CLI): `node scripts/cerebro.mjs <comando>`; erro de uso → exit 2, regra → exit 1, mensagens `nabuco: ...` (mesmo padrão de `tarefa.mjs`). Comandos desta task:
  - `caso-add --de <arq.json>` → grava, evento `caso_criado` (`papel`, `dados: { arquivo, tags, turnos?, recorrencia_de? }`), commit `"caso: <arquivo>"`, imprime o caminho relativo.
  - `casos [--papel P]` → JSON `[{arquivo, papel, sintoma, tags}]`.
  - `similares --de <arq.json>` → JSON `{ similares: [{arquivo, score}], destilar: boolean }`: casos do mesmo papel com `similaridade(sintoma + ' ' + tags)` ≥ 0,4, em ordem decrescente; `destilar` = pelo menos 1 similar (ou seja, ≥ 2 casos contando o novo) ou `turnos ≥ CUSTO_ALTO_TURNOS`.

- [ ] **Step 1: Testes que falham**
  - `casos.test.mjs`: `validarCaso({papel:'dev'})` lista os 4 obrigatórios; `papel:'chefe'` é erro; `gravarCaso` duas vezes com o mesmo sintoma gera `...-slug.md` e `...-slug-2.md`; `lerCasos(home,'dev')` relê `tags` e `turnos`; `formatarCaso` contém a linha `causa raiz: ` e `custo: 3 turnos · tags: cache, build · papel: dev`.
  - `cerebro.test.mjs` (helper `run(args)` com `NABUCO_HOME` temporário, `cwd` em projeto temporário com `.git/`, como `tests/evento.test.mjs`; caminho com espaço `Nova pasta`):
    - `caso-add --de caso.json` → exit 0, arquivo existe, `historico.jsonl` tem `caso_criado` com `papel`.
    - com `git init` na home: após `caso-add`, `git -C home log --oneline` tem 1 commit; sem `.git` na home: exit 0 e stderr menciona git.
    - `caso-add` sem `verificacao` → exit 1, nada gravado; `--de` inexistente ou JSON inválido → exit 2.
    - `similares` com 1 caso parecido gravado → `destilar: true`; com casos diferentes → `destilar: false`; home vazia → `{ similares: [], destilar: false }`, exit 0.
    - comando desconhecido → exit 2.

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/casos.test.mjs tests/cerebro.test.mjs` → FAIL.
- [ ] **Step 3: Implementar** `casos.mjs`, `git.mjs` e `cerebro.mjs` (estrutura `comandos = { ... }` + `ErroUso`/`ErroRegra` igual a `tarefa.mjs`).
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: casos e CLI do cérebro"`

---

### Task 3: comandos de lições

**Files:**
- Modify: `scripts/cerebro.mjs`
- Test: `tests/cerebro.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: helper interno `arquivoLicoes(escopo, papel)` → `~/.nabuco/licoes/<papel>.md` ou `<projeto>/.nabuco/licoes/<papel>.md`; `arquivoMorto(papel)` → `~/.nabuco/licoes/arquivo/<papel>.md`. Toda escrita global termina em `commitHome`. Comandos:
  - `licao-add --de <arq.json>` (campos `papel, titulo, gatilho, expectativa, faca, porque, evidencia: string[], escopo: 'global'|'projeto'`; `evidencia` não vazia) → checa duplicata (Decisões), checa limite de 30 ativas (recusa com exit 1 sugerindo higiene), grava com `👍 0 👎 0 · última: hoje`, evento `licao_criada {id, escopo}`, imprime o id. `--forcar` pula a duplicata.
  - `licao-editar --id ID [--de <arq.json>] [--escopo global|projeto]` → mescla campos do JSON no bloco (delta), ou move de escopo (renumera em colisão), evento `licao_editada {id, campos, id_anterior?}`.
  - `licao-reforcar --id ID --caso <arquivo>` → acrescenta o link à `evidencia`, evento `licao_editada {id, campos:['evidencia']}`.
  - `voto --id ID --util sim|nao` → incrementa 👍 ou 👎, `última` = hoje, evento `licao_usada {id, util: boolean}` com `papel` da lição.
  - `aposentar --id ID --motivo="..."` → remove do ativo, acrescenta ao arquivo morto com `- aposentada: hoje · motivo`, evento `licao_aposentada`.
  - `promover --id ID --regra="<onde>"` → acrescenta `- regra:`, evento `licao_promovida {id, regra}`.
  - `licoes [--papel P] [--todas]` → JSON dos blocos ativos (global + projeto, campo `escopo`); `--todas` inclui promovidas.
  - Id inexistente em qualquer comando → exit 1 `lição "<id>" não encontrada`. A lição é procurada primeiro no projeto, depois no global.

- [ ] **Step 1: Testes que falham** (em `cerebro.test.mjs`):
  - `licao-add` imprime `dev-0001`; o arquivo global tem cabeçalho e bloco; evento `licao_criada`.
  - segunda `licao-add` quase igual → exit 1 citando `dev-0001`; com `--forcar` → `dev-0002`.
  - 30 lições ativas → a 31ª é recusada (exit 1, mensagem menciona higiene); promovidas não contam.
  - `voto --id dev-0001 --util sim` duas vezes e `nao` uma → bloco com `👍 2  👎 1`; demais bytes do arquivo iguais aos de antes (delta).
  - `aposentar` → some de `licoes`, aparece no arquivo morto com `aposentada:`.
  - `promover` → `licoes` não lista; `licoes --todas` lista com `regra`.
  - lição de escopo `projeto` vai para `<proj>/.nabuco/licoes/dev.md` e **não** gera commit na home; `licao-editar --escopo global` quando já existe `dev-0001` global → nova id `dev-0002` e `id_anterior: 'dev-0001'` no evento (Review Focus 5).
  - `voto --id dev-9999` → exit 1.

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/cerebro.test.mjs` → FAIL nos novos.
- [ ] **Step 3: Implementar** os comandos em `cerebro.mjs`.
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: comandos de lições (criar, editar, votar, aposentar, promover)"`

---

### Task 4: busca

**Files:**
- Create: `scripts/lib/busca.mjs`
- Modify: `scripts/cerebro.mjs`
- Test: `tests/busca.test.mjs`, `tests/cerebro.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`tokenizar`, `Bloco`).
- Produces: `ranquear(blocos: (Bloco & {escopo})[], { texto: string, arquivos: string[], hoje: string }) → {bloco, score}[]`, no máximo `MAX_BUSCA`, só `score` de correspondência > 0, sem promovidas. Pontuação (decisão do plano):
  `2 × |tokens(gatilho) ∩ consulta| + 1 × |tokens(título + faça) ∩ consulta| + 2 × (arquivos citados no gatilho/contexto que batem com algum de --arquivos, por nome de arquivo)` = correspondência; `score = correspondência + 0,5 × (👍 − 👎) + (1 se última ≤ 30 dias) + (0,5 se escopo projeto)`. Desempate: id menor.
- CLI: `buscar --papel P --texto="..." [--arquivos="a.ts,b.ts"]` → imprime Markdown pronto para colar na mensagem ao escritor: para cada lição, o bloco completo + `caso: <link>` (primeiro link da evidência); sem resultado → `(nenhuma lição relevante)`. `--json` imprime `[{id, score}]`.

- [ ] **Step 1: Testes que falham**
  - `busca.test.mjs`: com 5 lições de fixture, consulta `"TypeError: cannot read properties of undefined (reading 'map')"` traz primeiro a lição cujo gatilho fala de `undefined`/`map`; nunca mais de 3; lição promovida nunca aparece; empate de correspondência é decidido por 👍−👎; consulta sem tokens úteis → `[]`; acentos/caixa não mudam o resultado (Review Focus 4).
  - `cerebro.test.mjs`: `buscar` com home vazia → exit 0 e `(nenhuma lição relevante)`; lição de projeto e global relevantes → ambas aparecem, projeto primeiro em empate.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `busca.mjs` e o comando.
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: busca de lições por correspondência e votos"`

---

### Task 5: sinais da retrospectiva e higiene

**Files:**
- Create: `scripts/lib/sinais.mjs`
- Modify: `scripts/cerebro.mjs`, `scripts/tarefa.mjs` (comando `criterio`)
- Test: `tests/sinais.test.mjs`, `tests/tarefa.test.mjs`, `tests/cerebro.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 3; `dirTarefas`, `lerAtiva`.
- Produces:
  - `tarefa.mjs criterio --status falhou` passa a gravar `dados.evidencia` (primeiros 500 caracteres) no evento `criterio`.
  - `coletarSinais(dirTarefa) → { tarefa, tipo, tamanho, papeis: string[], criterios_falhos: [{id, evidencia}], rodadas: number, achados: [{papel, severidade, resumo}], gate_bloqueios: number, correcoes_usuario: [{papel, dados}], licoes_usadas: [{id, util}], transitorios: [{id, evidencia}], log: string[] }` — lê `estado.json`, `eventos.jsonl` (linhas inválidas ignoradas) e a seção `## Log` do `progresso.md`; falha cuja evidência `ehTransitorio` vai para `transitorios`, não para `criterios_falhos`; `papeis` = papéis distintos dos eventos.
  - `propostasHigiene(blocos, hoje) → [{id, papel, motivo: 'excesso'|'sem_uso'|'ruim'|'promover', detalhe}]` — `excesso`: papel com > 30 ativas (uma entrada por papel, `id: null`); `sem_uso`: `última` há mais de 90 dias; `ruim`: 👎 > 👍; `promover`: 👍 ≥ 5 e 👎 = 0 e sem regra.
  - CLI: `sinais [--tarefa NOME]` (padrão: tarefa ativa; senão a pasta mais recente em `.nabuco/tarefas/`; nenhuma → exit 1) imprime o JSON; `higiene [--papel P]` imprime o JSON das propostas.

- [ ] **Step 1: Testes que falham**
  - `tarefa.test.mjs`: `criterio --status falhou --evidencia="X"` → evento `criterio` com `dados.evidencia === 'X'`.
  - `sinais.test.mjs` (pasta de tarefa de fixture): falha `AssertionError` em `criterios_falhos`, falha `ECONNRESET` em `transitorios`; 2 `rodada_correcao` → `rodadas: 2`; linha corrompida no `eventos.jsonl` não quebra; `log` traz as linhas da seção Log.
  - higiene: 31 lições → uma proposta `excesso`; `última` de 2026-01-01 com hoje 2026-10-17 → `sem_uso`; 👍1 👎2 → `ruim`; 👍5 👎0 → `promover`; 👍5 👎0 com regra → nada.
  - `cerebro.test.mjs`: `sinais` sem nenhuma tarefa → exit 1; `higiene` com home vazia → `[]`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: sinais da retrospectiva e higiene de lições"`

---

### Task 6: métricas de senioridade

**Files:**
- Create: `scripts/lib/metricas.mjs`
- Modify: `scripts/cerebro.mjs`
- Test: `tests/metricas.test.mjs`, `tests/cerebro.test.mjs`

**Interfaces:**
- Consumes: constantes da Task 1; eventos da spec 6.
- Produces: `calcularMetricas(eventos: object[]) → { [papel]: Metricas }`, com `Metricas = { amostra, aceitacao_1a, tentativas_ate_verde, recorrencia, turnos_ate_causa, escapes, pct_util, promocoes, score, nivel, provisorio }`. Definições (decisão do plano; tarefa = chave `projeto + '/' + tarefa`; janela = últimas `JANELA_TAREFAS` tarefas com `tarefa_fechada`, em ordem de `ts`):
  - participou: papel aparece em qualquer evento da tarefa. `amostra` = tarefas da janela em que participou.
  - `aceitacao_1a` (só `ESCRITORES`): fração das tarefas em que foi escritor (`agente_inicio` com o papel) sem `rodada_correcao` com esse papel; `null` para checadores.
  - `tentativas_ate_verde` (só escritores): média, por tarefa, de 1 + eventos `criterio` com `status: 'falhou'`.
  - `recorrencia`: `caso_criado` do papel com `dados.recorrencia_de` ÷ `caso_criado` do papel (todos os tempos); `null` sem casos.
  - `turnos_ate_causa`: média de `dados.turnos` dos `caso_criado` do papel; `null` sem dado.
  - `escapes`: nº de `correcao_usuario` do papel com `dados.apos_pronto === true` na janela.
  - `pct_util`: `licao_usada` útil ÷ total do papel; `null` sem votos. `promocoes`: nº de `licao_promovida` do papel.
  - `score`: média dos indicadores disponíveis entre `aceitacao_1a`, `1 − recorrencia`, `1 − min(1, escapes/amostra)`, `pct_util`; `null` se nenhum. `nivel`: `<0,5` Júnior, `<0,7` Pleno, `<0,85` Sênior, senão Especialista; `null` sem score. `provisorio = amostra < AMOSTRA_MINIMA`.
- `lerHistorico(home) → object[]` (ignora linhas inválidas e eventos sem `tipo`).
- CLI: `metricas [--papel P] [--json]` — sem `--json`, tabela legível em pt-BR: papel, nível (com "provisório"), amostra e cada indicador (`—` quando `null`).

- [ ] **Step 1: Testes que falham**
  - Fixture de eventos: dev escritor em 4 tarefas fechadas, 1 com `rodada_correcao` dev → `aceitacao_1a === 0.75`; revisor → `aceitacao_1a === null`.
  - 2 casos dev, 1 com `recorrencia_de` → `recorrencia === 0.5`.
  - nível **cai**: o mesmo dev com 30 tarefas boas e depois 30 ruins tem nível menor que só com as boas (janela).
  - 30 tarefas fechadas e nenhuma participação do designer → `amostra 0`, `nivel null`; amostra 4 → `provisorio: true`.
  - linhas inválidas, eventos sem `projeto`/`dados` não quebram (Review Focus 3).
  - volume não sobe nível: dev com 10 tarefas perfeitas e dev com 30 perfeitas → mesmo `score`.
  - CLI: home vazia → exit 0 e texto informando que não há dados.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: métricas de senioridade por funcionário"`

---

### Task 7: skills `retro` e `licoes`, integração com `tarefa` e papéis

**Files:**
- Create: `skills/retro/SKILL.md`, `skills/licoes/SKILL.md`
- Modify: `skills/tarefa/SKILL.md`, `papeis/*.md` (9), `agents/*` e `codex-agents/*` (via `npm run build`), `README.md`, `package.json` + `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json` (versão `0.2.0`)
- Test: `tests/skills.test.mjs`

**Interfaces:**
- Consumes: todos os comandos do CLI (Tasks 2–6). Nas skills, `C` = `node "$NABUCO/scripts/cerebro.mjs"` (mesma convenção de `T`/`E`).

Conteúdo obrigatório (o que os testes cobram):
- **`tarefa`**:
  - §1: `C buscar --papel gerente --texto="<pedido>"` e aplicar as lições do Gerente.
  - §4: antes de delegar, `C buscar --papel <escritor> --texto="<sintoma ou pedido>" --arquivos="<arquivos envolvidos>"` e colar o resultado na mensagem sob "Lições do time"; depois da entrega, para cada lição em "lições usadas", `C voto --id <id> --util sim|nao`.
  - Novo item em "Sempre": quando o usuário apontar um problema depois de a tarefa estar pronta, `E correcao_usuario --papel <papel> --dados='{"apos_pronto":true,"resumo":"..."}'`.
  - §7: depois do resumo, oferecer a retrospectiva (`/nabuco:retro` ou `$retro`); em tarefa `trivial` sem falhas, só se o usuário quiser.
- **`retro`** (spec 7.4): 1) `C sinais [--tarefa]`; descartar `transitorios`; 2) para cada sinal com causa conhecida, escrever o rascunho do caso em `<pasta da tarefa>/retro/caso-N.json`, rodar `C similares --de`; 3) se `destilar`, propor lição (0–3 por funcionário envolvido, inclui gerente) em `licao-N.json`; duplicata (exit 1 do `licao-add`) → propor `licao-reforcar`; contradição → mostrar as duas lições; 4) mostrar **item a item** e aplicar só o aprovado (aprovar / editar / mudar escopo / descartar); 5) aplicar via `C caso-add`, `C licao-add`, `C licao-reforcar`; 6) rodar `C higiene` e propor (também item a item) fusão/aposentadoria/promoção; promoção aprovada vira nova tarefa para o time criar a regra e só depois `C promover`. Nunca grava nada sem aprovação.
- **`licoes`**: listar (`C licoes [--papel]`), ver métricas (`C metricas`), editar/aposentar/promover sob pedido do usuário (sempre via CLI, nunca editando o `.md` à mão), rodar higiene.
- **Papéis**: no bloco "Entrega" de cada um dos 9, novo item entre `evidência` e `bloqueios`: `- **lições usadas:** id de cada lição recebida que você aplicou ou que não serviu, com 👍 (ajudou) ou 👎 (atrapalhou/irrelevante), ou "nenhuma"`. No `debugger.md`, passo 4 ganha: "se nenhuma lição recebida explica o sintoma, rode `node \"$NABUCO/scripts/cerebro.mjs\" buscar --papel debugger --texto=\"<mensagem de erro>\"`" (com a definição de `$NABUCO` igual à da skill).
- **README**: seção "Cérebro" de ≤ 15 linhas: onde ficam casos/lições, `/nabuco:retro`, `/nabuco:licoes`, que nada é gravado sem aprovação.

- [ ] **Step 1: Testes que falham** (em `skills.test.mjs`):
  - `skills da Fase 2 existem`: `retro`, `licoes` (o loop de frontmatter já valida os campos).
  - `tarefa`: contém `buscar --papel gerente`, `buscar --papel <escritor>`, `voto --id`, `correcao_usuario`, `apos_pronto`, `/nabuco:retro`, `$retro`.
  - `retro`: contém `sinais`, `transitorios`, `similares --de`, `caso-add`, `licao-add`, `licao-reforcar`, `higiene`, `item a item`, e regex `/nunca grav/i`.
  - `licoes`: contém `licoes`, `metricas`, `aposentar`, `promover`, `higiene`.
  - para cada arquivo em `papeis/`: contém `**lições usadas:**`; `debugger.md` contém `cerebro.mjs" buscar`; todos ≤ 80 linhas.
  - `build:check` limpo (teste existente em `build.test.mjs` cobre os gerados).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/skills.test.mjs`.
- [ ] **Step 3: Escrever as skills, ajustar `tarefa`, papéis, README, versões; rodar `npm run build`.**
- [ ] **Step 4: Rodar** — `node --test` e `npm run build:check` → tudo PASS / sem diferenças.
- [ ] **Step 5: Commit** — `git commit -m "feat: skills retro e licoes; time passa a usar e votar lições"`

---

### Task 8: validação ponta a ponta (smoke) e registro

**Files:**
- Create: `docs/validacao-fase2.md`

Sem código novo. Executado no Claude Code, num repositório de teste com um bug conhecido (ex.: pasta temporária com `npm init -y`, uma função com off-by-one e um teste que falha), com o plugin atualizado (`/plugin update nabuco` após o push — **push só com ok do usuário**).

- [ ] **Step 1:** `/nabuco:tarefa corrija o teste que falha` → tarefa `media`/`bug`; confirmar no `progresso.md`/mensagem ao debugger a seção "Lições do time" (vazia na 1ª vez).
- [ ] **Step 2:** concluir a tarefa; aceitar a retrospectiva; conferir que nada foi gravado antes da aprovação, que o caso aprovado está em `~/.nabuco/casos/debugger/` e há commit em `git -C ~/.nabuco log`.
- [ ] **Step 3:** repetir com um bug parecido; conferir `similares` → `destilar: true`, aprovar a lição, e numa 3ª tarefa parecida conferir que `buscar` a injeta e que o voto aparece (`licao_usada` no `historico.jsonl`, 👍 no bloco).
- [ ] **Step 4:** `/nabuco:licoes` mostra a lição e `metricas` mostra o debugger como "provisório".
- [ ] **Step 5:** registrar cada passo com ✅/❌ e observações em `docs/validacao-fase2.md`; commit `docs: resultados da validação da Fase 2 (Claude Code)`. A parte Codex segue junto da pendência da Fase 1.
