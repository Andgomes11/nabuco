# nabuco — Fase 1 (Núcleo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo do plugin `nabuco`: 9 funcionários gerados para Claude Code e Codex a partir de uma fonte única, o Gerente (skill `tarefa`) com ciclo de tarefa em arquivos, gate de evidência por hook, registro de eventos, setup/status, `docs-atuais` e skills de design — instalável pelos dois harnesses.

**Architecture:** Um repositório = um plugin com dois manifestos (`.claude-plugin/`, `.codex-plugin/`) que compartilham `skills/`, `hooks/` e `scripts/`. Toda lógica determinística fica em scripts Node sem dependências (`scripts/*.mjs` + `scripts/lib/*.mjs`), testados com `node:test`; skills e papéis são Markdown que instruem o modelo a chamar esses scripts. `build.mjs` gera `agents/*.md` (Claude) e `codex-agents/*.toml` (Codex) a partir de `papeis/*.md` + `modelos.json`; os arquivos gerados são commitados.

**Tech Stack:** Node.js ≥ 20 (ESM `.mjs`, só módulos nativos: `node:fs`, `node:path`, `node:os`, `node:util`, `node:child_process`, `node:test`, `node:assert`), Markdown, JSON, TOML (gerado), Git.

**Spec:** `docs/superpowers/specs/2026-10-16-nabuco-design.md`

## Global Constraints

