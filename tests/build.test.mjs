import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarModelos, validarPapel } from '../scripts/lib/validar.mjs';
import { gerarAgenteClaude, gerarAgenteCodex, REGRAS_DO_TIME } from '../scripts/lib/gerar.mjs';
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
  assert.equal(JSON.parse(instr), corpo.trim() + '\n\n' + REGRAS_DO_TIME); // string básica TOML == string JSON
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

// Corpo de agente gerado: o .md do Claude depois do frontmatter; o developer_instructions do toml do Codex.
const corpoGerado = (rel, txt) => rel.endsWith('.md') ? txt.slice(txt.indexOf('\n---\n', 4) + 5) : JSON.parse(txt.match(/^developer_instructions = (.*)$/m)[1]);

test('regras do time: todo agente embutido gerado (Claude e Codex) tem a seção uma vez, antes de Entrega', () => {
  const fonte = readFileSync(join(raiz, 'papeis', 'comum', 'regras-do-time.md'), 'utf8').replace(/\r\n?/g, '\n').trim();
  assert.match(fonte, /^## Regras do time\n/);
  const { arquivos } = construir(raiz);
  assert.equal(arquivos.size, PAPEIS.length * 2);
  for (const [rel, txt] of arquivos) {
    const corpo = corpoGerado(rel, txt);
    assert.ok(corpo.includes(fonte), `${rel}: sem o texto de papeis/comum/regras-do-time.md`);
    assert.equal(corpo.split('## Regras do time').length, 2, `${rel}: seção repetida`);
    const r = corpo.indexOf('## Regras do time'), e = corpo.search(/^## Entrega/m);
    assert.ok(e > r && r > 0, `${rel}: Regras do time precisa vir antes de Entrega`);
  }
});

test('regras do time: sem seção Entrega, vão no fim; papeis/comum não vira papel', () => {
  const fm = { descricao: 'd' };
  const c = gerarAgenteClaude('rev', fm, 'corpo\n', { model: 'opus', effort: 'high' });
  assert.match(c, /\ncorpo\n\n## Regras do time\n[^]*\n$/);
  const t = JSON.parse(gerarAgenteCodex('rev', fm, 'corpo', { model: null, effort: 'high' }).match(/^developer_instructions = (.*)$/m)[1]);
  assert.match(t, /^corpo\n\n## Regras do time\n/);
  assert.ok(!construir(raiz).papeis.includes('comum'));
});
