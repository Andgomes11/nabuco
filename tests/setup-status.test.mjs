import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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
  assert.match(r.stdout, /ℹ️ .*adicione `\.nabuco\/` ao \.gitignore do projeto/);
});

test('setup e status: config.json corrompido → avisa e segue com padrões', () => {
  mkdirSync(join(base, 'nabuco'), { recursive: true });
  writeFileSync(join(base, 'nabuco', 'config.json'), '{quebrado');
  const s = run('status.mjs');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /⚠️ config\.json ilegível \(/);
  const r = run('setup.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /⚠️ config\.json ilegível \(/);
  assert.match(r.stdout, /Setup concluído/);
  assert.deepEqual(JSON.parse(readFileSync(join(base, 'nabuco', 'config.json'), 'utf8')), { versao: 1, checadores_locais: false });
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