- Node ≥ 20; zero dependências de runtime ou de desenvolvimento (nada em `dependencies`/`devDependencies`).
- Todos os scripts são ESM `.mjs`; caminhos sempre via `node:path` (`join`, `dirname`) — precisam funcionar no Windows, inclusive em pastas com espaço (ex.: `C:\Users\Anderson\Desktop\Nova pasta`).
- Texto voltado ao usuário (mensagens de CLI, skills, papéis) em português do Brasil.
- Skills: frontmatter só com campos do padrão aberto agentskills.io — `name`, `description` (e opcionalmente `license`, `metadata`, `allowed-tools`, `compatibility`); `name` igual ao nome da pasta; `description` ≤ 1024 caracteres.
- Nome do plugin/marketplace: `nabuco`. Agentes: Claude `nabuco:<papel>`; Codex `nabuco-<papel>`.
- Dados do usuário em `~/.nabuco/` (sobrescrevível por `NABUCO_HOME`); dados do projeto em `<projeto>/.nabuco/`.
- Overrides para testes: `NABUCO_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `NABUCO_HARNESS`.
- Hooks nunca podem derrubar o harness: qualquer erro interno → exit 0 (com aviso em stderr), exceto o bloqueio intencional do gate.
- Papéis (`papeis/*.md`) com no máximo 80 linhas.
- Nenhum agente toca produção, faz push/deploy, commita, ou instala dependência fora do plano.
- Commits em português, estilo `tipo: descrição`, **sem** linha `Co-Authored-By` e sem rodapé de ferramenta.

## Review Focus

1. **Projeto sem nabuco / sem tarefa ativa:** o hook Stop roda em *toda* sessão de *todo* projeto — deve sair 0 sem saída alguma. (teste na Task 4)
2. **Arquivos da tarefa corrompidos ou apagados à mão** (`estado.json`/`criterios.json` inválidos, pasta removida mas `ativa` ainda aponta): gate não pode prender o usuário num loop — sai 0 com aviso em stderr. (testes nas Tasks 1 e 4)
3. **Caminhos com espaço e acentos** (a pasta do usuário é `Nova pasta`): CLI e hooks funcionam. (testes nas Tasks 1 e 4)
4. **Texto de papel com aspas, barras invertidas, `'''`, `:` e quebras de linha:** TOML/YAML gerados continuam válidos e preservam o texto. (teste na Task 2)
5. **Payload de hook incompleto ou diferente entre harnesses** (Codex sem `agent_id`, stdin vazio, JSON inválido): `evento.mjs --hook` não quebra e sai 0. (teste na Task 5)

---

## Estrutura de arquivos (Fase 1)

```
.
├── package.json                         # scripts test/build; engines node>=20
├── build.mjs                            # CLI fino → scripts/lib/build.mjs
├── modelos.json                         # papel → modelo/effort (claude, codex)
├── papeis/<papel>.md                    # 9 funcionários (fonte única)
├── agents/<papel>.md                    # GERADO (Claude)
├── codex-agents/nabuco-<papel>.toml     # GERADO (Codex)
├── scripts/
│   ├── tarefa.mjs                       # CLI do ciclo da tarefa
│   ├── gate-evidencia.mjs               # hook Stop
│   ├── evento.mjs                       # CLI + hook SubagentStart/Stop
│   ├── versoes.mjs                      # CLI: versões instaladas de pacotes
│   ├── setup.mjs                        # instalação/validação
│   ├── status.mjs                       # relatório do time
│   └── lib/
│       ├── json.mjs  frontmatter.mjs  caminhos.mjs  constantes.mjs
│       ├── validar.mjs  gerar.mjs  build.mjs
│       ├── eventos.mjs  criterios.mjs  gate.mjs  modelos.mjs  versoes.mjs
├── skills/
│   ├── tarefa/SKILL.md  setup/SKILL.md  status/SKILL.md  docs-atuais/SKILL.md
│   ├── design-web/SKILL.md  design-web/NOTICE
│   └── design-mobile/SKILL.md  design-mobile/checklist.md
├── hooks/hooks.json
├── .claude-plugin/plugin.json  .claude-plugin/marketplace.json
├── .codex-plugin/plugin.json
├── .agents/plugins/marketplace.json
├── README.md
├── docs/validacao-fase1.md              # resultados do smoke test (Task 11)
└── tests/*.test.mjs
```

---

### Task 1: Fundação — package.json e libs básicas (json, frontmatter, caminhos, constantes)

**Files:**
- Create: `package.json`, `scripts/lib/json.mjs`, `scripts/lib/frontmatter.mjs`, `scripts/lib/caminhos.mjs`, `scripts/lib/constantes.mjs`
- Test: `tests/fundacao.test.mjs`

**Interfaces:**
- Produces:
  - `lerJson(caminho: string): any` (remove BOM; lança se inválido)
  - `escreverJson(caminho: string, dados: any): void` (escrita atômica via `.tmp` + rename, com `\n` final)
  - `parseFrontmatter(texto: string): { dados: Record<string,string>, corpo: string }`
  - `nabucoHome(): string`, `dirProjeto(projeto): string`, `dirTarefas(projeto): string`
  - `acharProjeto(inicio: string): string` — sobe até a primeira pasta com `.nabuco/` (exceto a global `~/.nabuco`) ou `.git/`; sem nenhuma, devolve `inicio`
  - `lerAtiva(projeto): { nome: string, dir: string } | null`, `escreverAtiva(projeto, nome)`, `limparAtiva(projeto)`
  - `PAPEIS`, `TAMANHOS`, `TIPOS`, `FASES`, `FASES_ATIVAS` (arrays/Set de strings)

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "nabuco",
  "version": "0.1.0",
  "description": "Time de funcionários-agentes que aprende com erros — Claude Code + Codex",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "build": "node build.mjs",
    "build:check": "node build.mjs --check"
  }
}
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/fundacao.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerJson, escreverJson } from '../scripts/lib/json.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { acharProjeto, lerAtiva, escreverAtiva, limparAtiva, dirTarefas, nabucoHome } from '../scripts/lib/caminhos.mjs';
import { PAPEIS, FASES, FASES_ATIVAS } from '../scripts/lib/constantes.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'nabuco pasta ç-'));

test('json: escreve e lê, tolera BOM', () => {
  const d = tmp(); const f = join(d, 'a.json');
  escreverJson(f, { x: 1 });
  assert.deepEqual(lerJson(f), { x: 1 });
  assert.ok(readFileSync(f, 'utf8').endsWith('\n'));
  writeFileSync(f, '\uFEFF{"y":2}');
  assert.deepEqual(lerJson(f), { y: 2 });
  rmSync(d, { recursive: true, force: true });
});

test('frontmatter: separa dados e corpo, aceita CRLF e ":" no valor', () => {
  const r = parseFrontmatter('---\r\nnome: Dev\r\ndescricao: faz: coisas\r\n---\r\n# Corpo\r\nlinha\r\n');
  assert.deepEqual(r.dados, { nome: 'Dev', descricao: 'faz: coisas' });
  assert.equal(r.corpo, '# Corpo\nlinha\n');
});

test('frontmatter: sem frontmatter devolve corpo inteiro; sem fechamento lança', () => {
  assert.deepEqual(parseFrontmatter('oi'), { dados: {}, corpo: 'oi' });
  assert.throws(() => parseFrontmatter('---\nnome: x\n'), /fechamento/);
});

test('acharProjeto: acha .nabuco subindo diretórios, com espaço no caminho', () => {
  const d = tmp(); const sub = join(d, 'a b', 'c');
  mkdirSync(join(d, '.nabuco'), { recursive: true }); mkdirSync(sub, { recursive: true });
  assert.equal(acharProjeto(sub), d);
  rmSync(d, { recursive: true, force: true });
});

test('acharProjeto: sem .nabuco usa raiz git; sem git usa o início', () => {
  const d = tmp(); const sub = join(d, 'x');
  mkdirSync(join(d, '.git'), { recursive: true }); mkdirSync(sub);
  assert.equal(acharProjeto(sub), d);
  const e = tmp();
  mkdirSync(join(e, '.git'));
  assert.equal(acharProjeto(e), e);
  rmSync(d, { recursive: true, force: true }); rmSync(e, { recursive: true, force: true });
});

test('acharProjeto: não sobe além da raiz git, nem confunde a pasta global ~/.nabuco com projeto', () => {
  const d = tmp();
  const global = join(d, '.nabuco'); mkdirSync(global);
  const repo = join(d, 'repo'); mkdirSync(join(repo, '.git'), { recursive: true });
  const solto = join(d, 'solto'); mkdirSync(solto);
  process.env.NABUCO_HOME = global;
  try {
    assert.equal(acharProjeto(repo), repo);   // para no .git, não sobe até d
    assert.equal(acharProjeto(solto), solto); // ignora d/.nabuco por ser a pasta global
  } finally { delete process.env.NABUCO_HOME; }
  rmSync(d, { recursive: true, force: true });
});

test('ativa: escreve, lê, ignora pasta inexistente, limpa', () => {
  const d = tmp();
  assert.equal(lerAtiva(d), null);
  escreverAtiva(d, '2026-10-17-x');
  assert.equal(lerAtiva(d), null); // pasta da tarefa não existe
  mkdirSync(join(dirTarefas(d), '2026-10-17-x'), { recursive: true });
  assert.deepEqual(lerAtiva(d), { nome: '2026-10-17-x', dir: join(dirTarefas(d), '2026-10-17-x') });
  limparAtiva(d);
  assert.equal(lerAtiva(d), null);
  rmSync(d, { recursive: true, force: true });
});

test('nabucoHome respeita NABUCO_HOME', () => {
  process.env.NABUCO_HOME = '/tmp/xyz';
  assert.equal(nabucoHome(), '/tmp/xyz');
  delete process.env.NABUCO_HOME;
});

test('constantes', () => {
  assert.deepEqual(PAPEIS, ['arquiteto', 'debugger', 'designer', 'dev', 'devops', 'docs', 'revisor', 'seguranca', 'tester']);
  assert.ok(FASES.includes('aguardando_usuario') && FASES.includes('abandonada'));
  assert.ok(FASES_ATIVAS.has('executando') && FASES_ATIVAS.has('checando') && !FASES_ATIVAS.has('aguardando_usuario'));
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/json.mjs'`

- [ ] **Step 4: Implementar**

`scripts/lib/json.mjs`:

```js
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export function lerJson(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8').replace(/^\uFEFF/, ''));
}

export function escreverJson(caminho, dados) {
  const tmp = caminho + '.tmp';
  writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n');
  renameSync(tmp, caminho);
}
```

`scripts/lib/frontmatter.mjs`:

```js
export function parseFrontmatter(texto) {
  const t = texto.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { dados: {}, corpo: t };
  const fim = t.indexOf('\n---', 3);
  if (fim === -1) throw new Error('frontmatter sem fechamento (---)');
  const bloco = t.slice(4, fim);
  const corpo = t.slice(fim + 4).replace(/^\n/, '');
  const dados = {};
  for (const linha of bloco.split('\n')) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf(':');
    if (i === -1) throw new Error(`linha inválida no frontmatter: "${linha}"`);
    dados[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return { dados, corpo };
}
```

`scripts/lib/caminhos.mjs`:

```js
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

export function nabucoHome() {
  return process.env.NABUCO_HOME || join(homedir(), '.nabuco');
}
export function dirProjeto(projeto) { return join(projeto, '.nabuco'); }
export function dirTarefas(projeto) { return join(projeto, '.nabuco', 'tarefas'); }

// Sobe a partir de `inicio` até achar um projeto: a primeira pasta com `.nabuco/`
// (exceto a pasta global do usuário, ~/.nabuco) ou com `.git/` (fronteira do repositório).
// Sem nenhuma das duas até a raiz do disco, devolve `inicio`.
export function acharProjeto(inicio) {
  const globais = new Set([resolve(nabucoHome()), resolve(join(homedir(), '.nabuco'))]);
  let atual = resolve(inicio);
  for (;;) {
    const marca = join(atual, '.nabuco');
    if (existsSync(marca) && !globais.has(marca)) return atual;
    if (existsSync(join(atual, '.git'))) return atual;
    const pai = dirname(atual);
    if (pai === atual) return resolve(inicio);
    atual = pai;
  }
}

export function lerAtiva(projeto) {
  const arq = join(dirProjeto(projeto), 'ativa');
  if (!existsSync(arq)) return null;
  const nome = readFileSync(arq, 'utf8').trim();
  if (!nome) return null;
  const dir = join(dirTarefas(projeto), nome);
  return existsSync(dir) ? { nome, dir } : null;
}

export function escreverAtiva(projeto, nome) {
  mkdirSync(dirProjeto(projeto), { recursive: true });
  writeFileSync(join(dirProjeto(projeto), 'ativa'), nome + '\n');
}

export function limparAtiva(projeto) {
  rmSync(join(dirProjeto(projeto), 'ativa'), { force: true });
}
```

`scripts/lib/constantes.mjs`:

```js
export const PAPEIS = ['arquiteto', 'debugger', 'designer', 'dev', 'devops', 'docs', 'revisor', 'seguranca', 'tester'];
export const TAMANHOS = ['trivial', 'media', 'sensivel'];
export const TIPOS = ['feature', 'bug', 'ui', 'infra', 'estrutural', 'docs', 'refactor'];
export const FASES = ['planejando', 'aguardando_aprovacao', 'executando', 'checando', 'aguardando_usuario', 'concluida', 'abandonada'];
export const FASES_ATIVAS = new Set(['executando', 'checando']);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS (9 testes)

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/lib tests/fundacao.test.mjs
git commit -m "feat: fundação do plugin (json, frontmatter, caminhos, constantes)"
```

---

### Task 2: Funcionários — papéis, modelos.json e build para Claude/Codex

**Files:**
- Create: `scripts/lib/validar.mjs`, `scripts/lib/gerar.mjs`, `scripts/lib/build.mjs`, `scripts/lib/modelos.mjs`, `build.mjs`, `modelos.json`, `papeis/{arquiteto,debugger,designer,dev,devops,docs,revisor,seguranca,tester}.md`
- Generated (commitados): `agents/*.md`, `codex-agents/nabuco-*.toml`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter`, `lerJson`, `PAPEIS` (Task 1)
- Produces:
  - `validarModelos(modelos, papeis: string[]): string[]` (lista de erros em pt-BR)
  - `validarPapel(papel: string, fm: object): string[]`
  - `gerarAgenteClaude(papel, fm, corpo, cfg: {model, effort}): string`
  - `gerarAgenteCodex(papel, fm, corpo, cfg: {model: string|null, effort}): string`
  - `construir(raiz): { papeis: string[], arquivos: Map<string,string>, erros: string[] }` (chaves com `/`)
  - `escrever(raiz, arquivos): void` (remove gerados obsoletos)
  - `diferencas(raiz, arquivos): string[]`
  - `carregarModelos(raiz): object`, `configDe(modelos, harness, papel): {model, effort} | null`

- [ ] **Step 1: Escrever o teste que falha**

`tests/build.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarModelos, validarPapel } from '../scripts/lib/validar.mjs';
import { gerarAgenteClaude, gerarAgenteCodex } from '../scripts/lib/gerar.mjs';
import { construir, escrever, diferencas } from '../scripts/lib/build.mjs';
import { PAPEIS } from '../scripts/lib/constantes.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

test('validarModelos aponta modelo/effort inválidos e papel faltando/desconhecido', () => {
  const m = { claude: { dev: { model: 'opuss', effort: 'alto' }, x: { model: 'opus', effort: 'high' } }, codex: { dev: { model: '', effort: 'ultra' } } };
  const e = validarModelos(m, ['dev', 'tester']).join('\n');
  assert.match(e, /claude\.dev\.model inválido: "opuss"/);
  assert.match(e, /claude\.dev\.effort inválido: "alto"/);
  assert.match(e, /claude\.tester: papel sem configuração/);
  assert.match(e, /claude\.x: papel desconhecido/);
  assert.match(e, /codex\.dev\.model inválido/);
  assert.doesNotMatch(e, /codex\.dev\.effort/); // ultra é válido no Codex
});

test('validarModelos aceita inherit, aliases, IDs claude-* e null no Codex', () => {
  const m = { claude: { dev: { model: 'inherit', effort: 'high' }, docs: { model: 'claude-sonnet-5-5', effort: 'low' } }, codex: { dev: { model: null, effort: 'high' }, docs: { model: 'gpt-6.1-sol', effort: 'medium' } } };
  assert.deepEqual(validarModelos(m, ['dev', 'docs']), []);
});

test('validarPapel exige nome/descricao e ferramentas conhecidas', () => {
  const e = validarPapel('rev', { nome: 'Revisor', descricao: 'x', ferramentas: 'Read, Grpe' }).join('\n');
  assert.match(e, /ferramenta desconhecida "Grpe"/);
  assert.match(validarPapel('rev', {}).join('\n'), /falta "nome"/);
});

test('gerar: texto hostil continua válido e preservado em YAML/TOML', () => {
  const fm = { nome: 'X', descricao: 'diz: "oi" \\ ok', ferramentas: 'Read, Grep' };
  const corpo = "Linha 'a' ''' \"b\" \\n real\nsegunda: linha\n";
  const c = gerarAgenteClaude('rev', fm, corpo, { model: 'opus', effort: 'high' });
  assert.match(c, /^---\nname: rev\ndescription: "diz: \\"oi\\" \\\\ ok"\nmodel: opus\neffort: high\ntools: Read, Grep\n---\n/);
  assert.ok(c.includes(corpo.trimEnd()));
  const t = gerarAgenteCodex('rev', fm, corpo, { model: null, effort: 'high' });
  assert.doesNotMatch(t, /^model = /m); // null => herda
  const instr = t.match(/^developer_instructions = (.*)$/m)[1];
  assert.equal(JSON.parse(instr), corpo.trim()); // string básica TOML == string JSON
  assert.match(t, /^name = "nabuco-rev"$/m);
});

test('construir: repo real gera 9 agentes para cada harness sem erros', () => {
  const r = construir(raiz);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.papeis, PAPEIS);
  for (const p of PAPEIS) {
    assert.ok(r.arquivos.has(`agents/${p}.md`));
    assert.ok(r.arquivos.has(`codex-agents/nabuco-${p}.toml`));
  }
});

test('arquivos gerados commitados estão atualizados', () => {
  assert.deepEqual(diferencas(raiz, construir(raiz).arquivos), []);
});

test('papéis: frontmatter, seção Entrega, limites e no máximo 80 linhas', () => {
  for (const p of PAPEIS) {
    const txt = readFileSync(join(raiz, 'papeis', p + '.md'), 'utf8');
    const { dados, corpo } = parseFrontmatter(txt);
    assert.ok(dados.nome && dados.descricao, p);
    assert.match(corpo, /^## Entrega/m, p);
    assert.match(corpo, /^## Limites/m, p);
    assert.ok(txt.split('\n').length <= 80, `${p} tem mais de 80 linhas`);
  }
});

test('checadores e arquiteto não têm ferramentas de escrita', () => {
  for (const p of ['arquiteto', 'revisor', 'seguranca', 'tester']) {
    const { dados } = parseFrontmatter(readFileSync(join(raiz, 'papeis', p + '.md'), 'utf8'));
    assert.ok(dados.ferramentas, `${p} precisa declarar ferramentas`);
    assert.doesNotMatch(dados.ferramentas, /\b(Edit|Write|NotebookEdit)\b/, p);
  }
});

test('escrever remove gerados obsoletos', () => {
  const d = mkdtempSync(join(tmpdir(), 'nabuco-build-'));
  cpSync(join(raiz, 'papeis'), join(d, 'papeis'), { recursive: true });
  cpSync(join(raiz, 'modelos.json'), join(d, 'modelos.json'));
  mkdirSync(join(d, 'agents')); writeFileSync(join(d, 'agents', 'velho.md'), 'x');
  const r = construir(d); escrever(d, r.arquivos);
  assert.ok(!existsSync(join(d, 'agents', 'velho.md')));
  assert.deepEqual(diferencas(d, r.arquivos), []);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/validar.mjs'`

- [ ] **Step 3: Implementar libs**

`scripts/lib/validar.mjs`:

```js
export const MODELOS_CLAUDE = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
export const EFFORTS_CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORTS_CODEX = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const FERRAMENTAS_CLAUDE = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill'];

export function validarModelos(modelos, papeis) {
  const erros = [];
  for (const h of ['claude', 'codex']) {
    const sec = modelos?.[h];
    if (!sec || typeof sec !== 'object') { erros.push(`modelos.json: falta a seção "${h}"`); continue; }
    for (const p of papeis) {
      const c = sec[p];
      if (!c) { erros.push(`${h}.${p}: papel sem configuração`); continue; }
      if (h === 'claude' && !(MODELOS_CLAUDE.includes(c.model) || /^claude-[a-z0-9.-]+$/.test(c.model ?? ''))) {
        erros.push(`claude.${p}.model inválido: "${c.model}" (use ${MODELOS_CLAUDE.join(', ')} ou um ID claude-*)`);
      }
      if (h === 'codex' && c.model !== null && (typeof c.model !== 'string' || !c.model.trim())) {
        erros.push(`codex.${p}.model inválido: use null para herdar da sessão ou o nome de um modelo`);
      }
      const ef = h === 'claude' ? EFFORTS_CLAUDE : EFFORTS_CODEX;
      if (!ef.includes(c.effort)) erros.push(`${h}.${p}.effort inválido: "${c.effort}" (use ${ef.join(', ')})`);
    }
    for (const extra of Object.keys(sec)) {
      if (!papeis.includes(extra)) erros.push(`${h}.${extra}: papel desconhecido (não existe papeis/${extra}.md)`);
    }
  }
  return erros;
}

export function validarPapel(papel, fm) {
  const erros = [];
  if (!fm.nome) erros.push(`papeis/${papel}.md: falta "nome"`);
  if (!fm.descricao) erros.push(`papeis/${papel}.md: falta "descricao"`);
  if (fm.ferramentas) {
    for (const f of fm.ferramentas.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!FERRAMENTAS_CLAUDE.includes(f)) erros.push(`papeis/${papel}.md: ferramenta desconhecida "${f}"`);
    }
  }
  return erros;
}
```

`scripts/lib/gerar.mjs`:

```js
export function gerarAgenteClaude(papel, fm, corpo, cfg) {
  const linhas = ['---', `name: ${papel}`, `description: ${JSON.stringify(fm.descricao)}`, `model: ${cfg.model}`, `effort: ${cfg.effort}`];
  if (fm.ferramentas) linhas.push(`tools: ${fm.ferramentas}`);
  linhas.push('---', '', corpo.trimEnd(), '');
  return linhas.join('\n');
}

// Strings JSON são strings básicas TOML válidas (mesmas regras de escape).
export function gerarAgenteCodex(papel, fm, corpo, cfg) {
  const l = [
    `# GERADO por build.mjs a partir de papeis/${papel}.md — não edite à mão.`,
    `name = ${JSON.stringify('nabuco-' + papel)}`,
    `description = ${JSON.stringify(fm.descricao)}`,
  ];
  if (cfg.model) l.push(`model = ${JSON.stringify(cfg.model)}`);
  l.push(`model_reasoning_effort = ${JSON.stringify(cfg.effort)}`);
  l.push(`developer_instructions = ${JSON.stringify(corpo.trim())}`);
  return l.join('\n') + '\n';
}
```

`scripts/lib/build.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { lerJson } from './json.mjs';
import { validarModelos, validarPapel } from './validar.mjs';
import { gerarAgenteClaude, gerarAgenteCodex } from './gerar.mjs';

const PASTAS_GERADAS = ['agents', 'codex-agents'];

export function construir(raiz) {
  const papeis = readdirSync(join(raiz, 'papeis')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  const modelos = lerJson(join(raiz, 'modelos.json'));
  const erros = validarModelos(modelos, papeis);
  const arquivos = new Map();
  for (const p of papeis) {
    let fm, corpo;
    try { ({ dados: fm, corpo } = parseFrontmatter(readFileSync(join(raiz, 'papeis', p + '.md'), 'utf8'))); }
    catch (e) { erros.push(`papeis/${p}.md: ${e.message}`); continue; }
    const ep = validarPapel(p, fm);
    erros.push(...ep);
    if (ep.length || !modelos?.claude?.[p] || !modelos?.codex?.[p]) continue;
    arquivos.set(`agents/${p}.md`, gerarAgenteClaude(p, fm, corpo, modelos.claude[p]));
    arquivos.set(`codex-agents/nabuco-${p}.toml`, gerarAgenteCodex(p, fm, corpo, modelos.codex[p]));
  }
  return { papeis, arquivos, erros };
}

function existentes(raiz) {
  const out = [];
  for (const pasta of PASTAS_GERADAS) {
    const d = join(raiz, pasta);
    if (existsSync(d)) for (const f of readdirSync(d)) out.push(`${pasta}/${f}`);
  }
  return out;
}

export function escrever(raiz, arquivos) {
  for (const rel of existentes(raiz)) if (!arquivos.has(rel)) rmSync(join(raiz, ...rel.split('/')), { force: true });
  for (const [rel, conteudo] of arquivos) {
    const partes = rel.split('/');
    mkdirSync(join(raiz, ...partes.slice(0, -1)), { recursive: true });
    writeFileSync(join(raiz, ...partes), conteudo);
  }
}

export function diferencas(raiz, arquivos) {
  const dif = [];
  for (const rel of existentes(raiz)) if (!arquivos.has(rel)) dif.push(`${rel} (obsoleto)`);
  for (const [rel, conteudo] of arquivos) {
    const caminho = join(raiz, ...rel.split('/'));
    if (!existsSync(caminho) || readFileSync(caminho, 'utf8') !== conteudo) dif.push(rel);
  }
  return dif;
}
```

`scripts/lib/modelos.mjs`:

```js
import { join } from 'node:path';
import { lerJson } from './json.mjs';

export function carregarModelos(raiz) {
  try { return lerJson(join(raiz, 'modelos.json')); } catch { return null; }
}

export function configDe(modelos, harness, papel) {
  return modelos?.[harness]?.[papel] ?? null;
}
```

`build.mjs` (raiz):

```js
#!/usr/bin/env node
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construir, escrever, diferencas } from './scripts/lib/build.mjs';

const raiz = dirname(fileURLToPath(import.meta.url));
const { arquivos, erros } = construir(raiz);
if (erros.length) {
  console.error('Erros de configuração:\n' + erros.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const dif = diferencas(raiz, arquivos);
  if (dif.length) {
    console.error('Arquivos gerados desatualizados (rode "npm run build"):\n' + dif.map(d => '  - ' + d).join('\n'));
    process.exit(1);
  }
  console.log(`OK: ${arquivos.size} arquivos gerados estão atualizados.`);
} else {
  escrever(raiz, arquivos);
  console.log(`Gerados ${arquivos.size} arquivos em agents/ e codex-agents/.`);
}
```

- [ ] **Step 4: Criar `modelos.json`**

```json
{
  "claude": {
    "arquiteto": { "model": "opus", "effort": "high" },
    "debugger":  { "model": "opus", "effort": "high" },
    "designer":  { "model": "inherit", "effort": "high" },
    "dev":       { "model": "inherit", "effort": "high" },
    "devops":    { "model": "inherit", "effort": "high" },
    "docs":      { "model": "sonnet", "effort": "medium" },
    "revisor":   { "model": "opus", "effort": "high" },
    "seguranca": { "model": "opus", "effort": "high" },
    "tester":    { "model": "sonnet", "effort": "medium" }
  },
  "codex": {
    "arquiteto": { "model": "gpt-6-astra", "effort": "high" },
    "debugger":  { "model": "gpt-6-astra", "effort": "high" },
    "designer":  { "model": null, "effort": "high" },
    "dev":       { "model": null, "effort": "high" },
    "devops":    { "model": null, "effort": "high" },
    "docs":      { "model": "gpt-6.1-sol", "effort": "medium" },
    "revisor":   { "model": "gpt-6-astra", "effort": "high" },
    "seguranca": { "model": "gpt-6-astra", "effort": "high" },
    "tester":    { "model": "gpt-6.1-sol", "effort": "medium" }
  }
}
```

- [ ] **Step 5: Criar os 9 papéis**

Todos terminam com a mesma seção `## Entrega`. Conteúdo exato:

`papeis/dev.md`:

```markdown
---
nome: Dev
descricao: Escritor principal do time nabuco. Implementa a tarefa conforme o plano aprovado, escrevendo os testes junto com o código. Use para features, refactors e mudanças de código em geral.
---
# Dev — time nabuco

Você é o Dev: o escritor principal. O Gerente informa a pasta da tarefa (`.nabuco/tarefas/<nome>/`) e o que fazer agora.

## Protocolo
1. Leia `plano.md`, `criterios.json` e `progresso.md` da tarefa antes de tocar em código.
2. Antes de usar uma lib ou framework de forma não trivial, use a skill `docs-atuais` (documentação da versão instalada).
3. Para cada critério: escreva o teste, rode e veja falhar; implemente o mínimo; rode e veja passar.
4. Siga os padrões do código existente (nomes, estrutura, densidade de comentários).
5. Ao final, rode a suíte relevante completa e guarde a saída para a evidência.
6. Se o plano estiver errado ou incompleto, pare e descreva em **bloqueios** — não invente escopo.

## Limites
- Altere só o que o plano pede; nada de refactor "de passagem".
- Não adicione dependências que não estejam no plano aprovado.
- Nunca: tocar produção, fazer push, deploy ou commit, apagar dados fora do projeto.
- Não declare nada pronto sem ter rodado o comando que prova.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** arquivos alterados e o que mudou (ou "nenhuma")
- **decisões:** escolhas feitas e por quê
- **evidência:** comando executado + resultado resumido (ex.: `npm test` → 142 passed)
- **bloqueios:** o que impede avançar (ou "nenhum")
```

`papeis/debugger.md`:

```markdown
---
nome: Debugger
descricao: Investiga e corrige bugs com método - reproduz, escreve teste de regressão que falha, encontra a causa raiz e aplica o fix mínimo. Use para qualquer bug, erro ou teste quebrando.
---
# Debugger — time nabuco

Você é o Debugger. O Gerente informa a pasta da tarefa (`.nabuco/tarefas/<nome>/`) e o sintoma.

## Protocolo
1. Leia `plano.md`, `criterios.json` e `progresso.md`.
2. **Reproduza** o erro com um comando. Sem reprodução, não há correção — reporte em bloqueios.
3. Escreva um **teste de regressão** que falha pelo motivo certo. Rode e mostre a falha.
4. Liste hipóteses com o sinal que cada uma preveria; teste a mais provável primeiro.
   Se a evidência contradiz a hipótese, descarte-a — não force.
5. Ache a **causa raiz** (não o sintoma). Use `docs-atuais` se envolver comportamento de lib.
6. Aplique o **fix mínimo**; rode o teste de regressão e a suíte relevante.

## Limites
- Nunca corrija sem antes ter um teste que falha.
- Fix mínimo: não refatore nem "melhore" código ao redor.
- Não adicione dependências fora do plano.
- Nunca: tocar produção, fazer push, deploy ou commit.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** arquivos alterados e o que mudou (ou "nenhuma")
- **decisões:** hipóteses descartadas, causa raiz encontrada e por que o fix resolve
- **evidência:** teste falhando antes + passando depois (comandos e resultados resumidos)
- **bloqueios:** o que impede avançar (ou "nenhum")
```

`papeis/designer.md`:

```markdown
---
nome: Designer
descricao: Cria e ajusta interfaces web e mobile com qualidade visual e acessibilidade. Define tokens antes do código e faz autocrítica com screenshot. Use para telas, componentes, estilos e UX.
---
# Designer — time nabuco

Você é o Designer. O Gerente informa a pasta da tarefa (`.nabuco/tarefas/<nome>/`) e o que fazer.

## Protocolo
1. Leia `plano.md`, `criterios.json` e `progresso.md`.
2. Descubra a plataforma: web → skill `design-web`; iOS/Android/React Native/Flutter → skill `design-mobile`.
3. Se o projeto já tem design system/tema, ele manda: reuse tokens e componentes existentes.
4. Defina (ou confirme) os tokens antes do código: cores, tipografia, espaçamento, raios, sombras.
5. Implemente com todos os estados: padrão, hover/press, foco, desabilitado, carregando, vazio, erro.
6. Faça autocrítica: gere screenshot (Chrome DevTools/navegador se disponível) e confira a checklist da skill.
7. Se o plugin Figma ou o ui-ux-pro-max estiverem instalados e forem úteis, use-os.

## Limites
- Em app nativo, a convenção da plataforma (HIG/Material 3) vence a ousadia estética.
- Não troque a identidade visual existente sem estar no plano.
- Não adicione dependências fora do plano.
- Nunca: tocar produção, fazer push, deploy ou commit.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** arquivos alterados e o que mudou (ou "nenhuma")
- **decisões:** direção visual, tokens e trade-offs
- **evidência:** screenshot(s) gerado(s), checklist conferida, testes/lint rodados
- **bloqueios:** o que impede avançar (ou "nenhum")
```

`papeis/devops.md`:

```markdown
---
nome: DevOps
descricao: Cuida de CI, infraestrutura como código, Docker e scripts de deploy para ambientes de teste/staging. Nunca toca produção. Use para pipelines, containers, configs de ambiente e automações.
---
# DevOps — time nabuco

Você é o DevOps. O Gerente informa a pasta da tarefa (`.nabuco/tarefas/<nome>/`) e o que fazer.

## Protocolo
1. Leia `plano.md`, `criterios.json` e `progresso.md`.
2. Use `docs-atuais` para a versão exata de actions, imagens e ferramentas usadas.
3. Fixe versões (actions por versão/sha, imagens por tag explícita).
4. Valide localmente o que der: lint de YAML, `docker build`, dry-run, plano de IaC.
5. Segredos: só referências a variáveis/secret stores; nunca valores reais em arquivos.

## Limites
- **Nunca** toque produção: nada de apply/deploy/migração em prod, nem credenciais reais.
- Nunca faça push, deploy, commit, nem dispare pipelines remotos.
- Não adicione serviços ou dependências fora do plano.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** arquivos alterados e o que mudou (ou "nenhuma")
- **decisões:** escolhas e por quê (versões fixadas, alternativas descartadas)
- **evidência:** validações locais executadas + resultados resumidos
- **bloqueios:** o que impede avançar (ou "nenhum")
```

`papeis/docs.md`:

```markdown
---
nome: Docs
descricao: Escreve e atualiza documentação - README, changelog e docs de API - a partir das mudanças feitas. Não edita código. Use quando uma API pública mudar ou a tarefa pedir documentação.
ferramentas: Read, Grep, Glob, Edit, Write, WebFetch
---
# Docs — time nabuco

Você é o Docs. O Gerente informa a pasta da tarefa e quais mudanças documentar.

## Protocolo
1. Leia `plano.md`, `progresso.md` e o diff que o Gerente enviar.
2. Atualize só o necessário: README, CHANGELOG, docs de API, exemplos.
3. Confira cada exemplo de código contra a implementação real (nome, assinatura, retorno).
4. Mantenha o tom e o formato da documentação existente.

## Limites
- Edite **somente** arquivos de documentação (`*.md`, `docs/`, comentários de doc pedidos no plano).
- Não altere código, testes ou configs.
- Nunca: tocar produção, fazer push, deploy ou commit.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** arquivos de documentação alterados (ou "nenhuma")
- **decisões:** o que foi documentado e o que ficou de fora, e por quê
- **evidência:** exemplos conferidos contra o código (arquivo:linha)
- **bloqueios:** o que impede avançar (ou "nenhum")
```

`papeis/arquiteto.md`:

```markdown
---
nome: Arquiteto
descricao: Analisa a estrutura do código e propõe arquitetura, limites entre módulos e trade-offs antes de mudanças estruturais. Somente leitura. Use antes de planejar mudanças que reorganizam componentes ou interfaces.
ferramentas: Read, Grep, Glob, WebFetch, WebSearch
---
# Arquiteto — time nabuco

Você é o Arquiteto. Você **não escreve código**: analisa e recomenda. O Gerente descreve a mudança pretendida.

## Protocolo
1. Mapeie a estrutura atual relevante (módulos, dependências, pontos de entrada) com evidência (arquivo:linha).
2. Proponha 2–3 abordagens com trade-offs (complexidade, risco, reversibilidade, impacto em quem consome).
3. Recomende uma e diga por quê, em uma frase.
4. Aponte riscos e o que precisa ser testado para provar que a mudança funcionou.

## Limites
- Somente leitura: não crie nem edite arquivos.
- YAGNI: não proponha camadas/abstrações sem um segundo consumidor real.
- Respeite os padrões existentes, salvo motivo forte e explícito.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** nenhuma (somente análise)
- **decisões:** abordagens comparadas, recomendação e motivo
- **evidência:** trechos do código que embasam a análise (arquivo:linha)
- **bloqueios:** dúvidas que o usuário precisa decidir (ou "nenhum")
```

`papeis/revisor.md`:

```markdown
---
nome: Revisor
descricao: Revisa o diff de uma tarefa em contexto limpo, buscando bugs de corretude e desvios do plano. Somente leitura. Use após a implementação, antes do gate.
ferramentas: Read, Grep, Glob
---
# Revisor — time nabuco

Você é o Revisor. Recebe do Gerente: o **diff**, o plano e os critérios. Não recebe o histórico da implementação — de propósito.

## Protocolo
1. Leia plano e critérios; depois o diff inteiro.
2. Para cada trecho alterado, pergunte: está correto? cobre os critérios? quebra algo que usa isso?
3. Abra os arquivos ao redor quando precisar de contexto (chamadores, tipos, testes).
4. Para cada problema, descreva o cenário concreto que falha (entrada → resultado errado).

## Limites
- Somente leitura: não edite nada.
- Reporte **só** o que afeta corretude, segurança ou os critérios. Nada de preferência de estilo.
- Não existe cota de achados: se não houver nada, responda "nada a reportar".

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** nenhuma (somente revisão)
- **decisões:** lista de achados — `severidade (alta/média/baixa) · arquivo:linha · cenário que falha · sugestão`
- **evidência:** trechos que comprovam cada achado
- **bloqueios:** o que não deu para avaliar (ou "nenhum")
```

`papeis/seguranca.md`:

```markdown
---
nome: Segurança
descricao: Revisa o diff em busca de vulnerabilidades - injeção, autenticação/autorização, segredos, dependências vulneráveis e dados pessoais (LGPD). Somente leitura. Use em tarefas sensíveis.
ferramentas: Read, Grep, Glob, WebFetch, WebSearch
---
# Segurança — time nabuco

Você é a Segurança. Recebe do Gerente: o **diff**, o plano e os critérios, em contexto limpo.

## Protocolo
1. Identifique entradas não confiáveis e para onde fluem (SQL, shell, HTML, caminhos, deserialização).
2. Verifique autenticação e autorização em cada rota/ação alterada.
3. Procure segredos em código, logs e configs; e dados pessoais expostos ou logados (LGPD).
4. Dependências novas ou alteradas: verifique vulnerabilidades conhecidas da versão (fonte oficial).
5. Para cada problema, descreva o ataque concreto (entrada → impacto).

## Limites
- Somente leitura: não edite nada.
- Reporte só riscos reais e exploráveis no contexto; sem cota mínima.
- Se não houver nada, responda "nada a reportar".

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** nenhuma (somente revisão)
- **decisões:** achados — `severidade · arquivo:linha · ataque concreto · correção sugerida`
- **evidência:** trechos e fontes (CVE/advisory) que comprovam cada achado
- **bloqueios:** o que não deu para avaliar (ou "nenhum")
```

`papeis/tester.md`:

```markdown
---
nome: Tester
descricao: Roda a suíte de testes e verificações ponta a ponta, confere os critérios de aceite e aponta lacunas de teste. Pode executar comandos, não edita arquivos. Use em tarefas sensíveis e para verificação independente.
ferramentas: Read, Grep, Glob, Bash
---
# Tester — time nabuco

Você é o Tester. Recebe do Gerente: a pasta da tarefa, o diff e os critérios.

## Protocolo
1. Leia `criterios.json`. Rode o comando de verificação de **cada** critério e registre a saída resumida.
2. Rode a suíte completa relevante e, se existir, a verificação ponta a ponta.
3. Compare o diff com os testes: que comportamento novo ficou sem teste?
4. Reporte falhas com o comando exato para reproduzir.

## Limites
- **Não edite nem crie arquivos** — nem testes. Você só executa e reporta.
- Não rode comandos destrutivos (drop, rm fora de temporários, deploy, push).
- Sem cota de achados: se tudo passou e não há lacunas, diga isso.

## Entrega
Responda sempre neste formato, em português:
- **mudanças:** nenhuma (somente verificação)
- **decisões:** lacunas de teste encontradas
- **evidência:** por critério: `id · comando · passou/falhou · saída resumida`
- **bloqueios:** o que não deu para rodar e por quê (ou "nenhum")
```

- [ ] **Step 6: Gerar os agentes**

Run: `npm run build`
Expected: `Gerados 18 arquivos em agents/ e codex-agents/.`

- [ ] **Step 7: Rodar os testes**

Run: `npm test`
Expected: PASS (todos, inclusive "arquivos gerados commitados estão atualizados")

- [ ] **Step 8: Commit**

```bash
git add build.mjs modelos.json papeis agents codex-agents scripts/lib tests/build.test.mjs
git commit -m "feat: 9 funcionários e build para Claude Code e Codex"
```

---

### Task 3: Ciclo da tarefa — CLI `tarefa.mjs`, critérios e registro de eventos

**Files:**
- Create: `scripts/lib/criterios.mjs`, `scripts/lib/eventos.mjs`, `scripts/tarefa.mjs`
- Test: `tests/tarefa.test.mjs`

**Interfaces:**
- Consumes: `acharProjeto`, `dirTarefas`, `lerAtiva`, `escreverAtiva`, `limparAtiva`, `nabucoHome`, `lerJson`, `escreverJson`, `TAMANHOS`, `TIPOS`, `FASES` (Task 1)
- Produces:
  - `pendencias(criterios): Array<{id: string, motivo: string}>`
  - `detectarHarness(payload?): 'claude'|'codex'|'desconhecido'|string`
  - `registrar({tipo, papel?, dados?, projeto, harness?}): object` — grava em `<tarefa ativa>/eventos.jsonl` (se houver) e sempre em `<nabucoHome>/historico.jsonl`
  - CLI `node scripts/tarefa.mjs <comando>` (executa a partir do cwd; projeto = `acharProjeto(cwd)`):
    - `nova --slug S --tamanho T --tipo X` → cria `.nabuco/tarefas/AAAA-MM-DD-<slug>/` com `estado.json`, `plano.md`, `progresso.md`, `criterios.json`, `eventos.jsonl`; marca ativa; imprime o caminho. Erro (exit 1) se já houver ativa não finalizada.
    - `criterio-add --id ID --descricao D --verificacao CMD`
    - `criterio --id ID --status passou|falhou|pendente [--evidencia E]` (passou exige evidência)
    - `aprovar` → evento `plano_aprovado`, fase `executando`
    - `fase F [--motivo M]`
    - `log --texto T` → acrescenta `- <ts> T` ao fim do `progresso.md`
    - `concluir` → exit 1 com pendências; ou fase `concluida`, evento `tarefa_fechada`, limpa ativa
    - `abandonar [--motivo M]` → fase `abandonada`, limpa ativa
    - `status` → imprime JSON `{ativa: null}` ou `{ativa, dir, estado, criterios: {total, passou, pendencias}}`
  - Exit codes: 0 ok; 1 regra violada; 2 uso incorreto.
  - `estado.json`: `{ slug, tamanho, tipo, fase, criada }`

- [ ] **Step 1: Escrever o teste que falha**

`tests/tarefa.test.mjs`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pendencias } from '../scripts/lib/criterios.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'tarefa.mjs');
let proj, home;

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'teste' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const linhas = f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco tarefa-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(dirname(proj), { recursive: true, force: true }));

test('pendencias', () => {
  assert.deepEqual(pendencias({ criterios: [] }), [{ id: '-', motivo: 'nenhum critério definido' }]);
  assert.deepEqual(pendencias({}), [{ id: '-', motivo: 'criterios.json sem lista "criterios"' }]);
  assert.deepEqual(pendencias({ criterios: [
    { id: 'a', status: 'passou', evidencia: 'ok' },
    { id: 'b', status: 'passou', evidencia: '  ' },
    { id: 'c' },
  ] }), [{ id: 'b', motivo: 'passou sem evidência registrada' }, { id: 'c', motivo: 'status "pendente"' }]);
});

test('ciclo completo: nova → critério → aprovar → passou → concluir', () => {
  const n = run('nova', '--slug', 'Login Social!', '--tamanho', 'media', '--tipo', 'feature');
  assert.equal(n.code, 0, n.err);
  const dir = n.out.trim();
  assert.match(dir, /\.nabuco[\\/]tarefas[\\/]\d{4}-\d{2}-\d{2}-login-social$/);
  for (const f of ['estado.json', 'plano.md', 'progresso.md', 'criterios.json']) assert.ok(existsSync(join(dir, f)), f);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'planejando');

  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'testes passam', '--verificacao', 'npm test').code, 0);
  assert.equal(run('aprovar').code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'executando');

  const c = run('concluir');
  assert.equal(c.code, 1);
  assert.match(c.err, /c1: status "pendente"/);

  assert.equal(run('criterio', '--id', 'c1', '--status', 'passou').code, 2); // passou sem evidência = uso incorreto
  assert.equal(run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia', '12 passed').code, 0);
  assert.equal(run('log', '--texto', 'Dev entregou').code, 0);
  assert.match(readFileSync(join(dir, 'progresso.md'), 'utf8'), /- .+ Dev entregou\n$/);

  assert.equal(run('concluir').code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'concluida');
  assert.equal(JSON.parse(run('status').out).ativa, null);

  const tipos = linhas(join(dir, 'eventos.jsonl')).map(e => e.tipo);
  assert.deepEqual(tipos, ['tarefa_criada', 'criterio', 'plano_aprovado', 'criterio', 'tarefa_fechada']);
  const hist = linhas(join(home, 'historico.jsonl'));
  assert.equal(hist.length, 5);
  assert.equal(hist[0].harness, 'teste');
  assert.equal(hist[0].projeto, 'Nova pasta');
});

test('nova recusa segunda tarefa ativa; abandonar libera', () => {
  run('nova', '--slug', 'a', '--tamanho', 'trivial', '--tipo', 'bug');
  const r = run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug');
  assert.equal(r.code, 1);
  assert.match(r.err, /já existe uma tarefa ativa/);
  assert.equal(run('abandonar', '--motivo', 'mudou o plano').code, 0);
  assert.equal(run('nova', '--slug', 'b', '--tamanho', 'trivial', '--tipo', 'bug').code, 0);
});

test('mesmo slug no mesmo dia gera sufixo', () => {
  const a = run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  run('abandonar');
  const b = run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
  assert.notEqual(a, b);
  assert.match(b, /-x-2$/);
});

test('validação de argumentos', () => {
  assert.equal(run('nova', '--slug', 'x', '--tamanho', 'enorme', '--tipo', 'bug').code, 2);
  assert.equal(run('nova', '--slug', '!!!', '--tamanho', 'media', '--tipo', 'bug').code, 2);
  assert.equal(run('fase', 'executando').code, 1); // sem tarefa ativa
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  assert.equal(run('fase', 'voando').code, 2);
  assert.equal(run('criterio', '--id', 'nao-existe', '--status', 'falhou').code, 1);
  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v').code, 0);
  assert.equal(run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v').code, 1); // id duplicado
  assert.equal(run('comando-inexistente').code, 2);
});

test('status com tarefa ativa', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  const s = JSON.parse(run('status').out);
  assert.equal(s.estado.fase, 'planejando');
  assert.deepEqual(s.criterios, { total: 1, passou: 0, pendencias: [{ id: 'c1', motivo: 'status "pendente"' }] });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/criterios.mjs'`

- [ ] **Step 3: Implementar `criterios.mjs` e `eventos.mjs`**

`scripts/lib/criterios.mjs`:

```js
export function pendencias(criterios) {
  const lista = Array.isArray(criterios?.criterios) ? criterios.criterios : null;
  if (!lista) return [{ id: '-', motivo: 'criterios.json sem lista "criterios"' }];
  if (lista.length === 0) return [{ id: '-', motivo: 'nenhum critério definido' }];
  const out = [];
  for (const c of lista) {
    if (c.status !== 'passou') out.push({ id: c.id, motivo: `status "${c.status ?? 'pendente'}"` });
    else if (!c.evidencia || !String(c.evidencia).trim()) out.push({ id: c.id, motivo: 'passou sem evidência registrada' });
  }
  return out;
}
```

`scripts/lib/eventos.mjs`:

```js
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { nabucoHome, lerAtiva } from './caminhos.mjs';

export function detectarHarness(payload = {}) {
  if (process.env.NABUCO_HARNESS) return process.env.NABUCO_HARNESS;
  if (process.env.CLAUDECODE || process.env.CLAUDE_PROJECT_DIR) return 'claude';
  if (payload.turn_id || process.env.CODEX_HOME || process.env.CODEX_SANDBOX) return 'codex';
  return 'desconhecido';
}

export function registrar({ tipo, papel = null, dados = {}, projeto, harness }) {
  const ativa = lerAtiva(projeto);
  const ev = {
    ts: new Date().toISOString(),
    tarefa: ativa?.nome ?? null,
    projeto: basename(projeto),
    harness: harness ?? detectarHarness(),
    tipo,
    papel,
    dados,
  };
  const linha = JSON.stringify(ev) + '\n';
  if (ativa) appendFileSync(join(ativa.dir, 'eventos.jsonl'), linha);
  const home = nabucoHome();
  mkdirSync(home, { recursive: true });
  appendFileSync(join(home, 'historico.jsonl'), linha);
  return ev;
}
```

- [ ] **Step 4: Implementar `scripts/tarefa.mjs`**

```js
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { acharProjeto, dirTarefas, lerAtiva, escreverAtiva, limparAtiva } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { pendencias } from './lib/criterios.mjs';
import { registrar } from './lib/eventos.mjs';
import { TAMANHOS, TIPOS, FASES } from './lib/constantes.mjs';

class ErroUso extends Error {}
class ErroRegra extends Error {}

const projeto = acharProjeto(process.cwd());
const [comando, ...resto] = process.argv.slice(2);

function opcoes(spec) {
  try {
    return parseArgs({ args: resto, options: spec, allowPositionals: true });
  } catch (e) { throw new ErroUso(e.message); }
}
function exigir(v, nome) { if (!v || !String(v).trim()) throw new ErroUso(`falta --${nome}`); return v; }
function exigirAtiva() {
  const a = lerAtiva(projeto);
  if (!a) throw new ErroRegra('nenhuma tarefa ativa neste projeto (rode "nova")');
  return a;
}
function slugify(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
}
const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local
const agora = () => new Date().toISOString();
const ler = (a, f) => lerJson(join(a.dir, f));
const gravar = (a, f, d) => escreverJson(join(a.dir, f), d);

function mudarFase(a, fase, motivo) {
  const estado = ler(a, 'estado.json');
  const de = estado.fase;
  estado.fase = fase;
  gravar(a, 'estado.json', estado);
  registrar({ tipo: 'fase', dados: { de, para: fase, ...(motivo ? { motivo } : {}) }, projeto });
}

const comandos = {
  nova() {
    const { values: v } = opcoes({ slug: { type: 'string' }, tamanho: { type: 'string' }, tipo: { type: 'string' } });
    const slug = slugify(exigir(v.slug, 'slug'));
    if (!slug) throw new ErroUso('slug vazio depois de normalizar; use letras ou números');
    if (!TAMANHOS.includes(v.tamanho)) throw new ErroUso(`--tamanho deve ser: ${TAMANHOS.join(', ')}`);
    if (!TIPOS.includes(v.tipo)) throw new ErroUso(`--tipo deve ser: ${TIPOS.join(', ')}`);
    const atual = lerAtiva(projeto);
    if (atual) throw new ErroRegra(`já existe uma tarefa ativa: ${atual.nome} (conclua ou rode "abandonar")`);
    let nome = `${hoje()}-${slug}`;
    for (let i = 2; existsSync(join(dirTarefas(projeto), nome)); i++) nome = `${hoje()}-${slug}-${i}`;
    const dir = join(dirTarefas(projeto), nome);
    mkdirSync(dir, { recursive: true });
    escreverJson(join(dir, 'estado.json'), { slug, tamanho: v.tamanho, tipo: v.tipo, fase: 'planejando', criada: agora() });
    escreverJson(join(dir, 'criterios.json'), { tarefa: nome, criterios: [] });
    writeFileSync(join(dir, 'plano.md'), `# Plano — ${slug}\n\n## Objetivo\n\n## Método\n\n## Restrições\n\n## Validação\n`);
    writeFileSync(join(dir, 'progresso.md'),
      `# Progresso — ${slug}\n\n## Estado atual\nPlanejando.\n\n## Próximo passo\nEscrever o plano e os critérios.\n\n## Decisões\n\n## Log\n- ${agora()} tarefa criada (${v.tamanho}, ${v.tipo})\n`);
    writeFileSync(join(dir, 'eventos.jsonl'), '');
    escreverAtiva(projeto, nome);
    registrar({ tipo: 'tarefa_criada', dados: { tamanho: v.tamanho, tipo: v.tipo }, projeto });
    console.log(dir);
  },

  'criterio-add'() {
    const { values: v } = opcoes({ id: { type: 'string' }, descricao: { type: 'string' }, verificacao: { type: 'string' } });
    const a = exigirAtiva();
    const c = ler(a, 'criterios.json');
    const id = exigir(v.id, 'id');
    if (c.criterios.some(x => x.id === id)) throw new ErroRegra(`critério "${id}" já existe`);
    c.criterios.push({ id, descricao: exigir(v.descricao, 'descricao'), verificacao: exigir(v.verificacao, 'verificacao'), status: 'pendente', evidencia: '', em: null });
    gravar(a, 'criterios.json', c);
    registrar({ tipo: 'criterio', dados: { id, acao: 'criado' }, projeto });
    console.log(`critério ${id} adicionado`);
  },

  criterio() {
    const { values: v } = opcoes({ id: { type: 'string' }, status: { type: 'string' }, evidencia: { type: 'string' } });
    const id = exigir(v.id, 'id');
    if (!['passou', 'falhou', 'pendente'].includes(v.status)) throw new ErroUso('--status deve ser: passou, falhou, pendente');
    if (v.status === 'passou' && !(v.evidencia ?? '').trim()) throw new ErroUso('--status passou exige --evidencia com a saída do comando');
    const a = exigirAtiva();
    const c = ler(a, 'criterios.json');
    const item = c.criterios.find(x => x.id === id);
    if (!item) throw new ErroRegra(`critério "${id}" não existe`);
    Object.assign(item, { status: v.status, evidencia: v.evidencia ?? '', em: agora() });
    gravar(a, 'criterios.json', c);
    registrar({ tipo: 'criterio', dados: { id, status: v.status }, projeto });
    console.log(`critério ${id}: ${v.status}`);
  },

  aprovar() {
    const a = exigirAtiva();
    registrar({ tipo: 'plano_aprovado', projeto });
    const estado = ler(a, 'estado.json');
    estado.fase = 'executando';
    gravar(a, 'estado.json', estado);
    console.log('plano aprovado; fase: executando');
  },

  fase() {
    const { values: v, positionals: [fase] } = opcoes({ motivo: { type: 'string' } });
    if (!FASES.includes(fase) || fase === 'concluida' || fase === 'abandonada') {
      throw new ErroUso(`fase inválida; use: ${FASES.filter(f => f !== 'concluida' && f !== 'abandonada').join(', ')} (para encerrar use "concluir" ou "abandonar")`);
    }
    mudarFase(exigirAtiva(), fase, v.motivo);
    console.log(`fase: ${fase}`);
  },

  log() {
    const { values: v } = opcoes({ texto: { type: 'string' } });
    const a = exigirAtiva();
    appendFileSync(join(a.dir, 'progresso.md'), `- ${agora()} ${exigir(v.texto, 'texto')}\n`);
    console.log('registrado no progresso.md');
  },

  concluir() {
    const a = exigirAtiva();
    const p = pendencias(ler(a, 'criterios.json'));
    if (p.length) throw new ErroRegra('não é possível concluir — critérios sem evidência:\n' + p.map(x => `  - ${x.id}: ${x.motivo}`).join('\n'));
    const estado = ler(a, 'estado.json');
    estado.fase = 'concluida';
    gravar(a, 'estado.json', estado);
    registrar({ tipo: 'tarefa_fechada', projeto });
    limparAtiva(projeto);
    console.log(`tarefa ${a.nome} concluída`);
  },

  abandonar() {
    const { values: v } = opcoes({ motivo: { type: 'string' } });
    const a = exigirAtiva();
    const estado = ler(a, 'estado.json');
    estado.fase = 'abandonada';
    gravar(a, 'estado.json', estado);
    registrar({ tipo: 'tarefa_abandonada', dados: v.motivo ? { motivo: v.motivo } : {}, projeto });
    limparAtiva(projeto);
    console.log(`tarefa ${a.nome} abandonada`);
  },

  status() {
    const a = lerAtiva(projeto);
    if (!a) { console.log(JSON.stringify({ ativa: null })); return; }
    const c = ler(a, 'criterios.json');
    const p = pendencias(c);
    const lista = Array.isArray(c.criterios) ? c.criterios : [];
    console.log(JSON.stringify({
      ativa: a.nome, dir: a.dir, estado: ler(a, 'estado.json'),
      criterios: { total: lista.length, passou: lista.filter(x => x.status === 'passou' && String(x.evidencia ?? '').trim()).length, pendencias: lista.length ? p : [] },
    }, null, 2));
  },
};

try {
  const fn = comandos[comando];
  if (!fn) throw new ErroUso(`comando desconhecido "${comando ?? ''}". Comandos: ${Object.keys(comandos).join(', ')}`);
  fn();
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  process.exit(e instanceof ErroUso ? 2 : 1);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/tarefa.mjs scripts/lib/criterios.mjs scripts/lib/eventos.mjs tests/tarefa.test.mjs
git commit -m "feat: ciclo da tarefa em arquivos (tarefa.mjs) e registro de eventos"
```

---

### Task 4: Gate de evidência — hook Stop

**Files:**
- Create: `scripts/lib/gate.mjs`, `scripts/gate-evidencia.mjs`
- Test: `tests/gate.test.mjs`

**Interfaces:**
- Consumes: `pendencias` (Task 3), `registrar` (Task 3), `acharProjeto`, `lerAtiva`, `lerJson` (Task 1), `FASES_ATIVAS` (Task 1)
- Produces:
  - `decidirGate({estado, criterios, cmdTarefa: string}): {bloquear: boolean, pendencias: Array, motivo?: string}`
  - `scripts/gate-evidencia.mjs`: lê JSON do stdin (`{cwd?, stop_hook_active?, ...}`); sem bloqueio → exit 0 e stdout vazio; com bloqueio → stdout `{"decision":"block","reason":"..."}` + evento `gate_bloqueou`, exit 0.

- [ ] **Step 1: Escrever o teste que falha**

`tests/gate.test.mjs`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decidirGate } from '../scripts/lib/gate.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(RAIZ, 'scripts', 'gate-evidencia.mjs');
const TAREFA = join(RAIZ, 'scripts', 'tarefa.mjs');
let base, proj, home;

const env = () => ({ ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'teste' });
const tarefa = (...a) => spawnSync(process.execPath, [TAREFA, ...a], { cwd: proj, encoding: 'utf8', env: env() });
const gate = (payload, cwd = proj) => spawnSync(process.execPath, [GATE], { cwd, input: payload === undefined ? '' : JSON.stringify(payload), encoding: 'utf8', env: env() });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco gate-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('decidirGate: só bloqueia em executando/checando', () => {
  const crit = { criterios: [{ id: 'c1', status: 'pendente' }] };
  for (const fase of ['planejando', 'aguardando_aprovacao', 'aguardando_usuario', 'concluida']) {
    assert.equal(decidirGate({ estado: { fase, slug: 'x' }, criterios: crit, cmdTarefa: 'T' }).bloquear, false, fase);
  }
  const r = decidirGate({ estado: { fase: 'checando', slug: 'x' }, criterios: crit, cmdTarefa: 'T' });
  assert.equal(r.bloquear, true);
  assert.match(r.motivo, /c1: status "pendente"/);
  assert.match(r.motivo, /T concluir/);
  assert.match(r.motivo, /T fase aguardando_usuario/);
});

test('decidirGate: tudo passou mas não concluiu ainda bloqueia', () => {
  const r = decidirGate({ estado: { fase: 'executando', slug: 'x' }, criterios: { criterios: [{ id: 'c1', status: 'passou', evidencia: 'ok' }] }, cmdTarefa: 'T' });
  assert.equal(r.bloquear, true);
  assert.match(r.motivo, /todos os critérios passaram/);
});

test('hook: projeto sem nabuco → sai 0 sem saída', () => {
  const r = gate({ cwd: proj, hook_event_name: 'Stop' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hook: stdin vazio ou inválido → sai 0 sem saída', () => {
  assert.equal(gate(undefined).stdout, '');
  const r = spawnSync(process.execPath, [GATE], { cwd: proj, input: '{oops', encoding: 'utf8', env: env() });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});

test('hook: bloqueia tarefa executando com critério pendente, usando cwd do payload (pasta com espaço)', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  tarefa('aprovar');
  const sub = join(proj, 'src'); mkdirSync(sub);
  const r = gate({ cwd: sub, hook_event_name: 'Stop', stop_hook_active: false }, base);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /c1/);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const evs = readFileSync(join(proj, '.nabuco', 'tarefas', ativa, 'eventos.jsonl'), 'utf8');
  assert.match(evs, /"tipo":"gate_bloqueou"/);
});

test('hook: aguardando_usuario não bloqueia', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('aprovar');
  tarefa('fase', 'aguardando_usuario', '--motivo', 'pergunta');
  assert.equal(gate({ cwd: proj }).stdout, '');
});

test('hook: arquivos da tarefa corrompidos → não bloqueia, avisa no stderr', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('aprovar');
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  writeFileSync(join(proj, '.nabuco', 'tarefas', ativa, 'estado.json'), '{quebrado');
  const r = gate({ cwd: proj });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /gate ignorado/);
});

test('hook: pasta da tarefa apagada mas "ativa" ainda aponta → não bloqueia', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('aprovar');
  rmSync(join(proj, '.nabuco', 'tarefas'), { recursive: true, force: true });
  assert.ok(existsSync(join(proj, '.nabuco', 'ativa')));
  const r = gate({ cwd: proj });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/gate.mjs'`

- [ ] **Step 3: Implementar**

`scripts/lib/gate.mjs`:

```js
import { pendencias } from './criterios.mjs';
import { FASES_ATIVAS } from './constantes.mjs';

export function decidirGate({ estado, criterios, cmdTarefa }) {
  if (!FASES_ATIVAS.has(estado?.fase)) return { bloquear: false, pendencias: [] };
  const p = pendencias(criterios);
  const lista = p.length
    ? p.map(x => `- ${x.id}: ${x.motivo}`).join('\n')
    : '- todos os critérios passaram, mas a tarefa ainda não foi concluída';
  const motivo = [
    `[nabuco] A tarefa "${estado.slug}" está na fase "${estado.fase}" e o turno não pode terminar assim.`,
    lista,
    'Faça uma destas opções:',
    `1) rode os comandos de verificação, registre a evidência com \`${cmdTarefa} criterio --id <id> --status passou --evidencia "<saída>"\` e então \`${cmdTarefa} concluir\`;`,
    `2) se precisa de uma decisão do usuário, rode \`${cmdTarefa} fase aguardando_usuario --motivo "<pergunta>"\` e então pergunte.`,
  ].join('\n');
  return { bloquear: true, pendencias: p, motivo };
}
```

`scripts/gate-evidencia.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson } from './lib/json.mjs';
import { decidirGate } from './lib/gate.mjs';
import { registrar } from './lib/eventos.mjs';

function lerPayload() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

try {
  const payload = lerPayload();
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const ativa = lerAtiva(projeto);
  if (!ativa) process.exit(0);

  let estado, criterios;
  try {
    estado = lerJson(join(ativa.dir, 'estado.json'));
    criterios = lerJson(join(ativa.dir, 'criterios.json'));
  } catch (e) {
    process.stderr.write(`nabuco: não consegui ler a tarefa ativa (${e.message}); gate ignorado.\n`);
    process.exit(0);
  }

  const cmdTarefa = `node "${join(dirname(fileURLToPath(import.meta.url)), 'tarefa.mjs')}"`;
  const r = decidirGate({ estado, criterios, cmdTarefa });
  if (!r.bloquear) process.exit(0);

  registrar({ tipo: 'gate_bloqueou', dados: { fase: estado.fase, pendencias: r.pendencias }, projeto, harness: undefined });
  process.stdout.write(JSON.stringify({ decision: 'block', reason: r.motivo }) + '\n');
} catch (e) {
  process.stderr.write(`nabuco: erro interno no gate (${e.message}); gate ignorado.\n`);
  process.exit(0);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/gate-evidencia.mjs scripts/lib/gate.mjs tests/gate.test.mjs
git commit -m "feat: gate de evidência no hook Stop"
```

---

### Task 5: Eventos — CLI e hooks SubagentStart/SubagentStop

**Files:**
- Create: `scripts/evento.mjs`
- Test: `tests/evento.test.mjs`

**Interfaces:**
- Consumes: `registrar`, `detectarHarness` (Task 3), `acharProjeto`, `lerAtiva` (Task 1), `carregarModelos`, `configDe` (Task 2), `PAPEIS` (Task 1)
- Produces:
  - CLI: `node scripts/evento.mjs <tipo> [--papel P] [--dados '<json>']` → exit 0; `--dados` inválido → exit 2.
  - Hook: `node scripts/evento.mjs --hook` lendo payload do stdin:
    - `hook_event_name` `SubagentStart` → `agente_inicio`; `SubagentStop` → `agente_fim`; outros → ignora.
    - `papel` = `agent_type` sem prefixo `nabuco:`/`nabuco-` se estiver em `PAPEIS`; senão `null` e `dados.agente = agent_type`.
    - `dados`: `{ agent_id?, modelo?, effort? }`; em `agente_fim`, `duracao_ms` calculada a partir do último `agente_inicio` com mesmo `agent_id` no `eventos.jsonl` da tarefa ativa.
    - Sempre exit 0, nunca escreve no stdout.
  - `normalizarPapel(agentType: string|undefined): string|null` (exportada para teste)

- [ ] **Step 1: Escrever o teste que falha**

`tests/evento.test.mjs`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizarPapel } from '../scripts/evento.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const EV = join(RAIZ, 'scripts', 'evento.mjs');
const TAREFA = join(RAIZ, 'scripts', 'tarefa.mjs');
let base, proj, home;
const env = h => ({ ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: h ?? 'claude' });
const run = (args, input) => spawnSync(process.execPath, [EV, ...args], { cwd: proj, input: input ?? '', encoding: 'utf8', env: env() });
const hist = () => existsSync(join(home, 'historico.jsonl')) ? readFileSync(join(home, 'historico.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco ev-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('normalizarPapel', () => {
  assert.equal(normalizarPapel('nabuco:revisor'), 'revisor');
  assert.equal(normalizarPapel('nabuco-dev'), 'dev');
  assert.equal(normalizarPapel('dev'), 'dev');
  assert.equal(normalizarPapel('Explore'), null);
  assert.equal(normalizarPapel(undefined), null);
});

test('CLI: registra evento com papel e dados', () => {
  const r = run(['achado', '--papel', 'revisor', '--dados', '{"severidade":"alta"}']);
  assert.equal(r.status, 0, r.stderr);
  const [e] = hist();
  assert.equal(e.tipo, 'achado'); assert.equal(e.papel, 'revisor'); assert.deepEqual(e.dados, { severidade: 'alta' });
});

test('CLI: --dados inválido → exit 2', () => {
  assert.equal(run(['achado', '--dados', '{x']).status, 2);
  assert.equal(run([]).status, 2);
});

test('hook: início e fim com modelo do modelos.json e duração', () => {
  spawnSync(process.execPath, [TAREFA, 'nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug'], { cwd: proj, env: env() });
  const ini = run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'nabuco:revisor', agent_id: 'a1', cwd: proj }));
  assert.equal(ini.status, 0); assert.equal(ini.stdout, '');
  const fim = run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'nabuco:revisor', agent_id: 'a1', cwd: proj }));
  assert.equal(fim.status, 0);
  const [i, f] = hist().slice(-2);
  assert.equal(i.tipo, 'agente_inicio'); assert.equal(i.papel, 'revisor');
  assert.deepEqual([i.dados.modelo, i.dados.effort], ['opus', 'high']);
  assert.equal(f.tipo, 'agente_fim');
  assert.equal(typeof f.dados.duracao_ms, 'number');
  assert.ok(f.dados.duracao_ms >= 0);
});

test('hook: payloads incompletos, vazios ou inválidos nunca quebram', () => {
  for (const input of ['', '{', JSON.stringify({}), JSON.stringify({ hook_event_name: 'SubagentStop' }), JSON.stringify({ hook_event_name: 'Outro' })]) {
    const r = run(['--hook'], input);
    assert.equal(r.status, 0, `input ${input}`);
    assert.equal(r.stdout, '');
  }
  const semId = hist().find(e => e.tipo === 'agente_fim');
  assert.equal(semId.papel, null);
  assert.equal(semId.dados.duracao_ms, undefined);
});

test('hook: agente que não é do nabuco é registrado sem papel', () => {
  run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'z' }));
  const [e] = hist();
  assert.equal(e.papel, null); assert.equal(e.dados.agente, 'Explore');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/evento.mjs'`

- [ ] **Step 3: Implementar `scripts/evento.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { registrar, detectarHarness } from './lib/eventos.mjs';
import { carregarModelos, configDe } from './lib/modelos.mjs';
import { PAPEIS } from './lib/constantes.mjs';

const RAIZ_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPA = { SubagentStart: 'agente_inicio', SubagentStop: 'agente_fim' };

export function normalizarPapel(agentType) {
  if (!agentType) return null;
  const p = String(agentType).replace(/^nabuco[:-]/, '');
  return PAPEIS.includes(p) ? p : null;
}

function inicioCorrespondente(projeto, agentId) {
  const ativa = lerAtiva(projeto);
  if (!ativa || !agentId) return null;
  const arq = join(ativa.dir, 'eventos.jsonl');
  if (!existsSync(arq)) return null;
  const linhas = readFileSync(arq, 'utf8').trim().split('\n').reverse();
  for (const l of linhas) {
    try {
      const e = JSON.parse(l);
      if (e.tipo === 'agente_inicio' && e.dados?.agent_id === agentId) return e;
    } catch { /* linha corrompida: ignora */ }
  }
  return null;
}

