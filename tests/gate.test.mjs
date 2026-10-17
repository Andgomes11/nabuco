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
