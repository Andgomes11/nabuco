# nabuco — Fase 3 (Painel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/nabuco:painel` abre no navegador um painel Matrix local, ao vivo, com um monitor por funcionário (estado real de atividade), avatar pelo nível e um dossiê clicável cujos números levam aos eventos de origem.

**Architecture:** Toda a derivação de dados é pura e testada em Node (`scripts/lib/painel-estado.mjs`, `scripts/lib/dossie.mjs`, extensão de `metricas.mjs` com fontes). Um servidor `node:http` sem dependências (`scripts/painel/servidor.mjs`) serve arquivos estáticos e uma API JSON + SSE, só em 127.0.0.1 e só com a chave da URL. O front-end é HTML/CSS/JS puro em `scripts/painel/publico/`, com a lógica de apresentação num módulo ES (`modelo.mjs`) importado tanto pelo navegador quanto pelos testes.

**Tech Stack:** Node.js ≥ 20 (`node:http`, `node:crypto`, `node:fs`), HTML5 Canvas, CSS, ES modules no navegador, EventSource (SSE).

**Spec:** `docs/superpowers/specs/2026-10-16-nabuco-design.md` (seção 8; métricas da 7.5; eventos da 6)

## Global Constraints

- Tudo da Fase 1/2 continua valendo: Node ≥ 20, zero dependências (nem CDN: o painel funciona offline), ESM, `node:path`, Windows com espaço/acentos no caminho, texto em pt-BR, commits `tipo: descrição` sem `Co-Authored-By`.
- Servidor só escuta em `127.0.0.1`, porta livre (`0`) salvo `--porta`; toda rota exige a chave (`?k=` ou cabeçalho `x-nabuco-chave`), comparada em tempo constante; chave = 32 hex de `crypto.randomBytes(16)`.
- O painel é **somente leitura**: nenhuma rota grava em `~/.nabuco` nem no projeto; só `GET`.
- Regra do spec: **todo elemento visual corresponde a um dado** — nada de animação decorativa sem dado, nada de XP por volume, nada de ranking entre funcionários.
- Avatares: `assets/avatares/<papel>-<n>.jpg`, `n` = 1 Júnior · 2 Pleno · 3 Sênior · 4 Especialista (já commitáveis: 38 arquivos, 512px). Imagem ausente → silhueta SVG.
- `prefers-reduced-motion: reduce` → chuva de código estática (sem animação); contraste de texto ≥ 4.5:1; monitores e números clicáveis acessíveis por teclado.

## Review Focus

1. **Sem dados nenhum** (home vazia, projeto sem `.nabuco`, sem tarefa ativa): o painel abre, mostra 10 monitores ociosos, cabeçalho "nenhuma tarefa ativa", dossiês com "—" e sem exceção no console. (testes nas Tasks 1, 2 e 3)
2. **Requisição de outra origem / sem chave / Host diferente de `127.0.0.1:<porta>` ou `localhost:<porta>`** (DNS rebinding): 403, sem corpo de dados. (teste na Task 3)
3. **Caminho malicioso** (`/avatares/../../x`, `%2e%2e`, nome fora da lista): 404, nunca lê fora das pastas permitidas. (teste na Task 3)
4. **`historico.jsonl` crescendo enquanto o painel está aberto** (hooks gravando em rajada, linha parcial no fim): o SSE manda um estado novo em até ~1 s, sem quebrar com a linha incompleta. (teste na Task 3)
5. **Agente que iniciou e nunca terminou** (sessão morta sem `agente_fim`): não fica "trabalhando" para sempre — expira em 30 min sem eventos. (teste na Task 1)

---

## Estrutura de arquivos (Fase 3)