function modoHook() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { payload = {}; }
  const tipo = MAPA[payload.hook_event_name];
  if (!tipo) return;
  const projeto = acharProjeto(payload.cwd || process.cwd());
  const harness = detectarHarness(payload);
  const papel = normalizarPapel(payload.agent_type);
  const dados = {};
  if (payload.agent_id) dados.agent_id = payload.agent_id;
  if (!papel && payload.agent_type) dados.agente = payload.agent_type;
  const cfg = papel ? configDe(carregarModelos(RAIZ_PLUGIN), harness === 'codex' ? 'codex' : 'claude', papel) : null;
  if (cfg) { dados.modelo = cfg.model ?? 'herdado'; dados.effort = cfg.effort; }
  if (tipo === 'agente_fim') {
    const ini = inicioCorrespondente(projeto, payload.agent_id);
    if (ini) dados.duracao_ms = Date.now() - Date.parse(ini.ts);
  }
  registrar({ tipo, papel, dados, projeto, harness });
}

function modoCli(argv) {
  const { values: v, positionals: [tipo] } = parseArgs({ args: argv, options: { papel: { type: 'string' }, dados: { type: 'string' } }, allowPositionals: true });
  if (!tipo) { console.error('uso: evento.mjs <tipo> [--papel P] [--dados JSON]'); process.exit(2); }
  let dados = {};
  if (v.dados) {
    try { dados = JSON.parse(v.dados); } catch { console.error('nabuco: --dados não é JSON válido'); process.exit(2); }
  }
  registrar({ tipo, papel: v.papel ?? null, dados, projeto: acharProjeto(process.cwd()) });
}

