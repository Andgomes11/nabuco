import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
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
  assert.match(r.motivo, /--evidencia="<saída>"/);
  assert.match(r.motivo, /T fase aguardando_usuario --motivo="<pergunta>"/);
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
  const u = gate(undefined);
  assert.equal(u.status, 0);
  assert.equal(u.stdout, '');
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

function prepararBloqueio() {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  tarefa('aprovar');
  return readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
}

test('hook: trava anti-loop libera na 3ª tentativa seguida sem progresso, sem stop_hook_active', () => {
  const ativa = prepararBloqueio();
  const p = { cwd: proj, hook_event_name: 'Stop' };
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  const r = gate(p);
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  assert.match(r.stderr, /após 3 tentativas de encerrar sem progresso/);
  const dir = join(proj, '.nabuco', 'tarefas', ativa);
  assert.equal(JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).fase, 'aguardando_usuario');
  assert.match(readFileSync(join(dir, 'eventos.jsonl'), 'utf8'), /"tipo":"gate_liberado"/);
  assert.ok(!existsSync(join(dir, 'gate-bloqueios')));
});

test('hook: trava anti-loop também libera com stop_hook_active true', () => {
  prepararBloqueio();
  const p = { cwd: proj, stop_hook_active: true };
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  assert.equal(gate(p).stdout, '');
});

test('hook: progresso nos critérios reinicia o contador', () => {
  prepararBloqueio();
  const p = { cwd: proj };
  gate(p); gate(p);
  assert.equal(tarefa('criterio-add', '--id', 'c2', '--descricao', 'd', '--verificacao', 'v').status, 0);
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  assert.equal(JSON.parse(gate(p).stdout).decision, 'block');
  assert.equal(gate(p).stdout, '');
});

test('hook: stop_hook_active false explícito reinicia o contador', () => {
  prepararBloqueio();
  gate({ cwd: proj }); gate({ cwd: proj });
  assert.equal(JSON.parse(gate({ cwd: proj, stop_hook_active: false }).stdout).decision, 'block');
  assert.equal(JSON.parse(gate({ cwd: proj }).stdout).decision, 'block');
  assert.equal(gate({ cwd: proj }).stdout, '');
});

test('hook: contador não gravável → não bloqueia (falha aberta) e avisa', () => {
  const ativa = prepararBloqueio();
  mkdirSync(join(proj, '.nabuco', 'tarefas', ativa, 'gate-bloqueios'));
  const r = gate({ cwd: proj });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /contador/);
});

test('hook: Stop fora das fases ativas não cria o contador', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const r = gate({ cwd: proj });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  assert.ok(!existsSync(join(proj, '.nabuco', 'tarefas', ativa, 'gate-bloqueios')));
});

test('hook: bloqueio sai mesmo com NABUCO_HOME não gravável', () => {
  prepararBloqueio();
  const arq = join(base, 'arquivo'); writeFileSync(arq, 'x');
  const r = spawnSync(process.execPath, [GATE], { cwd: proj, input: JSON.stringify({ cwd: proj }), encoding: 'utf8', env: { ...env(), NABUCO_HOME: join(arq, 'sub') } });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).decision, 'block');
});

test('hook: pasta da tarefa apagada mas "ativa" ainda aponta → não bloqueia', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('aprovar');
  rmSync(join(proj, '.nabuco', 'tarefas'), { recursive: true, force: true });
  assert.ok(existsSync(join(proj, '.nabuco', 'ativa')));
  const r = gate({ cwd: proj });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});

test('hook: gate_bloqueou registra o harness pelo payload do Codex (turn_id)', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  tarefa('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  tarefa('aprovar');
  const semHarness = Object.fromEntries(Object.entries(env()).filter(([k]) => !/^(NABUCO_HARNESS|CLAUDE|CODEX)/.test(k)));
  const r = spawnSync(process.execPath, [GATE], { cwd: proj, input: JSON.stringify({ cwd: proj, turn_id: 't1' }), encoding: 'utf8', env: semHarness });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const evs = readFileSync(join(proj, '.nabuco', 'tarefas', ativa, 'eventos.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(evs.find(e => e.tipo === 'gate_bloqueou').harness, 'codex');
});

const DONO = join(RAIZ, 'scripts', 'dono.mjs');
const dono = payload => spawnSync(process.execPath, [DONO], { cwd: proj, input: JSON.stringify(payload), encoding: 'utf8', env: env() });

test('dono da tarefa: a sessão que roda tarefa.mjs vira dona; o gate só segura a sessão dona', () => {
  tarefa('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'feature');
  tarefa('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  tarefa('aprovar');
  const dir = join(proj, '.nabuco', 'tarefas', readdirSync(join(proj, '.nabuco', 'tarefas'))[0]);
  // comando que não é da CLI de tarefa, ou sem session_id: não define dono
  dono({ session_id: 'A', cwd: proj, tool_input: { command: 'ls' } });
  dono({ cwd: proj, tool_input: { command: 'node tarefa.mjs status' } });
  assert.ok(!existsSync(join(dir, 'sessao')));
  // sem dono, o gate vale para todos (comportamento anterior)
  assert.equal(JSON.parse(gate({ session_id: 'B', cwd: proj }).stdout).decision, 'block');
  rmSync(join(dir, 'gate-bloqueios'), { force: true });
  dono({ session_id: 'A', cwd: proj, tool_input: { command: 'node "/x/scripts/tarefa.mjs" status' } });
  assert.equal(readFileSync(join(dir, 'sessao'), 'utf8').trim(), 'A');
  // outra sessão no mesmo projeto: não bloqueia, não registra evento nem cria contador
  const antes = readFileSync(join(dir, 'eventos.jsonl'), 'utf8');
  const outra = gate({ session_id: 'B', cwd: proj });
  assert.equal(outra.status, 0);
  assert.equal(outra.stdout, '');
  assert.equal(readFileSync(join(dir, 'eventos.jsonl'), 'utf8'), antes);
  assert.ok(!existsSync(join(dir, 'gate-bloqueios')));
  // a dona continua bloqueada
  assert.equal(JSON.parse(gate({ session_id: 'A', cwd: proj }).stdout).decision, 'block');
  // retomar em outra sessão (rodando a CLI) transfere o dono
  dono({ session_id: 'B', cwd: proj, tool_input: { command: 'node tarefa.mjs status' } });
  assert.equal(JSON.parse(gate({ session_id: 'B', cwd: proj }).stdout).decision, 'block');
  // payload inválido não quebra
  assert.equal(spawnSync(process.execPath, [DONO], { cwd: proj, input: '{', encoding: 'utf8', env: env() }).status, 0);
});