```
scripts/
├── lib/
│   ├── painel-estado.mjs      # estado ao vivo: tarefa, gate, monitores (estado, atividade, nível, avatar)
│   ├── dossie.mjs             # atributos com tendência, diário, lições, talentos, equipamento
│   └── metricas.mjs           # (modificado) fontes de cada indicador
└── painel/
    ├── servidor.mjs           # CLI + node:http + SSE
    └── publico/
        ├── index.html  estilo.css  app.js
        └── modelo.mjs         # funções puras de apresentação (navegador e testes)
assets/avatares/*.jpg          # 38 imagens (já convertidas)
skills/painel/SKILL.md
tests/painel-estado.test.mjs  dossie.test.mjs  painel-servidor.test.mjs  painel-modelo.test.mjs
```

## Decisões que o spec deixou abertas (valem para todas as tasks)

- **Funcionários exibidos:** `gerente` + os 9 de `PAPEIS`, nessa ordem; nome de exibição do frontmatter `nome` de `papeis/<papel>.md` (`gerente` → "Gerente").
- **Estado do monitor** (calculado em `agora`):
  - `trabalhando`: há `agente_inicio` do papel sem `agente_fim` com o mesmo `dados.agent_id` **e** algum evento do papel nos últimos 30 min. Para o `gerente`: tarefa ativa em `planejando`, `executando` ou `checando` e algum evento da tarefa nos últimos 30 min.
  - `aguardando` (vermelho/parado): só o `gerente`, quando a tarefa ativa está em `aguardando_usuario` ou `aguardando_aprovacao` (é o Gerente quem espera o usuário e quem o gate bloqueia).
  - `ocioso` (apagado): o resto.
- **Atividade** (velocidade da chuva, 0..1): `min(1, eventos do papel nos últimos 5 min / 10)`; `ocioso` → 0; `aguardando` → 0 (parado).
- **Nível e avatar:** do `calcularMetricas` (Fase 2). `nivel` → `n` (Júnior 1 … Especialista 4); `nivel` nulo → imagem `n=1` em tons de cinza com rótulo "sem avaliação"; `provisorio` → selo "provisório".
- **Atributos do dossiê** (0..1, `null` sem dado):
  - **Faro** (achar a causa): `turnos_ate_causa` → `max(0, min(1, 1 − (t − 1) / 9))`.
  - **Precisão** (acertar de primeira): `aceitacao_1a`.
  - **Confiabilidade** (não deixar escapar nem repetir): média dos disponíveis entre `1 − recorrencia` e `1 − min(1, escapes/amostra)` (este só quando `escapes` não é nulo e `amostra > 0`).
  - **Tendência:** compara o atributo calculado com todos os eventos contra o calculado sem os eventos das 10 tarefas fechadas mais recentes; `↑` se subiu ≥ 0,05, `↓` se caiu ≥ 0,05, `→` caso contrário, `null` se algum lado é nulo.
- **Fontes (clique no número):** `calcularMetricas(eventos, { fontes: true })` devolve, por papel, `fontes: { [indicador]: number[] }` com os **índices** em `eventos` que alimentaram cada indicador. O servidor lê o histórico e devolve os eventos desses índices (o histórico é append-only, então o índice é estável enquanto o painel está aberto; o front sempre pede com a versão do estado que mostrou e o servidor responde 409 se o histórico encolheu).
- **Diário de batalha:** últimos 20 casos do papel (`lerCasos`), mais recentes primeiro: data (do nome do arquivo), sintoma, causa raiz, arquivo.
- **Programas carregados:** lições ativas (global + projeto) com 👍/👎; destaque "ruim" quando 👎 > 👍. **Talentos:** lições promovidas (com `regra`).
- **Equipamento:** `modelos.json` → Claude e Codex (`model ?? '(sessão)'`/`effort`); `gerente` → "sessão".
- **Atualização ao vivo:** o servidor observa `historico.jsonl` e a pasta da tarefa ativa com `fs.watch` + verificação de `mtime`/tamanho a cada 1 s (fallback, `fs.watch` falha em alguns sistemas); qualquer mudança → recalcula e manda `event: estado` com o estado completo (debounce 250 ms). Heartbeat `: ping` a cada 15 s.
- **Abrir o navegador:** Windows `cmd /c start "" "<url>"`, macOS `open`, Linux `xdg-open`; `--sem-abrir` desliga. Falha ao abrir não derruba o servidor (imprime a URL).