const executadoDireto = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executadoDireto) {
  const args = process.argv.slice(2);
  if (args[0] === '--hook') {
    try { modoHook(); } catch (e) { process.stderr.write(`nabuco: erro ao registrar evento (${e.message})\n`); }
    process.exit(0);
  }
  try { modoCli(args); } catch (e) { console.error(`nabuco: ${e.message}`); process.exit(2); }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/evento.mjs tests/evento.test.mjs
git commit -m "feat: registro de eventos por CLI e hooks de subagente"
```

---

### Task 6: `docs-atuais` — detector de versões + skill

**Files:**
- Create: `scripts/lib/versoes.mjs`, `scripts/versoes.mjs`, `skills/docs-atuais/SKILL.md`
- Test: `tests/versoes.test.mjs`

**Interfaces:**
- Consumes: `acharProjeto` (Task 1)
- Produces:
  - `detectarVersoes(projeto: string, pacotes: string[]): Record<string, {versao: string|null, fonte: string|null}>`
  - CLI `node scripts/versoes.mjs <pacote...>` → imprime o JSON acima; sem pacotes → exit 2.
  - Fontes suportadas, nesta ordem: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `Gemfile.lock`, `go.mod`, `pubspec.lock`, `poetry.lock`, `requirements.txt`, e por último `package.json` (faixa declarada, fonte `"package.json (faixa)"`).

- [ ] **Step 1: Escrever o teste que falha**

`tests/versoes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectarVersoes } from '../scripts/lib/versoes.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'versoes.mjs');
function projeto(arquivos) {
  const d = mkdtempSync(join(tmpdir(), 'nabuco vers-'));
  for (const [n, c] of Object.entries(arquivos)) writeFileSync(join(d, n), c);
  return d;
}

