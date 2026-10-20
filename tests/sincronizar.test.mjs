import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, remoto;
const GIT_ENV = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
const maquina = nome => ({ ...process.env, ...GIT_ENV, NABUCO_HOME: join(base, nome), CODEX_HOME: join(base, `${nome}-codex`), CLAUDE_CONFIG_DIR: join(base, `${nome}-claude`), NABUCO_HARNESS: 'teste' });
const run = (env, script, args = []) => spawnSync(process.execPath, [join(RAIZ, 'scripts', script), ...args], { cwd: base, encoding: 'utf8', env });
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
const linhas = arq => readFileSync(arq, 'utf8').trim().split('\n');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco sync-'));
  remoto = join(base, 'remoto.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('sincronizar sem remoto configurado não faz nada', () => {
  const A = maquina('a');
  assert.equal(run(A, 'setup.mjs').status, 0);
  const r = run(A, 'sincronizar.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /não configurada/);
});

test('duas máquinas: a primeira envia, a segunda traz, e o histórico das duas se junta sem conflito', () => {
  const A = maquina('a'), B = maquina('b');
  const homeA = A.NABUCO_HOME, homeB = B.NABUCO_HOME;
  // máquina A com cérebro já em uso (casos, histórico) e arquivos que são só dela
  assert.equal(run(A, 'setup.mjs').status, 0);
  mkdirSync(join(homeA, 'casos', 'dev'), { recursive: true });
  writeFileSync(join(homeA, 'casos', 'dev', 'c1.md'), 'sintoma: x\n');
  writeFileSync(join(homeA, 'historico.jsonl'), '{"tipo":"a1"}\n');
  writeFileSync(join(homeA, 'limite.jsonl'), '{"h5":{"pct":1}}\n');
  git(homeA, 'add', '-A'); git(homeA, 'commit', '-q', '-m', 'inicio');
  const r = run(A, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cérebro sincronizado com/);
  const noRemoto = git(remoto, 'ls-tree', '-r', '--name-only', 'main').stdout.trim().split('\n');
  assert.ok(noRemoto.includes('casos/dev/c1.md'));
  assert.ok(noRemoto.includes('historico.jsonl'));
  assert.ok(!noRemoto.includes('limite.jsonl') && !noRemoto.includes('config.json'), 'o que é da máquina não sobe');
  assert.equal(JSON.parse(readFileSync(join(homeA, 'config.json'), 'utf8')).sincronizar, true);

  // máquina B nova (já com um evento local antes do setup): traz o cérebro e mantém o evento
  mkdirSync(homeB, { recursive: true });
  writeFileSync(join(homeB, 'historico.jsonl'), '{"tipo":"b0"}\n');
  const rb = run(B, 'setup.mjs', ['--cerebro-remoto', remoto]);
  assert.equal(rb.status, 0, rb.stderr + rb.stdout);
  assert.match(rb.stdout, /cérebro trazido de/);
  assert.ok(existsSync(join(homeB, 'casos', 'dev', 'c1.md')));
  assert.deepEqual(linhas(join(homeB, 'historico.jsonl')), ['{"tipo":"a1"}', '{"tipo":"b0"}']);

  // as duas gravam eventos ao mesmo tempo e sincronizam: union junta tudo, sem conflito
  appendFileSync(join(homeA, 'historico.jsonl'), '{"tipo":"a2"}\n');
  appendFileSync(join(homeB, 'historico.jsonl'), '{"tipo":"b1"}\n');
  for (const [m, quem] of [[A, 'A'], [B, 'B'], [A, 'A de novo']]) {
    const s = run(m, 'sincronizar.mjs');
    assert.equal(s.status, 0, `${quem}: ${s.stderr}`);
  }
  for (const h of [homeA, homeB]) {
    assert.deepEqual(linhas(join(h, 'historico.jsonl')).sort(), ['{"tipo":"a1"}', '{"tipo":"a2"}', '{"tipo":"b0"}', '{"tipo":"b1"}']);
  }
  assert.match(readFileSync(join(homeA, 'sync.log'), 'utf8'), /"ok":true/);
});

test('remoto inacessível: setup avisa e sai com erro, sem marcar a sincronização', () => {
  const A = maquina('a');
  assert.equal(run(A, 'setup.mjs').status, 0);
  const r = run(A, 'setup.mjs', ['--cerebro-remoto', join(base, 'nao-existe.git')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não consegui acessar/);
  assert.notEqual(JSON.parse(readFileSync(join(A.NABUCO_HOME, 'config.json'), 'utf8')).sincronizar, true);
});