---

### Task 1: estado ao vivo (`painel-estado.mjs`)

**Files:**
- Create: `scripts/lib/painel-estado.mjs`
- Test: `tests/painel-estado.test.mjs`

**Interfaces:**
- Consumes: `calcularMetricas`, `nivelDe` (`lib/metricas.mjs`); `PAPEIS` (`lib/constantes.mjs`); `pendencias` (`lib/criterios.mjs`).
- Produces:
  - `FUNCIONARIOS = ['gerente', ...PAPEIS]`; `NIVEL_NUM = { 'Júnior': 1, 'Pleno': 2, 'Sênior': 3, 'Especialista': 4 }`.
  - `montarEstado({ eventos, tarefa, nomes, avatares, agora }) → Estado`, onde `eventos` = histórico global (array), `tarefa` = `null | { nome, estado, criterios, eventos }` (conteúdo de `estado.json`, `criterios.json`, `eventos.jsonl` da tarefa ativa), `nomes` = `{ papel: nome }`, `avatares` = `Set` de nomes de arquivo existentes em `assets/avatares/`, `agora` = ms.
  - `Estado = { versao: eventos.length, projeto, tarefa: null | { nome, slug, fase, tamanho, tipo, gate: { passou, total, pendencias } }, funcionarios: [{ papel, nome, estado: 'trabalhando'|'aguardando'|'ocioso', atividade, nivel, nivelNum, provisorio, avatar: string|null, cinza: boolean }] }`. `avatar` = `"<papel>-<n>.jpg"` se estiver em `avatares`, senão `null` (front usa silhueta); `n` = `nivelNum ?? 1`; `cinza = nivel === null`.

- [ ] **Step 1: Testes que falham** (`agora` fixo; eventos de fixture):
  - sem eventos e `tarefa: null` → 10 funcionários, todos `ocioso`, `atividade 0`, `nivel null`, `cinza true`, `tarefa null`.
  - `agente_inicio` do dev (agent_id a1) há 2 min, sem fim → dev `trabalhando`; com `agente_fim` a1 → `ocioso`; início há 31 min sem nenhum evento depois → `ocioso` (Review Focus 5).
  - 5 eventos do dev nos últimos 5 min → `atividade 0.5`; 15 → `1`.
  - tarefa ativa em `aguardando_usuario` → gerente `aguardando`, `atividade 0`; em `executando` com evento há 1 min → gerente `trabalhando`.
  - gate: 2 critérios, 1 `passou` com evidência → `{ passou: 1, total: 2, pendencias: [...] }`.
  - nível: dev com métricas de Especialista (fixture como em `tests/metricas.test.mjs`) → `nivelNum 4`, `avatar 'dev-4.jpg'`; `revisor-4.jpg` ausente do Set e revisor Especialista → `avatar null`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/painel-estado.test.mjs`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `node --test` → tudo PASS.
- [ ] **Step 5: Commit** — `feat: estado ao vivo do painel`

---

### Task 2: dossiê e fontes das métricas

**Files:**
- Modify: `scripts/lib/metricas.mjs`
- Create: `scripts/lib/dossie.mjs`
- Test: `tests/metricas.test.mjs`, `tests/dossie.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`FUNCIONARIOS`); `lerCasos` (`lib/casos.mjs`); `blocosDe`, `ativas` (`lib/repositorio-licoes.mjs`); `configDe` (`lib/modelos.mjs`).
- Produces:
  - `calcularMetricas(eventos, { fontes: true })` → cada entrada ganha `fontes: { amostra, aceitacao_1a, tentativas_ate_verde, recorrencia, turnos_ate_causa, escapes, pct_util, promocoes }`, cada um `number[]` de índices em `eventos` (para indicadores de janela: os eventos do papel nas tarefas da janela que entraram na conta; para `aceitacao_1a`: os `agente_inicio` e `rodada_correcao` considerados). Sem a opção, a saída é idêntica à atual (testes da Fase 2 intactos).
  - `atributos(m) → { faro, precisao, confiabilidade }` (fórmulas das Decisões).
  - `tendencia(eventos, papel) → { faro, precisao, confiabilidade }` com `'↑'|'↓'|'→'|null`.
  - `montarDossie({ papel, eventos, home, projeto, modelos, nome }) → { papel, nome, nivel, nivelNum, provisorio, amostra, metricas, atributos, tendencia, fontes, equipamento: { claude, codex }, diario: [{ data, sintoma, causa_raiz, arquivo }], licoes: [{ id, titulo, positivos, negativos, ruim, escopo }], talentos: [{ id, titulo, regra }] }`.