test('npm: lockfile vence package.json; scoped funciona', () => {
  const d = projeto({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', vite: '^7.0.0' } }),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/react': { version: '19.2.1' }, 'node_modules/@tanstack/query': { version: '6.1.0' } } }),
  });
  assert.deepEqual(detectarVersoes(d, ['react', '@tanstack/query', 'vite', 'nada']), {
    react: { versao: '19.2.1', fonte: 'package-lock.json' },
    '@tanstack/query': { versao: '6.1.0', fonte: 'package-lock.json' },
    vite: { versao: '^7.0.0', fonte: 'package.json (faixa)' },
    nada: { versao: null, fonte: null },
  });
  rmSync(d, { recursive: true, force: true });
});

test('pnpm, yarn, cargo, gemfile, go, pubspec, poetry, requirements', () => {
  const d = projeto({
    'pnpm-lock.yaml': "packages:\n  /zod@4.1.2:\n    resolution: {}\n  '@scope/pkg@1.0.0':\n    resolution: {}\n",
    'yarn.lock': '"lodash@^4.17.0":\n  version "4.17.21"\n',
    'Cargo.lock': '[[package]]\nname = "serde"\nversion = "1.0.228"\n',
    'Gemfile.lock': 'GEM\n  specs:\n    rails (8.1.0)\n',
    'go.mod': 'module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.11.0\n)\n',
    'pubspec.lock': 'packages:\n  http:\n    dependency: "direct main"\n    source: hosted\n    version: "1.5.0"\n',
    'poetry.lock': '[[package]]\nname = "django"\nversion = "5.2.1"\n',
    'requirements.txt': 'Flask==3.1.0\nrequests>=2\n',
  });
  const r = detectarVersoes(d, ['zod', '@scope/pkg', 'lodash', 'serde', 'rails', 'github.com/gin-gonic/gin', 'http', 'django', 'flask']);
  assert.equal(r.zod.versao, '4.1.2');
  assert.equal(r['@scope/pkg'].versao, '1.0.0');
  assert.equal(r.lodash.versao, '4.17.21');
  assert.equal(r.serde.versao, '1.0.228');
  assert.equal(r.rails.versao, '8.1.0');
  assert.equal(r['github.com/gin-gonic/gin'].versao, 'v1.11.0');
  assert.equal(r.http.versao, '1.5.0');
  assert.equal(r.django.versao, '5.2.1');
  assert.deepEqual(r.flask, { versao: '3.1.0', fonte: 'requirements.txt' });
  rmSync(d, { recursive: true, force: true });
});

