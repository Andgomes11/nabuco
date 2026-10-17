import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'cerebro.mjs');
let base, proj, home;
const run = args => spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'claude' } });
const caso = (o = {}) => ({ papel: 'dev', sintoma: 'Falha no build por cache', causa_raiz: 'cache velho', correcao: 'limpar', verificacao: 'npm test → ok', tags: ['cache', 'build'], ...o });
const arq = (nome, dados) => { const p = join(base, nome); writeFileSync(p, typeof dados === 'string' ? dados : JSON.stringify(dados)); return p; };
const hist = () => readFileSync(join(home, 'historico.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco cb-'));
  proj = join(base, 'Nova pasta'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('caso-add grava e registra evento', () => {
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, r.stdout.trim())));
  const e = hist().find(x => x.tipo === 'caso_criado');
  assert.equal(e.papel, 'dev'); assert.equal(e.dados.arquivo, r.stdout.trim());
});

test('caso-add commita na home com git', () => {
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q', home]);
  spawnSync('git', ['-C', home, 'config', 'user.email', 't@t']);
  spawnSync('git', ['-C', home, 'config', 'user.name', 'T']);
  spawnSync('git', ['-C', home, 'config', 'commit.gpgsign', 'false']);
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  const log = spawnSync('git', ['-C', home, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(log.length, 1); assert.match(log[0], /caso: casos\/dev\//);
});

test('caso-add sem git na home: exit 0 e aviso em stderr', () => {
  const r = run(['caso-add', '--de', arq('caso.json', caso())]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /git/);
  assert.doesNotMatch(r.stdout, /git/);
});

test('caso-add sem verificacao → exit 1 e nada gravado', () => {
  const c = caso(); delete c.verificacao;
  const r = run(['caso-add', '--de', arq('caso.json', c)]);
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(home, 'casos')));
});

test('--de inexistente, ausente ou JSON inválido → exit 2', () => {
  assert.equal(run(['caso-add', '--de', join(base, 'nada.json')]).status, 2);
  assert.equal(run(['caso-add']).status, 2);
  assert.equal(run(['caso-add', '--de', arq('ruim.json', '{nao json')]).status, 2);
});

test('casos lista e filtra por papel; home vazia → []', () => {
  assert.deepEqual(JSON.parse(run(['casos']).stdout), []);
  run(['caso-add', '--de', arq('c.json', caso())]);
  const l = JSON.parse(run(['casos', '--papel', 'dev']).stdout);
  assert.equal(l.length, 1); assert.deepEqual(l[0].tags, ['cache', 'build']); assert.equal(l[0].papel, 'dev');
  assert.deepEqual(JSON.parse(run(['casos', '--papel', 'revisor']).stdout), []);
  assert.equal(run(['casos', '--papel', 'chefe']).status, 2);
});

test('similares', () => {
  const vazio = run(['similares', '--de', arq('n.json', caso())]);
  assert.equal(vazio.status, 0, vazio.stderr);
  assert.deepEqual(JSON.parse(vazio.stdout), { similares: [], destilar: false });
  run(['caso-add', '--de', arq('c.json', caso())]);
  const par = JSON.parse(run(['similares', '--de', arq('n.json', caso({ sintoma: 'Falha no build, cache' }))]).stdout);
  assert.equal(par.destilar, true); assert.equal(par.similares.length, 1); assert.ok(par.similares[0].score >= 0.4);
  const dif = JSON.parse(run(['similares', '--de', arq('d.json', caso({ sintoma: 'Layout quebrado no mobile', tags: ['css'] }))]).stdout);
  assert.deepEqual(dif, { similares: [], destilar: false });
  const caro = JSON.parse(run(['similares', '--de', arq('k.json', caso({ sintoma: 'Layout quebrado no mobile', tags: ['css'], turnos: 8 }))]).stdout);
  assert.equal(caro.destilar, true);
});

test('comando desconhecido → exit 2', () => {
  assert.equal(run(['xyz']).status, 2);
});