- [ ] **Step 1: Testes que falham**
  - `metricas.test.mjs`: com `{ fontes: true }`, `fontes.aceitacao_1a` do dev contém exatamente os índices dos `agente_inicio`/`rodada_correcao` usados; `fontes.recorrencia` = índices dos `caso_criado` do papel; sem opção → objeto sem `fontes` (deepEqual com a saída antiga).
  - `dossie.test.mjs`: `atributos({ turnos_ate_causa: 1, aceitacao_1a: 0.75, recorrencia: 0.5, escapes: 0, amostra: 4 })` → `{ faro: 1, precisao: 0.75, confiabilidade: 0.75 }`; `turnos 10` → faro 0; tudo nulo → tudo `null`.
  - tendência: 10 tarefas ruins seguidas de 10 boas → `precisao '↑'`; poucas tarefas (sem "antes") → `null`.
  - `montarDossie` com home de teste (2 casos, 3 lições — uma com 👎>👍, uma promovida): diário mais recente primeiro; `licoes` tem 2 com `ruim` certo; `talentos` 1; equipamento do dev `{ claude: '(sessão)/high', codex: '(sessão)/high' }`; gerente → `'sessão'`.
  - home vazia → dossiê com listas vazias e atributos nulos, sem exceção (Review Focus 1).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `node --test` → PASS.
- [ ] **Step 5: Commit** — `feat: dossiê dos funcionários e fontes das métricas`

---

### Task 3: servidor (`scripts/painel/servidor.mjs`)

**Files:**
- Create: `scripts/painel/servidor.mjs`, placeholder mínimo `scripts/painel/publico/index.html` (substituído na Task 4)
- Test: `tests/painel-servidor.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2; `nabucoHome`, `acharProjeto`, `lerAtiva`; `lerHistorico`; `carregarModelos`.
- Produces:
  - CLI: `node scripts/painel/servidor.mjs [--porta N] [--sem-abrir]` — imprime em stdout uma linha `nabuco painel: http://127.0.0.1:<porta>/?k=<chave>` e fica no ar; `SIGINT`/`SIGTERM` → fecha e sai 0.
  - Export para testes: `iniciar({ porta = 0, raiz, projeto, home, abrir = false }) → Promise<{ url, porta, chave, fechar(): Promise<void> }>`.
  - Rotas (todas `GET`, todas com chave; outro método → 405):
    - `/` → `publico/index.html`; `/estilo.css`, `/app.js`, `/modelo.mjs` → arquivos de `publico/` (lista fixa, com `Content-Type` certo).
    - `/avatares/<papel>-<n>.jpg` → só nomes que casam `^[a-z]+-[1-4]\.jpg$` **e** existem em `assets/avatares/`; senão 404.
    - `/api/estado` → `Estado` (Task 1) em JSON.
    - `/api/dossie/<papel>` → dossiê (Task 2); papel fora de `FUNCIONARIOS` → 404.
    - `/api/fontes/<papel>/<indicador>?v=<versao>` → `{ eventos: [...] }` dos índices; `v` maior que o tamanho atual do histórico → 409.
    - `/api/eventos` → SSE (`text/event-stream`, `cache-control: no-cache`): `event: estado` com o estado logo ao conectar e a cada mudança (Decisões); `: ping` a cada 15 s.
  - Segurança: `Host` deve ser `127.0.0.1:<porta>` ou `localhost:<porta>` (senão 403); chave ausente/errada → 403 (comparação com `crypto.timingSafeEqual` sobre buffers de mesmo tamanho); respostas com `x-content-type-options: nosniff` e `content-security-policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'`.
  - A chave chega ao front pela URL; `app.js` a repassa em `?k=` nas chamadas (sem cookie).