test('lockfile corrompido não quebra; cai para a próxima fonte', () => {
  const d = projeto({ 'package-lock.json': '{quebrado', 'package.json': JSON.stringify({ devDependencies: { vitest: '~4.0.0' } }) });
  assert.deepEqual(detectarVersoes(d, ['vitest']).vitest, { versao: '~4.0.0', fonte: 'package.json (faixa)' });
  rmSync(d, { recursive: true, force: true });
});

test('CLI', () => {
  const d = projeto({ 'requirements.txt': 'fastapi==0.120.0\n' });
  const r = spawnSync(process.execPath, [CLI, 'fastapi'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).fastapi.versao, '0.120.0');
  assert.equal(spawnSync(process.execPath, [CLI], { cwd: d }).status, 2);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/lib/versoes.mjs'`

- [ ] **Step 3: Implementar**

`scripts/lib/versoes.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const normPy = s => s.toLowerCase().replace(/[-_.]+/g, '-');

const FONTES = [
  ['package-lock.json', (t, p) => { const j = JSON.parse(t); return j.packages?.[`node_modules/${p}`]?.version ?? j.dependencies?.[p]?.version; }],
  ['pnpm-lock.yaml', (t, p) => t.match(new RegExp(`^\\s+['"]?/?${esc(p)}@([^(:'"\\s]+)`, 'm'))?.[1]],
  ['yarn.lock', (t, p) => t.match(new RegExp(`^"?${esc(p)}@[^\\n]*\\n\\s+version:? "?([^"\\n]+)"?`, 'm'))?.[1]],
  ['Cargo.lock', (t, p) => t.match(new RegExp(`^name = "${esc(p)}"\\nversion = "([^"]+)"`, 'm'))?.[1]],
  ['Gemfile.lock', (t, p) => t.match(new RegExp(`^ {4}${esc(p)} \\(([^)]+)\\)`, 'm'))?.[1]],
  ['go.mod', (t, p) => t.match(new RegExp(`^\\s*(?:require\\s+)?${esc(p)}\\s+(v\\S+)`, 'm'))?.[1]],
  ['pubspec.lock', (t, p) => t.match(new RegExp(`^ {2}${esc(p)}:\\n(?: {4}.*\\n)*? {4}version: "([^"]+)"`, 'm'))?.[1]],
  ['poetry.lock', (t, p) => {
    for (const m of t.matchAll(/^name = "([^"]+)"\nversion = "([^"]+)"/gm)) if (normPy(m[1]) === normPy(p)) return m[2];
  }],
  ['requirements.txt', (t, p) => {
    for (const m of t.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s;#]+)/gm)) if (normPy(m[1]) === normPy(p)) return m[2];
  }],
];

function faixaPackageJson(projeto, p) {
  const f = join(projeto, 'package.json');
  if (!existsSync(f)) return undefined;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j.dependencies?.[p] ?? j.devDependencies?.[p] ?? j.peerDependencies?.[p];
  } catch { return undefined; }
}

export function detectarVersoes(projeto, pacotes) {
  const textos = {};
  for (const [nome] of FONTES) {
    const f = join(projeto, nome);
    if (existsSync(f)) textos[nome] = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  }
  const out = {};
  for (const p of pacotes) {
    out[p] = { versao: null, fonte: null };
    for (const [nome, extrair] of FONTES) {
      if (textos[nome] === undefined) continue;
      let v;
      try { v = extrair(textos[nome], p); } catch { v = undefined; }
      if (v) { out[p] = { versao: v, fonte: nome }; break; }
    }
    if (!out[p].versao) {
      const faixa = faixaPackageJson(projeto, p);
      if (faixa) out[p] = { versao: faixa, fonte: 'package.json (faixa)' };
    }
  }
  return out;
}
```

`scripts/versoes.mjs`:

```js
#!/usr/bin/env node
import { acharProjeto } from './lib/caminhos.mjs';
import { detectarVersoes } from './lib/versoes.mjs';

const pacotes = process.argv.slice(2);
if (!pacotes.length) {
  console.error('uso: versoes.mjs <pacote> [pacote...]');
  process.exit(2);
}
console.log(JSON.stringify(detectarVersoes(acharProjeto(process.cwd()), pacotes), null, 2));
```

- [ ] **Step 4: Escrever `skills/docs-atuais/SKILL.md`**

```markdown
---
name: docs-atuais
description: Consulta a documentação da versão INSTALADA de uma lib, framework ou ferramenta antes de usá-la. Use antes de escrever código que dependa de APIs de terceiros, ao migrar versões ou quando um erro sugerir mudança de API.
---

# docs-atuais — documentação da versão instalada

`NABUCO` = a pasta dois níveis acima do diretório desta skill (raiz do plugin nabuco).

## Passos
1. Liste os pacotes que a tarefa vai usar de forma não trivial.
2. Na raiz do projeto, rode:
   `node "$NABUCO/scripts/versoes.mjs" <pacote> [pacote...]`
   - `versao` exata vinda de lockfile → use essa versão.
   - `fonte: "package.json (faixa)"` → a versão real pode ser qualquer uma da faixa; diga isso.
   - `versao: null` → não está instalado; não presuma a versão — pergunte ou proponha no plano.
3. Busque a documentação **dessa versão**, nesta ordem de preferência:
   1. Um exemplo vivo no próprio repositório usando a mesma API.
   2. Documentação oficial versionada (URL com a versão, seletor de versão do site, docs no repositório na tag da versão).
   3. Ferramenta de docs disponível na sessão (ex.: MCP Context7), informando a versão.
   4. CHANGELOG / guia de migração entre a versão instalada e a que o seu conhecimento assume.
4. Se a API que você lembra mudou nessa versão, siga a documentação, não a memória.

## Entrega
Resuma em até 10 linhas: pacote@versão, APIs relevantes e como usá-las, armadilhas da versão, e os links consultados.
Nunca afirme que algo existe numa versão sem ter visto na fonte.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/versoes.mjs scripts/lib/versoes.mjs skills/docs-atuais tests/versoes.test.mjs
git commit -m "feat: docs-atuais com detecção de versões instaladas"
```

---

### Task 7: Setup e status — scripts

**Files:**
- Create: `scripts/setup.mjs`, `scripts/status.mjs`
- Test: `tests/setup-status.test.mjs`

**Interfaces:**
- Consumes: `construir`, `diferencas` (Task 2), `nabucoHome`, `acharProjeto`, `lerAtiva`, `lerJson`, `escreverJson` (Task 1), `pendencias` (Task 3)
- Produces:
  - `node scripts/setup.mjs [--codex auto|sim|nao] [--checadores-locais]`
    - checa Node ≥ 20 (exit 1 se menor);
    - cria `nabucoHome()`; se não houver `.git` lá e o `git` existir, roda `git init`; cria `config.json` `{ "versao": 1, "checadores_locais": false }` se não existir;
    - valida build (`construir` sem erros e `diferencas` vazio) — reporta, não aborta;
    - Codex: `auto` (padrão) instala se `CODEX_HOME` ou `~/.codex` existir; `sim` sempre; `nao` nunca. Copia `codex-agents/*.toml` para `<CODEX_HOME|~/.codex>/agents/`;
    - `--checadores-locais`: copia `agents/{arquiteto,revisor,seguranca,tester}.md` para `<CLAUDE_CONFIG_DIR|~/.claude>/agents/nabuco-<papel>.md` trocando a linha `name: <papel>` por `name: nabuco-<papel>`, e grava `checadores_locais: true` no `config.json`;
    - imprime relatório com linhas `✅`/`⚠️`; exit 0 (exceto Node antigo).
  - `node scripts/status.mjs` → relatório texto: tabela de papéis (modelo/effort Claude e Codex), erros de configuração, build atualizado?, `~/.nabuco` existe?, agentes Codex instalados e iguais aos do plugin?, `checadores_locais`, tarefa ativa no cwd (nome, fase, critérios passou/total).

- [ ] **Step 1: Escrever o teste que falha**

`tests/setup-status.test.mjs`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, env;
const run = (script, args = [], cwd = base) => spawnSync(process.execPath, [join(RAIZ, 'scripts', script), ...args], { cwd, encoding: 'utf8', env });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco setup-'));
  env = { ...process.env, NABUCO_HOME: join(base, 'nabuco'), CODEX_HOME: join(base, 'codex'), CLAUDE_CONFIG_DIR: join(base, 'claude'), NABUCO_HARNESS: 'teste' };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('setup: cria home com git e config; Codex auto sem pasta não instala', () => {
  const r = run('setup.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(base, 'nabuco', '.git')));
  assert.deepEqual(JSON.parse(readFileSync(join(base, 'nabuco', 'config.json'), 'utf8')), { versao: 1, checadores_locais: false });
  assert.ok(!existsSync(join(base, 'codex', 'agents')));
  assert.match(r.stdout, /✅ configuração dos funcionários válida/);
  assert.match(r.stdout, /Codex não encontrado/);
});

test('setup --codex sim instala os 9 TOMLs; rodar de novo é idempotente', () => {
  assert.equal(run('setup.mjs', ['--codex', 'sim']).status, 0);
  assert.equal(readdirSync(join(base, 'codex', 'agents')).filter(f => f.startsWith('nabuco-')).length, 9);
  const r = run('setup.mjs', ['--codex', 'sim']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\/hooks/); // lembrete de confiar nos hooks
});

test('setup --checadores-locais copia 4 agentes renomeados e marca config', () => {
  assert.equal(run('setup.mjs', ['--checadores-locais']).status, 0);
  const dir = join(base, 'claude', 'agents');
  assert.deepEqual(readdirSync(dir).sort(), ['nabuco-arquiteto.md', 'nabuco-revisor.md', 'nabuco-seguranca.md', 'nabuco-tester.md']);
  assert.match(readFileSync(join(dir, 'nabuco-revisor.md'), 'utf8'), /^---\nname: nabuco-revisor\n/);
  assert.equal(JSON.parse(readFileSync(join(base, 'nabuco', 'config.json'), 'utf8')).checadores_locais, true);
});

test('setup: --codex com valor inválido → exit 2', () => {
  assert.equal(run('setup.mjs', ['--codex', 'talvez']).status, 2);
});

test('status: mostra papéis, estado da instalação e tarefa ativa', () => {
  run('setup.mjs', ['--codex', 'sim']);
  const proj = join(base, 'Nova pasta'); mkdirSync(join(proj, '.git'), { recursive: true });
  spawnSync(process.execPath, [join(RAIZ, 'scripts', 'tarefa.mjs'), 'nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug'], { cwd: proj, env });
  const r = run('status.mjs', [], proj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /revisor\s+opus\/high\s+gpt-6-astra\/high/);
  assert.match(r.stdout, /dev\s+inherit\/high\s+\(sessão\)\/high/);
  assert.match(r.stdout, /✅ agentes do Codex instalados e atualizados \(9\)/);
  assert.match(r.stdout, /Tarefa ativa: \d{4}-\d{2}-\d{2}-x · fase planejando · critérios 0\/0/);
});

test('status sem setup avisa', () => {
  const r = run('status.mjs');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /⚠️ .*rode o setup/);
  assert.match(r.stdout, /Nenhuma tarefa ativa/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module` / exit code de script inexistente

- [ ] **Step 3: Implementar `scripts/setup.mjs`**

```js
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nabucoHome } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { construir, diferencas } from './lib/build.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECADORES = ['arquiteto', 'revisor', 'seguranca', 'tester'];
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

let v;
try {
  ({ values: v } = parseArgs({ options: { codex: { type: 'string', default: 'auto' }, 'checadores-locais': { type: 'boolean', default: false } } }));
} catch (e) { console.error(`nabuco: ${e.message}`); process.exit(2); }
if (!['auto', 'sim', 'nao'].includes(v.codex)) { console.error('nabuco: --codex deve ser auto, sim ou nao'); process.exit(2); }

const ok = m => console.log(`✅ ${m}`);
const aviso = m => console.log(`⚠️ ${m}`);

// 1. Node
const maior = Number(process.versions.node.split('.')[0]);
if (maior < 20) { console.error(`❌ Node ${process.versions.node} — o nabuco precisa de Node 20 ou mais novo.`); process.exit(1); }
ok(`Node ${process.versions.node}`);

// 2. ~/.nabuco
const home = nabucoHome();
mkdirSync(home, { recursive: true });
if (!existsSync(join(home, '.git'))) {
  const g = spawnSync('git', ['init', '-q'], { cwd: home });
  if (g.status === 0) ok(`histórico versionado: git iniciado em ${home}`);
  else aviso(`git não disponível; ${home} ficará sem versionamento`);
} else ok(`pasta do nabuco: ${home}`);
const arqConfig = join(home, 'config.json');
const config = existsSync(arqConfig) ? lerJson(arqConfig) : { versao: 1, checadores_locais: false };

// 3. build
const { arquivos, erros } = construir(RAIZ);
if (erros.length) aviso('configuração dos funcionários com erros:\n' + erros.map(e => '   - ' + e).join('\n'));
else ok('configuração dos funcionários válida');
const dif = diferencas(RAIZ, arquivos);
if (dif.length) aviso(`agentes gerados desatualizados (${dif.length}); rode "npm run build" no plugin`);

// 4. Codex
const instalarCodex = v.codex === 'sim' || (v.codex === 'auto' && existsSync(codexHome()));
if (instalarCodex) {
  const destino = join(codexHome(), 'agents');
  mkdirSync(destino, { recursive: true });
  const tomls = readdirSync(join(RAIZ, 'codex-agents')).filter(f => f.endsWith('.toml'));
  for (const f of tomls) copyFileSync(join(RAIZ, 'codex-agents', f), join(destino, f));
  ok(`${tomls.length} agentes do Codex instalados em ${destino}`);
  aviso('no Codex, rode /hooks e confie nos hooks do nabuco (necessário a cada atualização do plugin)');
} else if (v.codex === 'auto') {
  console.log('ℹ️ Codex não encontrado; pulei os agentes do Codex (use --codex sim para forçar)');
}

// 5. checadores locais (fallback de restrição de ferramentas no Claude Code)
if (v['checadores-locais']) {
  const destino = join(claudeHome(), 'agents');
  mkdirSync(destino, { recursive: true });
  for (const p of CHECADORES) {
    const txt = readFileSync(join(RAIZ, 'agents', p + '.md'), 'utf8').replace(/^name: .*$/m, `name: nabuco-${p}`);
    writeFileSync(join(destino, `nabuco-${p}.md`), txt);
  }
  config.checadores_locais = true;
  ok(`checadores instalados como agentes locais em ${destino} (nabuco-<papel>)`);
}

escreverJson(arqConfig, config);
console.log('\nSetup concluído.');
```

- [ ] **Step 4: Implementar `scripts/status.mjs`**

```js
#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nabucoHome, acharProjeto, lerAtiva } from './lib/caminhos.mjs';
import { lerJson } from './lib/json.mjs';
import { construir, diferencas } from './lib/build.mjs';
import { pendencias } from './lib/criterios.mjs';
import { detectarHarness } from './lib/eventos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
const ok = m => console.log(`✅ ${m}`);
const aviso = m => console.log(`⚠️ ${m}`);

console.log(`nabuco · harness: ${detectarHarness()}\n`);

let modelos = null;
try { modelos = lerJson(join(RAIZ, 'modelos.json')); } catch (e) { aviso(`modelos.json ilegível: ${e.message}`); }
const { papeis, arquivos, erros } = construir(RAIZ);
const fmt = c => c ? `${c.model ?? '(sessão)'}/${c.effort}` : '—';
console.log('Papel        Claude              Codex');
for (const p of papeis) console.log(`${p.padEnd(12)} ${fmt(modelos?.claude?.[p]).padEnd(19)} ${fmt(modelos?.codex?.[p])}`);
console.log('');

if (erros.length) aviso('erros de configuração:\n' + erros.map(e => '   - ' + e).join('\n'));
else ok('configuração dos funcionários válida');
const dif = diferencas(RAIZ, arquivos);
if (dif.length) aviso(`agentes gerados desatualizados: ${dif.join(', ')}`);

const home = nabucoHome();
let config = null;
if (!existsSync(join(home, 'config.json'))) aviso(`${home} não configurado — rode o setup (/nabuco:setup ou $setup)`);
else { config = lerJson(join(home, 'config.json')); ok(`pasta do nabuco: ${home}`); }

const destCodex = join(codexHome(), 'agents');
const tomls = readdirSync(join(RAIZ, 'codex-agents')).filter(f => f.endsWith('.toml'));
const instalados = existsSync(destCodex) ? tomls.filter(f => existsSync(join(destCodex, f))) : [];
if (instalados.length === tomls.length && instalados.every(f => readFileSync(join(destCodex, f), 'utf8') === readFileSync(join(RAIZ, 'codex-agents', f), 'utf8'))) {
  ok(`agentes do Codex instalados e atualizados (${tomls.length})`);
} else if (instalados.length) aviso(`agentes do Codex desatualizados ou incompletos (${instalados.length}/${tomls.length}) — rode o setup`);
else console.log('ℹ️ agentes do Codex não instalados');
if (config?.checadores_locais) console.log('ℹ️ checadores rodando como agentes locais (nabuco-<papel>)');

const projeto = acharProjeto(process.cwd());
const ativa = lerAtiva(projeto);
if (!ativa) { console.log('\nNenhuma tarefa ativa neste projeto.'); process.exit(0); }
try {
  const estado = lerJson(join(ativa.dir, 'estado.json'));
  const crit = lerJson(join(ativa.dir, 'criterios.json'));
  const lista = Array.isArray(crit.criterios) ? crit.criterios : [];
  const passou = lista.length - (lista.length ? pendencias(crit).length : 0);
  console.log(`\nTarefa ativa: ${ativa.nome} · fase ${estado.fase} · critérios ${passou}/${lista.length}`);
} catch (e) {
  aviso(`tarefa ativa ${ativa.nome} com arquivos ilegíveis: ${e.message}`);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/setup.mjs scripts/status.mjs tests/setup-status.test.mjs
git commit -m "feat: scripts de setup e status"
```

---

### Task 8: Skills do Gerente — `tarefa`, `setup`, `status`

**Files:**
- Create: `skills/tarefa/SKILL.md`, `skills/setup/SKILL.md`, `skills/status/SKILL.md`
- Test: `tests/skills.test.mjs`

**Interfaces:**
- Consumes: CLIs `tarefa.mjs`, `evento.mjs`, `setup.mjs`, `status.mjs` (Tasks 3, 5, 7); agentes `nabuco:<papel>` / `nabuco-<papel>` (Task 2)
- Produces: skills invocáveis como `/nabuco:tarefa`, `/nabuco:setup`, `/nabuco:status` (Claude) e `$tarefa`, `$setup`, `$status` (Codex)

- [ ] **Step 1: Escrever o teste que falha**

`tests/skills.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERMITIDOS = new Set(['name', 'description', 'license', 'metadata', 'allowed-tools', 'compatibility']);
const skills = readdirSync(join(RAIZ, 'skills'));

test('skills da Fase 1 existem', () => {
  for (const s of ['tarefa', 'setup', 'status', 'docs-atuais']) assert.ok(skills.includes(s), s);
});

for (const s of skills) {
  test(`skill ${s}: frontmatter no padrão aberto`, () => {
    const arq = join(RAIZ, 'skills', s, 'SKILL.md');
    assert.ok(existsSync(arq));
    const { dados } = parseFrontmatter(readFileSync(arq, 'utf8'));
    assert.equal(dados.name, s);
    assert.ok(dados.description && dados.description.length <= 1024);
    for (const k of Object.keys(dados)) assert.ok(PERMITIDOS.has(k), `campo não portável "${k}" em ${s}`);
  });
}

test('tarefa: cobre os comandos do CLI e as regras-chave', () => {
  const t = readFileSync(join(RAIZ, 'skills', 'tarefa', 'SKILL.md'), 'utf8');
  for (const c of ['nova', 'criterio-add', 'aprovar', 'criterio --id', 'fase aguardando_usuario', 'fase checando', 'concluir', 'abandonar', 'status', 'log --texto']) {
    assert.ok(t.includes(c), `faltou "${c}"`);
  }
  assert.match(t, /nabuco:<papel>/);
  assert.match(t, /nabuco-<papel>/);
  assert.match(t, /checadores_locais/);
  assert.match(t, /no máximo 2 rodadas/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `skills da Fase 1 existem` (faltam tarefa/setup/status)

- [ ] **Step 3: Escrever `skills/tarefa/SKILL.md`**

```markdown
---
name: tarefa
description: Gerente do time nabuco. Use quando o usuário pedir para executar uma tarefa de desenvolvimento com o time (/nabuco:tarefa ou $tarefa); sem argumentos, retoma a tarefa ativa do projeto.
---

# Gerente — time nabuco

Você é o **Gerente**. Coordena o time e garante evidência. **Você não edita código de produto** — só arquivos dentro de `.nabuco/`.

`NABUCO` = a pasta dois níveis acima do diretório desta skill (raiz do plugin).
`T` = `node "$NABUCO/scripts/tarefa.mjs"` · `E` = `node "$NABUCO/scripts/evento.mjs"` — rode sempre a partir da raiz do projeto.

## 0. Retomar
Sem descrição de tarefa: rode `T status`. Havendo tarefa ativa, leia `progresso.md` e continue do "Próximo passo" (se a fase for `aguardando_usuario`, refaça a pergunta). Sem tarefa ativa, peça a descrição.

## 1. Classificar
| Tamanho | Quando | Processo |
|---|---|---|
| `trivial` | cabe numa frase, sem comportamento sensível | sem plano, sem checadores |
| `media` | feature ou bug normal | plano curto + Revisor |
| `sensivel` | auth, pagamento, dados pessoais, migrations, infra, API pública | plano com checkpoints por fase + Revisor, Segurança e Tester |

Tipo → escritor: `bug` → debugger · `ui` → designer · `infra` → devops · `docs` → docs · `feature`/`refactor` → dev · `estrutural` → consulte o arquiteto antes de planejar, depois dev.
Se o usuário forçar um tamanho, obedeça. Rode: `T nova --slug <curto> --tamanho <t> --tipo <tipo>` (imprime a pasta da tarefa).

## 2. Entender
Leia o código relevante. Para libs envolvidas, use a skill `docs-atuais`. Em `trivial`, seja breve.

## 3. Planejar
- `media`/`sensivel`: preencha `plano.md` (Objetivo, Método, Restrições, Validação; até ~40 linhas).
- Todos os tamanhos: cada critério precisa de um comando que o prove:
  `T criterio-add --id c1 --descricao "<o que>" --verificacao "<comando>"`
- `trivial`: crie os critérios e rode `T aprovar` direto.
- `media`/`sensivel`: rode `T fase aguardando_aprovacao`, mostre plano + critérios e **pare**. Só após um "ok" explícito: `T aprovar`.
- `sensivel`: divida o plano em fases; ao fim de cada fase, `T fase aguardando_usuario --motivo "checkpoint fase N"` e peça ok.

## 4. Executar — um escritor por vez
- Claude Code: subagente `nabuco:<papel>`. Codex: agente `nabuco-<papel>`.
- Mensagem ao escritor: caminho da pasta da tarefa, "leia plano.md, criterios.json e progresso.md", e o passo exato a fazer agora.
- Ao receber a entrega: atualize `progresso.md` (Estado atual, Próximo passo, Decisões com autor) e `T log --texto "<resumo>"`.
- **Você mesmo** roda o comando de verificação de cada critério e registra:
  `T criterio --id c1 --status passou --evidencia "<saída resumida>"` (ou `--status falhou`).
  Nunca marque `passou` sem ter rodado o comando nesta tarefa.

## 5. Checar — por risco
- `trivial`: pule. `media`: revisor. `sensivel`: revisor, seguranca e tester **em paralelo**.
- Rode `T fase checando`. Entregue a cada checador só: o `git diff` da tarefa, o plano e os critérios — nada do histórico. Instrução fixa: "reporte só o que afeta corretude, segurança ou os critérios; sem nada relevante, responda 'nada a reportar'".
- Claude Code: se `~/.nabuco/config.json` tiver `"checadores_locais": true`, use `nabuco-<papel>` em vez de `nabuco:<papel>`.
- Codex: depois de cada checador, rode `git status --porcelain` — se um checador alterou arquivos, mostre ao usuário antes de seguir.
- Registre cada achado: `E achado --papel <papel> --dados '{"severidade":"alta|media|baixa","resumo":"..."}'`.
- Filtre os achados; mande o escritor corrigir (`E rodada_correcao --papel <escritor>`) e volte a `T fase executando`.
- **No máximo 2 rodadas** de correção; persistindo divergência, `T fase aguardando_usuario --motivo "<divergência>"` e peça a decisão do usuário.

## 6. Gate de evidência
- API pública mudou? Chame o escritor `docs` antes de concluir.
- Rode `T concluir`. Se recusar, resolva o que falta (verificar, corrigir ou perguntar). O hook do nabuco também impede encerrar o turno nas fases `executando`/`checando` sem concluir.

## 7. Fechar
Resumo ao usuário: o que mudou, critérios com evidência, achados relevantes e decisões. Commit só se o usuário pedir.

## Sempre
- Antes de fazer qualquer pergunta ao usuário durante a execução: `T fase aguardando_usuario --motivo "<pergunta>"`; ao retomar: `T fase executando`.
- Para desistir: `T abandonar --motivo "<por quê>"`.
- Proibido para todo o time: tocar produção, push, deploy, commit sem pedido, dependência fora do plano aprovado.
```

- [ ] **Step 4: Escrever `skills/setup/SKILL.md`**

```markdown
---
name: setup
description: Configura o time nabuco nesta máquina - cria ~/.nabuco, instala agentes do Codex, valida a configuração e testa se os checadores ficam mesmo sem permissão de escrita. Use uma vez após instalar ou atualizar o plugin (/nabuco:setup ou $setup).
---

# Setup do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Rode `node "$NABUCO/scripts/setup.mjs"` e mostre o relatório ao usuário.
2. **Só no Claude Code** — teste se o checador fica sem ferramentas de escrita:
   - Peça ao subagente `nabuco:revisor`: "Crie o arquivo `.nabuco-teste-ferramentas.txt` na raiz do projeto com o texto `x`. Se você não tiver ferramenta para isso, responda exatamente SEM-FERRAMENTA."
   - Se o arquivo **existir** depois: apague-o, rode `node "$NABUCO/scripts/setup.mjs" --checadores-locais` e explique ao usuário que os checadores passaram a rodar como agentes locais `nabuco-<papel>` (a restrição de ferramentas não vale para agentes de plugin nesta versão).
   - Se **não existir**: informe que a restrição funciona.
3. **No Codex**: lembre o usuário de rodar `/hooks` e confiar nos hooks do nabuco, e que no Codex os checadores ficam sem escrita só por instrução (o Gerente confere `git status` depois deles).
4. Termine rodando a skill `status`.
```

- [ ] **Step 5: Escrever `skills/status/SKILL.md`**

```markdown
---
name: status
description: Mostra o estado do time nabuco - modelo e effort de cada funcionário em Claude e Codex, problemas de configuração, instalação e a tarefa ativa do projeto. Use com /nabuco:status ou $status.
---

# Status do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

Rode, na raiz do projeto, `node "$NABUCO/scripts/status.mjs"` e mostre a saída ao usuário sem resumir a tabela.
Se houver linhas com ⚠️, explique em uma frase cada uma e o comando que resolve.
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add skills/tarefa skills/setup skills/status tests/skills.test.mjs
git commit -m "feat: skills do Gerente (tarefa), setup e status"
```

---

### Task 9: Skills de design — `design-web` e `design-mobile`

**Files:**
- Create: `skills/design-web/SKILL.md`, `skills/design-web/NOTICE`, `skills/design-mobile/SKILL.md`, `skills/design-mobile/checklist.md`
- Modify: `tests/skills.test.mjs` (acrescentar teste)

**Interfaces:**
- Consumes: papel Designer (Task 2) referencia estas skills pelo nome.
- Produces: skills `design-web` e `design-mobile`.

- [ ] **Step 1: Acrescentar o teste que falha ao fim de `tests/skills.test.mjs`**

```js
test('skills de design: existem, têm checklist e crédito', () => {
  const web = readFileSync(join(RAIZ, 'skills', 'design-web', 'SKILL.md'), 'utf8');
  assert.match(web, /## Autocrítica/);
  assert.match(web, /4\.5:1/);
  assert.ok(existsSync(join(RAIZ, 'skills', 'design-web', 'NOTICE')));
  const mob = readFileSync(join(RAIZ, 'skills', 'design-mobile', 'SKILL.md'), 'utf8');
  assert.match(mob, /checklist\.md/);
  const chk = readFileSync(join(RAIZ, 'skills', 'design-mobile', 'checklist.md'), 'utf8');
  for (const item of ['44', '48', 'safe area', 'VoiceOver', 'TalkBack', 'modo escuro']) assert.ok(chk.toLowerCase().includes(item.toLowerCase()), item);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `ENOENT ... skills/design-web/SKILL.md`

- [ ] **Step 3: Escrever `skills/design-web/SKILL.md`**

```markdown
---
name: design-web
description: Direção de design para interfaces web com qualidade de produto - tokens antes do código, estados completos, acessibilidade e autocrítica com screenshot, evitando a aparência genérica de interface gerada por IA. Use ao criar ou alterar telas, componentes ou estilos web.
---

# design-web

## 1. Contexto primeiro
- Quem usa, para quê, em que dispositivo? Qual o tom (sóbrio, lúdico, técnico, editorial)?
- **Se o projeto já tem design system/tema/tokens, eles mandam.** Reuse componentes existentes; não crie variações paralelas.

## 2. Direção estética explícita
Escreva em 2–3 linhas a direção escolhida (referências, tipografia, paleta, densidade) antes de codar. Uma direção clara e coerente vale mais que efeitos.

## 3. Tokens antes do código
Defina como variáveis (CSS custom properties ou tema do framework): cores (com pares texto/fundo), escala tipográfica, espaçamento (escala fixa, ex. 4/8), raios, sombras, durações de animação. Nada de valores soltos espalhados.

## 4. Implementação
- Estados: padrão, hover, foco visível, ativo, desabilitado, carregando, vazio, erro.
- Responsivo do menor ao maior breakpoint; sem rolagem horizontal; alvos de toque ≥ 44px em telas de toque.
- HTML semântico (botão é `button`, link é `a`), labels em formulários, `alt` útil.
- Contraste mínimo 4.5:1 para texto normal (3:1 para texto grande e componentes de UI).
- Respeite `prefers-reduced-motion` e `prefers-color-scheme` quando houver tema escuro.

## 5. Evite a "cara de IA"
Gradiente roxo-azul genérico, emojis no lugar de ícones, todos os cards iguais e centralizados, sombras pesadas em tudo, texto de marketing vazio, ícones de bibliotecas misturadas, bordas arredondadas exageradas sem critério.

## 6. Ferramentas opcionais (use se estiverem disponíveis na sessão)
- Plugin Figma (design → código, código → design).
- `ui-ux-pro-max` (base de estilos, paletas e regras por setor).
- `chrome-devtools-mcp:a11y-debugging` e screenshots do Chrome DevTools.

## Autocrítica
Antes de entregar, gere screenshot (desktop e mobile) e confira:
1. A hierarquia visual leva o olho ao que importa primeiro?
2. Espaçamentos e alinhamentos seguem a escala de tokens?
3. Todos os estados existem e foram vistos?
4. Contraste e foco visível passam?
5. Parece com o resto do produto (ou com a direção escolhida)?
Corrija o que falhar e só então entregue, anexando os screenshots como evidência.
```

`skills/design-web/NOTICE`:

```
design-web (nabuco)
Texto original do projeto nabuco. Inspirado nos princípios da skill "frontend-design"
publicada pela Anthropic (https://github.com/anthropics/skills, licença Apache 2.0).
Nenhum conteúdo daquela skill foi copiado.
```

- [ ] **Step 4: Escrever `skills/design-mobile/SKILL.md` e `checklist.md`**

`skills/design-mobile/SKILL.md`:

```markdown
---
name: design-mobile
description: Diretrizes para interfaces mobile nativas e multiplataforma (iOS/SwiftUI, Android/Jetpack Compose, React Native, Flutter) seguindo Apple HIG e Material 3, com checklist de acessibilidade e ergonomia. Use ao criar ou alterar telas e componentes mobile.
---

# design-mobile

**Regra principal:** em app nativo, a convenção da plataforma vence a ousadia estética. O usuário já sabe usar o sistema — não o obrigue a reaprender.

## 1. Identifique a plataforma e o design system
- iOS (SwiftUI/UIKit) → Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Android (Compose/Views) → Material Design 3: https://m3.material.io
- React Native / Flutter → siga a plataforma em que a tela roda (componentes adaptativos) ou o design system do produto, se existir.
- Se o projeto já tem tema/tokens, eles mandam.
- Guias mudam com frequência: confira a página oficial antes de decisões de navegação, materiais/efeitos novos ou componentes recentes.

## 2. Padrões de plataforma
- Navegação: iOS usa tab bar e navigation stack com voltar no topo/gesto de borda; Android usa navigation bar/rail e voltar do sistema.
- Tipografia: use os estilos do sistema (Dynamic Type no iOS, type scale do M3 no Android) para escalar com a preferência do usuário.
- Cores: use papéis semânticos (primary, surface, on-surface…) e suporte modo escuro desde o início.
- Componentes: prefira os nativos (pickers, sheets, menus, switches) aos customizados.

## 3. Verificação
Percorra **checklist.md** (nesta pasta) item a item e informe o resultado na entrega.
Gere screenshots no simulador/emulador quando possível, em tamanho de fonte padrão e no maior, claro e escuro.
```

`skills/design-mobile/checklist.md`:

```markdown
# Checklist mobile (nabuco)

## Toque e ergonomia
- [ ] Alvos de toque ≥ 44×44 pt (iOS) / ≥ 48×48 dp (Android), com espaçamento entre eles.
- [ ] Ações principais alcançáveis com o polegar (parte inferior da tela).
- [ ] Gestos têm alternativa visível (botão), nunca são o único caminho.

## Layout
- [ ] Respeita safe area (notch, ilha, barra de gestos) e insets do teclado.
- [ ] Funciona em telas pequenas e grandes, retrato e paisagem (se suportada), e tablets se o app roda neles.

## Texto e acessibilidade
- [ ] Fonte escala com a preferência do sistema (Dynamic Type / escala de fonte) até o maior tamanho sem cortar conteúdo.
- [ ] Contraste ≥ 4.5:1 para texto normal (3:1 para texto grande).
- [ ] Todo elemento interativo tem rótulo para leitor de tela (VoiceOver no iOS, TalkBack no Android) e ordem de foco lógica.
- [ ] Informação não depende só de cor.

## Temas e estados
- [ ] Modo escuro completo (sem cores fixas que somem no escuro).
- [ ] Estados de carregando, vazio, erro e sem conexão.
- [ ] Respeita "reduzir movimento" do sistema.

## Plataforma
- [ ] Navegação e voltar seguem o padrão da plataforma.
- [ ] Componentes nativos usados onde existem.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/design-web skills/design-mobile tests/skills.test.mjs
git commit -m "feat: skills de design web e mobile"
```

---

### Task 10: Empacotamento — manifestos, marketplaces, hooks e README

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `hooks/hooks.json`, `README.md`
- Test: `tests/pacote.test.mjs`

**Interfaces:**
- Consumes: todos os scripts e skills anteriores.
- Produces: plugin instalável — Claude: `/plugin marketplace add Andgomes11/nabuco` + `/plugin install nabuco@nabuco`; Codex: `codex plugin marketplace add Andgomes11/nabuco`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/pacote.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = rel => JSON.parse(readFileSync(join(RAIZ, rel), 'utf8'));

test('manifestos: mesmo nome e versão do package.json', () => {
  const v = j('package.json').version;
  for (const m of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(j(m).name, 'nabuco', m);
    assert.equal(j(m).version, v, m);
  }
});

test('codex plugin aponta para skills e hooks existentes', () => {
  const m = j('.codex-plugin/plugin.json');
  assert.equal(m.skills, './skills/');
  assert.equal(m.hooks, './hooks/hooks.json');
  assert.ok(existsSync(join(RAIZ, 'hooks', 'hooks.json')));
});

test('marketplaces apontam para a raiz do repositório', () => {
  const c = j('.claude-plugin/marketplace.json');
  assert.equal(c.name, 'nabuco');
  assert.equal(c.plugins[0].name, 'nabuco');
  assert.equal(c.plugins[0].source, './');
  const x = j('.agents/plugins/marketplace.json');
  assert.equal(x.plugins[0].name, 'nabuco');
  assert.deepEqual(x.plugins[0].source, { source: 'url', url: './' });
});

test('hooks: Stop chama o gate; SubagentStart/Stop chamam evento --hook; caminhos via CLAUDE_PLUGIN_ROOT', () => {
  const h = j('hooks/hooks.json').hooks;
  const cmd = ev => h[ev][0].hooks[0];
  assert.equal(cmd('Stop').type, 'command');
  assert.equal(cmd('Stop').command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/gate-evidencia.mjs"');
  for (const ev of ['SubagentStart', 'SubagentStop']) assert.equal(cmd(ev).command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/evento.mjs" --hook');
  assert.equal(h.SubagentStop.length, 1); // SubagentStop NÃO roda o gate
});

test('README documenta instalação nos dois harnesses', () => {
  const r = readFileSync(join(RAIZ, 'README.md'), 'utf8');
  for (const s of ['/plugin marketplace add Andgomes11/nabuco', 'codex plugin marketplace add Andgomes11/nabuco', '/nabuco:setup', '$setup', '/hooks', 'npm run build']) assert.ok(r.includes(s), s);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `ENOENT ... package.json`/manifestos

- [ ] **Step 3: Criar manifestos e hooks**

`.claude-plugin/plugin.json`:

```json
{
  "name": "nabuco",
  "version": "0.1.0",
  "description": "Time de funcionários-agentes que aprende com erros: Gerente, Dev, Debugger, Designer, DevOps, Docs, Arquiteto, Revisor, Segurança e Tester, com gate de evidência.",
  "author": { "name": "Anderson Gomes" },
  "homepage": "https://github.com/Andgomes11/nabuco",
  "repository": "https://github.com/Andgomes11/nabuco",
  "keywords": ["agentes", "subagentes", "time", "gate", "evidencia"]
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "nabuco",
  "owner": { "name": "Anderson Gomes" },
  "plugins": [
    {
      "name": "nabuco",
      "source": "./",
      "description": "Time de funcionários-agentes que aprende com erros (Claude Code + Codex)."
    }
  ]
}
```

`.codex-plugin/plugin.json`:

```json
{
  "name": "nabuco",
  "version": "0.1.0",
  "description": "Time de funcionários-agentes que aprende com erros, com gate de evidência.",
  "author": { "name": "Anderson Gomes" },
  "homepage": "https://github.com/Andgomes11/nabuco",
  "repository": "https://github.com/Andgomes11/nabuco",
  "keywords": ["agentes", "subagentes", "time", "gate", "evidencia"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": { "displayName": "nabuco" }
}
```

`.agents/plugins/marketplace.json`:

```json
{
  "name": "nabuco",
  "interface": { "displayName": "nabuco" },
  "plugins": [
    {
      "name": "nabuco",
      "source": { "source": "url", "url": "./" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/gate-evidencia.mjs\"" } ] }
    ],
    "SubagentStart": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/evento.mjs\" --hook" } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/evento.mjs\" --hook" } ] }
    ]
  }
}
```

- [ ] **Step 4: Escrever `README.md`**

```markdown
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test && npm run build:check`
Expected: PASS e `OK: 18 arquivos gerados estão atualizados.`

- [ ] **Step 6: Commit e push**

```bash
git add .claude-plugin .codex-plugin .agents hooks README.md tests/pacote.test.mjs
git commit -m "feat: manifestos, marketplaces, hooks e README"
git push
```

---

### Task 11: Validação em harness real (smoke test)

Valida os pontos que a pesquisa não conseguiu confirmar. **Manual**, com o usuário. Registrar resultados em `docs/validacao-fase1.md`.

**Files:**
- Create: `docs/validacao-fase1.md`

**Interfaces:**
- Consumes: plugin completo (Tasks 1–10).
- Produces: registro do que funcionou e ajustes necessários (cada falha vira um item corrigido antes de fechar a fase).

- [ ] **Step 1: Instalar no Claude Code a partir da pasta local**

No Claude Code, numa sessão nova:
```
/plugin marketplace add "C:\Users\Anderson\Desktop\Nova pasta"
/plugin install nabuco@nabuco
```
Expected: plugin instalado; `/nabuco:status` aparece no menu.

- [ ] **Step 2: Setup e teste de restrição de ferramentas**

Run: `/nabuco:setup`
Expected: relatório com ✅; o teste do `nabuco:revisor` informa se a restrição `tools` vale em agente de plugin. Anote o resultado (vale / não vale → checadores locais instalados).

- [ ] **Step 3: Tarefa trivial ponta a ponta num repo descartável**

```bash
mkdir -p "$TEMP/nabuco-smoke" && cd "$TEMP/nabuco-smoke" && git init -q && npm init -y >/dev/null
```
No Claude Code aberto nessa pasta: `/nabuco:tarefa criar soma.js com função soma(a,b) e um teste node:test que prove soma(2,3)=5`.
Expected: tarefa `trivial` criada; critério com comando `node --test`; Dev implementa; Gerente roda o teste e registra evidência; `concluir` passa; `.nabuco/tarefas/*/eventos.jsonl` contém `agente_inicio`/`agente_fim` com `"papel":"dev"`.

- [ ] **Step 4: Gate bloqueando de verdade**

Na mesma pasta: `/nabuco:tarefa adicionar função subtrai com teste` e, quando o Gerente estiver executando, peça "pode parar por aqui".
Expected: o hook Stop devolve a mensagem `[nabuco] A tarefa ... não pode terminar assim` e o Gerente conclui com evidência ou muda para `aguardando_usuario`. Anote se `${CLAUDE_PLUGIN_ROOT}` expandiu corretamente no Windows.

- [ ] **Step 5: Codex (se instalado)**

Instalar o Codex CLI se o usuário quiser validar agora (`npm i -g @openai/codex`), depois:
```
codex plugin marketplace add "C:\Users\Anderson\Desktop\Nova pasta"
```
Habilitar o plugin, `$setup`, `/hooks` (confiar), e repetir Steps 3–4 com `$tarefa`.
Expected: agentes `nabuco-*` disponíveis; hook Stop bloqueia; eventos com `"harness":"codex"`. Anote: matcher do Stop, expansão de `${CLAUDE_PLUGIN_ROOT}`, campos reais do payload de `SubagentStart`/`SubagentStop`.

- [ ] **Step 6: Instalação a partir do GitHub privado**

Claude Code: `/plugin marketplace add Andgomes11/nabuco` (remova antes o marketplace local). Codex: `codex plugin marketplace add Andgomes11/nabuco`.
Expected: instala usando as credenciais do GitHub.

- [ ] **Step 7: Registrar resultados**

Criar `docs/validacao-fase1.md`:

```markdown
# Validação da Fase 1 — <data>

| Item | Claude Code | Codex | Observação |
|---|---|---|---|
| Instalação local | | | |
| Instalação via GitHub privado | | | |
| `tools` restringe agente de plugin | | n/a | |
| Tarefa trivial ponta a ponta | | | |
| Gate bloqueia no Stop | | | |
| `${CLAUDE_PLUGIN_ROOT}` no Windows | | | |
| Eventos de subagente (campos do payload) | | | |

## Ajustes feitos
- (liste cada correção com o commit)
```

Preencha cada célula com ✅/❌ e o detalhe. Para cada ❌, corrija com teste (TDD) antes de encerrar a fase.

- [ ] **Step 8: Commit**

```bash
git add docs/validacao-fase1.md
git commit -m "docs: resultados da validação da Fase 1"
git push
```
