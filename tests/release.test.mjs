import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  compararSemver, ultimaTag, acharBase, listarTarefas, auditarTarefas, lerManifestos, auditarVersoes,
  lerComandos, rodarComando, auditarComandos, auditarChangelog, resultadoFinal, montarRelatorio,
} from '../scripts/lib/release.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'release.mjs');
const OK = 'node -e "process.exit(0)"';
let proj, home;

function git(args, data) {
  const env = { ...process.env, ...(data ? { GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data } : {}) };
  const r = spawnSync('git', ['-C', proj, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
}
function commitComTag(tag, data) {
  writeFileSync(join(proj, 'marca.txt'), tag);
  git(['add', '-A']);
  git(['commit', '-q', '-m', tag], data);
  git(['tag', tag]);
}
function escrever(rel, conteudo) {
  mkdirSync(dirname(join(proj, rel)), { recursive: true });
  writeFileSync(join(proj, rel), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
}
const tarefa = (nome, fase, criada) => escrever(`.nabuco/tarefas/${nome}/estado.json`, { slug: nome, fase, criada });
const relatorioFalso = (versao, resultado, gerado) =>
  escrever(`.nabuco/releases/${versao}.md`, `<!-- nabuco-release ${JSON.stringify({ versao, resultado, gerado })} -->\n# Release ${versao}\n`);
function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
// Projeto que passa em tudo: versão 0.2.0 > tag v0.1.0, comando ok, changelog com seção.
function projetoBom() {
  escrever('package.json', { name: 'x', version: '0.2.0' });
  escrever('.nabuco/release.json', { comandos: [OK] });
  escrever('CHANGELOG.md', '# Changelog\n\n## [0.2.0] - 2026-03-01\n- novidade\n\n## [0.1.0]\n- início\n');
  commitComTag('v0.1.0', '2026-01-01T00:00:00Z');
  tarefa('2025-12-01-velha', 'executando', '2025-12-01T00:00:00Z'); // antes da tag: fora do período
  tarefa('2026-02-01-nova', 'concluida', '2026-02-01T00:00:00Z');
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco release-'));
  proj = join(base, 'proj'); home = join(base, 'home');
  mkdirSync(proj, { recursive: true });
  const r = spawnSync('git', ['init', '-q', proj], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
afterEach(() => rmSync(dirname(proj), { recursive: true, force: true }));

test('compararSemver: ordem, prefixo v, pré-release e inválidas', () => {
  assert.equal(compararSemver('0.3.2', '0.3.10'), -1);
  assert.equal(compararSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compararSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compararSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compararSemver('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
  assert.equal(compararSemver('2.0.0+build.1', '2.0.0'), 0);
  assert.equal(compararSemver('1.0', '1.0.0'), null);
  assert.equal(compararSemver('abc', '1.0.0'), null);
});

test('base: git sem tag e sem relatório = nenhuma (todas as tarefas)', () => {
  assert.equal(ultimaTag(proj), null);
  const b = acharBase(proj, '0.1.0');
  assert.equal(b.tipo, 'nenhuma');
  assert.equal(b.data, null);
  tarefa('a', 'concluida', '2020-01-01T00:00:00Z');
  tarefa('b', 'concluida', '2026-01-01T00:00:00Z');
  assert.deepEqual(listarTarefas(proj, b.data).map(t => t.nome), ['a', 'b']);
});

test('base: data do commit da última tag filtra as tarefas', () => {
  commitComTag('v0.1.0', '2026-01-01T00:00:00Z');
  relatorioFalso('0.0.9', 'liberada', '2026-05-01T00:00:00Z'); // com tag, relatório é ignorado
  const b = acharBase(proj, '0.2.0');
  assert.equal(b.tipo, 'tag');
  assert.equal(b.tag, 'v0.1.0');
  assert.equal(new Date(b.data).toISOString(), '2026-01-01T00:00:00.000Z');
  tarefa('antes', 'concluida', '2025-12-31T23:59:59Z');
  tarefa('depois', 'concluida', '2026-01-02T00:00:00Z');
  assert.deepEqual(listarTarefas(proj, b.data).map(t => t.nome), ['depois']);
});

test('base: sem tag, usa o último relatório liberado (exceto o da própria versão)', () => {
  relatorioFalso('0.1.0', 'liberada', '2026-01-01T00:00:00.000Z');
  relatorioFalso('0.1.1', 'liberada', '2026-02-01T00:00:00.000Z');
  relatorioFalso('0.1.2', 'reprovada', '2026-03-01T00:00:00.000Z'); // reprovada não é release
  relatorioFalso('0.2.0', 'liberada', '2026-04-01T00:00:00.000Z'); // a própria versão (rodada anterior)
  const b = acharBase(proj, '0.2.0');
  assert.equal(b.tipo, 'relatorio');
  assert.equal(b.versao, '0.1.1');
  assert.equal(b.data, '2026-02-01T00:00:00.000Z');
});

test('tarefas: não concluída e ativa falham; abandonada é aviso; ilegível falha', () => {
  tarefa('t1', 'concluida', '2026-01-01T00:00:00Z');
  tarefa('t2', 'abandonada', '2026-01-02T00:00:00Z');
  assert.equal(auditarTarefas(listarTarefas(proj, null)).status, 'aviso');
  assert.match(auditarTarefas(listarTarefas(proj, null)).detalhes.join('\n'), /t2.*abandonada/);

  tarefa('t3', 'executando', '2026-01-03T00:00:00Z');
  escrever('.nabuco/ativa', 't3\n');
  const it = auditarTarefas(listarTarefas(proj, null));
  assert.equal(it.status, 'falha');
  assert.match(it.detalhes.join('\n'), /t3.*executando.*ativa/);

  escrever('.nabuco/tarefas/t4/estado.json', '{quebrado');
  const t4 = listarTarefas(proj, null).find(t => t.nome === 't4');
  assert.ok(t4.erro);
  assert.equal(auditarTarefas([t4]).status, 'falha');
  assert.equal(auditarTarefas([]).status, 'ok');
});

test('versões: lê package.json, plugins, pyproject e Cargo; divergência falha', () => {
  escrever('package.json', { version: '1.2.0' });
  escrever('.claude-plugin/plugin.json', { version: '1.2.0' });
  escrever('.codex-plugin/plugin.json', { version: '1.2.0' });
  escrever('pyproject.toml', '[build-system]\nrequires = []\n\n[project]\nname = "x"\nversion = "1.2.0"\n');
  escrever('Cargo.toml', '[dependencies]\nserde = { version = "1.0" }\n\n[package]\nname = "x"\nversion = "1.2.0"\n');
  const m = lerManifestos(proj);
  assert.deepEqual(m.map(x => [x.arquivo, x.versao]), [
    ['package.json', '1.2.0'], ['.claude-plugin/plugin.json', '1.2.0'], ['.codex-plugin/plugin.json', '1.2.0'],
    ['pyproject.toml', '1.2.0'], ['Cargo.toml', '1.2.0'],
  ]);
  assert.equal(auditarVersoes({ manifestos: m, tag: 'v1.1.9' }).status, 'ok');
  assert.equal(auditarVersoes({ manifestos: m, tag: 'v1.1.9' }).versao, '1.2.0');

  escrever('pyproject.toml', '[tool.poetry]\nname = "x"\nversion = "1.3.0"\n');
  const div = auditarVersoes({ manifestos: lerManifestos(proj), tag: null });
  assert.equal(div.status, 'falha');
  assert.match(div.resumo, /divergem/);
});

test('versões: nenhum manifesto, --versao diferente, não maior que a tag', () => {
  assert.equal(auditarVersoes({ manifestos: lerManifestos(proj), tag: null }).status, 'falha');
  const m = [{ arquivo: 'package.json', versao: '0.3.2' }];
  assert.match(auditarVersoes({ manifestos: m, versaoPedida: '0.4.0', tag: null }).resumo, /--versao 0\.4\.0/);
  assert.equal(auditarVersoes({ manifestos: m, versaoPedida: '0.3.2', tag: null }).status, 'ok');
  assert.match(auditarVersoes({ manifestos: m, tag: 'v0.3.2' }).resumo, /não é maior/);
  assert.equal(auditarVersoes({ manifestos: m, tag: 'v0.4.0' }).status, 'falha');
  assert.equal(auditarVersoes({ manifestos: m, tag: 'nightly' }).status, 'aviso');
});

test('comandos: release.json, fallback npm test, sem comandos e config inválida', () => {
  assert.deepEqual(lerComandos(proj).comandos, []);
  escrever('package.json', { scripts: { test: 'node --test' } });
  assert.deepEqual(lerComandos(proj), { fonte: 'package.json (script test)', comandos: ['npm test'] });
  escrever('.nabuco/release.json', { comandos: [OK, 'npm run lint'] });
  assert.deepEqual(lerComandos(proj), { fonte: '.nabuco/release.json', comandos: [OK, 'npm run lint'] });
  escrever('.nabuco/release.json', { comandos: 'npm test' });
  assert.ok(lerComandos(proj).erro);
  assert.equal(auditarComandos(proj, lerComandos(proj)).status, 'falha');
  assert.equal(auditarComandos(proj, { fonte: '-', comandos: [] }).status, 'aviso');
});

test('comandos: código de saída e só as últimas 10 linhas', () => {
  const r = rodarComando('node -e "for (let i = 1; i <= 15; i++) console.log(\'linha \' + i); process.exit(3)"', proj);
  assert.equal(r.codigo, 3);
  assert.equal(r.ultimas.length, 10);
  assert.equal(r.ultimas.at(-1), 'linha 15');
  assert.equal(r.ultimas[0], 'linha 6');
  const it = auditarComandos(proj, { fonte: 'x', comandos: [OK, 'node -e "process.exit(2)"'] });
  assert.equal(it.status, 'falha');
  assert.deepEqual(it.execucoes.map(e => e.codigo), [0, 2]);
});

test('changelog: sem arquivo, sem seção, seção vazia, versão parecida e ok', () => {
  assert.match(auditarChangelog(proj, '0.2.0').resumo, /CHANGELOG\.md não existe/);
  escrever('CHANGELOG.md', '# Changelog\n\n## 0.2.10\n- outra\n');
  assert.equal(auditarChangelog(proj, '0.2.1').status, 'falha');
  escrever('CHANGELOG.md', '# Changelog\n\n## v0.2.1 - 2026\n\n### Adicionado\n\n## 0.2.0\n- x\n');
  assert.match(auditarChangelog(proj, '0.2.1').resumo, /sem conteúdo/);
  escrever('CHANGELOG.md', '# Changelog\r\n\r\n## [0.2.1] - 2026\r\n### Adicionado\r\n- coisa nova\r\n');
  assert.equal(auditarChangelog(proj, '0.2.1').status, 'ok');
});

test('relatório: tabela, detalhes, saída dos comandos e tarefas do período', () => {
  const itens = [
    { nome: 'Tarefas', status: 'aviso', prova: '.nabuco/tarefas/', resumo: '1 abandonada', detalhes: ['x — abandonada'] },
    { nome: 'Comandos', status: 'falha', prova: 'a | b', resumo: '1 falhou', detalhes: [], execucoes: [{ comando: 'a | b', codigo: 1, ultimas: ['erro ```'] }] },
  ];
  assert.equal(resultadoFinal(itens), 'reprovada');
  assert.equal(resultadoFinal([itens[0]]), 'liberada');
  const md = montarRelatorio({ versao: '1.0.0', base: { tipo: 'nenhuma', data: null, descricao: 'nenhuma' }, itens, tarefas: [{ nome: 'x', fase: 'abandonada' }], gerado: '2026-01-01T00:00:00.000Z' });
  assert.match(md, /^<!-- nabuco-release \{"versao":"1\.0\.0","resultado":"reprovada","gerado":"2026-01-01T00:00:00\.000Z"\} -->/);
  assert.match(md, /# Release 1\.0\.0 — reprovada/);
  assert.match(md, /\| Comandos \| ❌ falha \| `a \\\| b` \|/);
  assert.match(md, /saída 1/);
  assert.match(md, /````\n.*erro ```/s); // cerca maior que qualquer sequência de crases da saída
  assert.match(md, /## Tarefas do período\n[^#]*\n- x — abandonada\n$/);
});

test('CLI: projeto em dia → liberada (saída 0) e relatório gravado', () => {
  projetoBom();
  const r = run();
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /✅ Tarefas/);
  assert.match(r.out, /release 0\.2\.0 liberada/);
  const md = readFileSync(join(proj, '.nabuco', 'releases', '0.2.0.md'), 'utf8');
  assert.match(md, /base: tag v0\.1\.0/);
  assert.match(md, /2026-02-01-nova/);
  assert.doesNotMatch(md, /2025-12-01-velha/);
});

test('CLI: reprovada (saída 1) por tarefa ativa, changelog e comando; abandonada só avisa', () => {
  projetoBom();
  tarefa('2026-02-02-largada', 'abandonada', '2026-02-02T00:00:00Z');
  tarefa('2026-02-03-andamento', 'executando', '2026-02-03T00:00:00Z');
  escrever('.nabuco/ativa', '2026-02-03-andamento\n');
  escrever('.nabuco/release.json', { comandos: [OK, 'node -e "console.log(\'quebrou\'); process.exit(4)"'] });
  rmSync(join(proj, 'CHANGELOG.md'));
  const r = run();
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /❌ Tarefas/);
  assert.match(r.out, /✅ Versões/);
  assert.match(r.out, /❌ Comandos/);
  assert.match(r.out, /❌ Changelog/);
  assert.match(r.out, /release 0\.2\.0 reprovada/);
  const md = readFileSync(join(proj, '.nabuco', 'releases', '0.2.0.md'), 'utf8');
  assert.match(md, /2026-02-03-andamento — executando \(ativa\)/);
  assert.match(md, /2026-02-02-largada — abandonada/);
  assert.match(md, /saída 4/);
  assert.match(md, /quebrou/);
});

test('CLI: --versao confere com os manifestos; inválida ou opção desconhecida = uso (saída 2)', () => {
  projetoBom();
  const r = run('--versao', '0.3.0');
  assert.equal(r.code, 1);
  assert.match(r.out, /❌ Versões/);
  assert.ok(existsSync(join(proj, '.nabuco', 'releases', '0.3.0.md')));
  const inv = run('--versao', 'abc');
  assert.equal(inv.code, 2);
  assert.match(inv.err, /^nabuco: /);
  assert.equal(run('--tag', 'x').code, 2);
  assert.deepEqual(readdirSync(join(proj, '.nabuco', 'releases')), ['0.3.0.md']);
});

test('CLI: só lê o projeto (git status limpo além do relatório) e nunca cria tag', () => {
  projetoBom();
  escrever('.gitignore', '.nabuco/\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'tudo']);
  run();
  const st = spawnSync('git', ['-C', proj, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(st.stdout.trim(), '');
  const tags = spawnSync('git', ['-C', proj, 'tag'], { encoding: 'utf8' });
  assert.equal(tags.stdout.trim(), 'v0.1.0');
});

// --- rodada de correção 1 (achados do revisor) ---

test('regressão 1: manifesto ilegível reprova Versões; package.json ilegível reprova Comandos', () => {
  escrever('package.json', { version: '1.0.0' });
  escrever('.claude-plugin/plugin.json', '{quebrado');
  const v = auditarVersoes({ manifestos: lerManifestos(proj), tag: null });
  assert.equal(v.status, 'falha');
  assert.match(v.resumo, /\.claude-plugin\/plugin\.json ilegível/);
  escrever('package.json', '{"scripts": {');
  const c = lerComandos(proj);
  assert.match(c.erro, /package\.json ilegível/);
  assert.equal(auditarComandos(proj, c).status, 'falha');
});

test('regressão 2: base por relatório exige versão maior; versão já liberada não é reauditada', () => {
  const m = [{ arquivo: 'package.json', versao: '0.2.0' }];
  assert.equal(auditarVersoes({ manifestos: m, versaoBase: '0.2.0' }).status, 'falha');
  assert.match(auditarVersoes({ manifestos: m, versaoBase: '0.3.0' }).resumo, /não é maior que a release anterior 0\.3\.0/);
  assert.equal(auditarVersoes({ manifestos: m, versaoBase: '0.1.0' }).status, 'ok');

  escrever('package.json', { version: '0.2.0' });
  escrever('.nabuco/release.json', { comandos: [OK] });
  escrever('CHANGELOG.md', '## 0.2.0\n- x\n');
  relatorioFalso('0.3.0', 'liberada', '2026-01-01T00:00:00.000Z');
  const r = run();
  assert.equal(r.code, 1);
  assert.match(r.out, /❌ Versões: 0\.2\.0 não é maior que a release anterior 0\.3\.0/);

  // reauditar uma versão reprovada sobrescreve; uma liberada, não
  escrever('package.json', { version: '0.4.0' });
  escrever('CHANGELOG.md', '## 0.4.0\n- x\n');
  relatorioFalso('0.4.0', 'reprovada', '2026-02-01T00:00:00.000Z');
  assert.equal(run().code, 0);
  const md = join(proj, '.nabuco', 'releases', '0.4.0.md');
  assert.match(readFileSync(md, 'utf8'), /# Release 0\.4\.0 — liberada/);
  const antes = readFileSync(md, 'utf8');
  const deNovo = run();
  assert.equal(deNovo.code, 1);
  assert.match(deNovo.err, /^nabuco: a versão 0\.4\.0 já foi liberada .*suba a versão/);
  assert.equal(readFileSync(md, 'utf8'), antes);
});

test('regressão 3: ativa velha (fase concluida) não conta como pendente', () => {
  tarefa('t1', 'concluida', '2026-01-01T00:00:00Z');
  escrever('.nabuco/ativa', 't1\n');
  assert.equal(auditarTarefas(listarTarefas(proj, null)).status, 'ok');
  tarefa('t1', 'checando', '2026-01-01T00:00:00Z');
  assert.equal(auditarTarefas(listarTarefas(proj, null)).status, 'falha');
});

test('regressão 4: rodar na pasta global do nabuco é uso incorreto e não grava nada', () => {
  projetoBom();
  home = join(proj, '.nabuco');
  const r = run();
  assert.equal(r.code, 2);
  assert.match(r.err, /^nabuco: .*pasta global/);
  assert.ok(!existsSync(join(proj, '.nabuco', 'releases')));
});

test('regressão 5: Cargo.toml de workspace usa [workspace.package]', () => {
  escrever('Cargo.toml', '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "2.1.0"\nedition = "2021"\n');
  assert.deepEqual(lerManifestos(proj), [{ arquivo: 'Cargo.toml', versao: '2.1.0' }]);
});

test('regressão 6: base usa a maior tag semver alcançável, ignorando tags que não são semver', () => {
  commitComTag('0.1.0', '2026-01-01T00:00:00Z');
  commitComTag('v0.2.0', '2026-02-01T00:00:00Z');
  commitComTag('deploy-prod', '2026-03-01T00:00:00Z');
  git(['checkout', '-q', '-b', 'outro']);
  commitComTag('v9.0.0', '2026-04-01T00:00:00Z'); // fora do HEAD de volta
  git(['checkout', '-q', '-']);
  const t = ultimaTag(proj);
  assert.equal(t.tag, 'v0.2.0');
  assert.equal(new Date(t.data).toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(acharBase(proj, '0.3.0').tag, 'v0.2.0');
});