- [ ] **Step 1: Testes que falham** (`iniciar` com `raiz` = plugin, `home`/`projeto` temporários com espaço no caminho; `fetch` nativo):
  - sem chave, chave errada → 403; com chave → `/` 200 `text/html`; `POST /api/estado` → 405.
  - `Host: evil.com` com chave → 403 (Review Focus 2) — use `http.request` para mandar o Host.
  - `/avatares/dev-1.jpg` → 200 `image/jpeg`; `/avatares/..%2F..%2Fpackage.json`, `/avatares/../x`, `/avatares/dev-9.jpg`, `/../package.json` → 404 (Review Focus 3).
  - `/api/estado` com home vazia → 10 funcionários ociosos, `tarefa: null` (Review Focus 1).
  - `/api/dossie/chefe` → 404; `/api/dossie/dev` → 200 com `diario: []`.
  - SSE: conectar, receber o 1º `estado`; anexar ao `historico.jsonl` um `agente_inicio` do dev **e** uma linha parcial sem `\n`; em até 2 s chega um `estado` com dev `trabalhando` (Review Focus 4).
  - `fontes` com `v` > tamanho → 409.
  - `fechar()` encerra conexões SSE abertas (o teste termina sem handle pendurado).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `node --test` → PASS (sem processos pendurados).
- [ ] **Step 5: Commit** — `feat: servidor local do painel com chave e SSE`

---

### Task 4: front-end do painel

**Files:**
- Create: `scripts/painel/publico/index.html`, `estilo.css`, `app.js`, `modelo.mjs`
- Test: `tests/painel-modelo.test.mjs`

**Interfaces:**
- Consumes: rotas da Task 3; formatos `Estado` (Task 1) e dossiê (Task 2).
- Produces (`modelo.mjs`, ES module puro, sem DOM):
  - `velocidadeChuva(f) → number` (colunas/s): `ocioso` 0, `aguardando` 0, `trabalhando` `2 + 18 × atividade`.
  - `corDoEstado(estado) → 'verde'|'vermelho'|'apagado'`.
  - `rotuloNivel(f) → string` (`'Sênior'`, `'Sênior · provisório'`, `'sem avaliação'`).
  - `formatarAtributo(v) → string` (`null` → `'—'`, senão porcentagem inteira) e `seta(t)` (`'↑'|'↓'|'→'|''`).
  - `urlAvatar(f, chave) → string|null` (`/avatares/<arquivo>?k=<chave>` ou `null`).
- Layout e comportamento (a skill `design-web` do plugin guia direção estética e autocrítica; tokens de cor no `:root`):
  - Cabeçalho: projeto, tarefa (`nome · fase`), gate `passou/total` com as pendências em tooltip/lista; "nenhuma tarefa ativa" quando nulo.
  - Grade responsiva de 10 monitores (5×2 em tela larga, 2 colunas no celular). Cada monitor: `<button>` com canvas de chuva (velocidade = `velocidadeChuva`), avatar sobreposto (silhueta SVG inline quando `avatar` é `null`; filtro cinza quando `cinza`), nome, `rotuloNivel`, estado em texto (não só cor). Estado `aguardando`: tom vermelho e chuva congelada; `ocioso`: apagado.
  - Dossiê (painel lateral/modal acessível, fecha com Esc): nível ("clearance") + amostra, equipamento, os 3 atributos com barra + `seta`, diário, programas carregados (ruins destacados), talentos. Cada número de métrica/atributo é um botão que busca `/api/fontes/...` e lista os eventos de origem (ts, tipo, tarefa).
  - SSE com reconexão (EventSource já reconecta; mostrar "desconectado" no cabeçalho enquanto offline).
  - `prefers-reduced-motion` → chuva desenhada uma vez, sem animação. Sem nenhuma requisição externa.
- [ ] **Step 1: Testes que falham** (`painel-modelo.test.mjs` importa `../scripts/painel/publico/modelo.mjs`): os valores acima para cada função (ex.: `velocidadeChuva({estado:'trabalhando', atividade:0.5}) === 11`; `rotuloNivel({nivel:null}) === 'sem avaliação'`; `formatarAtributo(0.756) === '76%'`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `modelo.mjs`, depois `index.html`/`estilo.css`/`app.js`.
- [ ] **Step 4: Rodar** — `node --test` → PASS. Subir `node scripts/painel/servidor.mjs --sem-abrir` com `NABUCO_HOME` de teste com dados (casos, lições, eventos de 3 tarefas), abrir no navegador (chrome-devtools MCP), tirar screenshot em 1440px e 390px, checar console sem erros e contraste; corrigir o que a autocrítica apontar.
- [ ] **Step 5: Commit** — `feat: front-end do painel Matrix`

---

### Task 5: skill, avatares, empacotamento

**Files:**
- Create: `skills/painel/SKILL.md`; add `assets/avatares/*.jpg` (38 arquivos já gerados)
- Modify: `docs/avatares-prompts.md` (extensão `.jpg` 512px e como converter), `README.md`, `package.json` + manifestos (`0.3.0`), `tests/skills.test.mjs`, `tests/pacote.test.mjs`

**Interfaces:**
- Consumes: CLI da Task 3.
- Skill `painel` (pt-BR, curta): `NABUCO` como nas outras skills; rodar `node "$NABUCO/scripts/painel/servidor.mjs"` **em segundo plano** (Claude Code: Bash com `run_in_background`; Codex: comando em background do shell) a partir da raiz do projeto; mostrar a URL impressa ao usuário; dizer que é só leitura, local e que fecha encerrando o processo; se a porta já estiver em uso com `--porta`, tentar sem `--porta`.
- [ ] **Step 1: Testes que falham**
  - `skills.test.mjs`: skill `painel` existe (frontmatter validado pelo loop existente) e contém `servidor.mjs`, `segundo plano`, `127.0.0.1`.
  - `pacote.test.mjs`: todo arquivo em `assets/avatares/` casa `^(gerente|arquiteto|debugger|designer|dev|devops|docs|revisor|seguranca|tester)-[1-4]\.jpg$` e tem ≤ 200 KB; versões `0.3.0` iguais.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Escrever a skill, ajustar docs, README (seção "Painel" ≤ 10 linhas, com nota de que faltam `revisor-4` e `seguranca-4` e a silhueta cobre), versões; adicionar os JPGs.**
- [ ] **Step 4: Rodar** — `node --test` e `npm run build:check` → PASS.
- [ ] **Step 5: Commit** — `feat: skill painel e avatares do time`

---

### Task 6: validação ponta a ponta e registro

**Files:**
- Create: `docs/validacao-fase3.md`

Sem código novo. Após push e `claude plugin update nabuco@nabuco` (com ok do usuário):
- [ ] **Step 1:** `/nabuco:painel` no repositório de teste da Fase 2 (com `NABUCO_HOME` de teste): URL impressa, navegador abre, 10 monitores, debugger com avatar de nível e selo provisório, revisor "sem avaliação" em cinza.
- [ ] **Step 2:** com o painel aberto, rodar uma tarefa curta (`/nabuco:tarefa`) e ver ao vivo: gerente trabalhando → aguardando (aprovação) → trabalhando; escritor trabalhando durante o subagente; gate atualizando.
- [ ] **Step 3:** abrir o dossiê do debugger: atributos, diário com os 2–3 casos, lição com 👍; clicar num número e ver os eventos de origem.
- [ ] **Step 4:** URL sem `?k=` → 403; screenshots 1440px e 390px anexados à pasta `docs/validacao-fase3/`.
- [ ] **Step 5:** registrar ✅/❌ em `docs/validacao-fase3.md`; commit `docs: resultados da validação da Fase 3 (Claude Code)`.
