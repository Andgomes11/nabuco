import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizarPapel } from '../scripts/evento.mjs';
import { detectarHarness } from '../scripts/lib/eventos.mjs';

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
  // fim sem agent_type e sem início correspondente = agente interno do Claude Code: não grava
  assert.equal(hist().filter(e => e.tipo === 'agente_fim').length, 0);
});

test('hook: fim sem agent_type só grava se houver o início, e herda o papel dele', () => {
  run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'interno', cwd: proj }));
  assert.deepEqual(hist(), []);
  run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'nabuco:dev', agent_id: 'd1', cwd: proj }));
  run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'd1', cwd: proj }));
  const f = hist().find(e => e.tipo === 'agente_fim');
  assert.equal(f.papel, 'dev');
  assert.equal(typeof f.dados.duracao_ms, 'number');
});

test('hook: hook_event_name herdado de Object.prototype ou payload null não registra nada', () => {
  for (const input of [JSON.stringify({ hook_event_name: 'constructor' }), JSON.stringify({ hook_event_name: 'toString' }), 'null']) {
    const r = run(['--hook'], input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '', input);
  }
  assert.deepEqual(hist(), []);
});

test('hook: agente que não é do nabuco é registrado sem papel', () => {
  run(['--hook'], JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'z' }));
  const [e] = hist();
  assert.equal(e.papel, null); assert.equal(e.dados.agente, 'Explore');
});

test('CLI --tarefa: correcao_usuario depois de concluir conta como escape e entra nos sinais (achado final #2)', () => {
  const CEREBRO = join(RAIZ, 'scripts', 'cerebro.mjs');
  const T = (...a) => spawnSync(process.execPath, [TAREFA, ...a], { cwd: proj, encoding: 'utf8', env: env() });
  const C = (...a) => spawnSync(process.execPath, [CEREBRO, ...a], { cwd: proj, encoding: 'utf8', env: env() });
  const nome = T('nova', '--slug', 'login', '--tamanho', 'media', '--tipo', 'bug').stdout.trim().split(/[\\/]/).pop();
  T('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  T('criterio', '--id', 'c1', '--status', 'passou', '--evidencia', 'ok');
  assert.equal(T('concluir').status, 0);
  const r = run(['correcao_usuario', '--papel', 'dev', '--tarefa', nome, '--dados={"apos_pronto":true,"resumo":"x"}']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(hist().at(-1).tarefa, nome);
  assert.equal(JSON.parse(C('metricas', '--papel', 'dev', '--json').stdout).dev.escapes, 1);
  const s = JSON.parse(C('sinais', '--tarefa', nome).stdout);
  assert.deepEqual(s.correcoes_usuario, [{ papel: 'dev', dados: { apos_pronto: true, resumo: 'x' } }]);
  for (const ruim of ['../x', 'a/b', 'a\\b', '..', '']) assert.equal(run(['correcao_usuario', '--tarefa', ruim]).status, 2, ruim);
  // tarefa que não existe mais: o evento vai só para o histórico, com o nome informado
  assert.equal(run(['correcao_usuario', '--tarefa', 'sumiu']).status, 0);
  assert.equal(hist().at(-1).tarefa, 'sumiu');
});

test('detectarHarness: variáveis reais do Codex e aninhamento com o Claude Code', () => {
  const codex = { CODEX_THREAD_ID: 't1', CODEX_SESSION_ID: 's1', CODEX_VERSION: '0.163.0' };
  assert.equal(detectarHarness({}, codex), 'codex');
  assert.equal(detectarHarness({}, { CLAUDECODE: '1', ...codex }), 'codex'); // Codex aberto de dentro do Claude Code
  assert.equal(detectarHarness({ turn_id: 'x' }, { CLAUDECODE: '1' }), 'codex'); // payload de hook do Codex
  assert.equal(detectarHarness({}, { CLAUDECODE: '1' }), 'claude');
  assert.equal(detectarHarness({}, { CLAUDE_PROJECT_DIR: 'c:/p', ...codex }), 'claude'); // hook do Claude Code
  assert.equal(detectarHarness({}, { NABUCO_HARNESS: 'teste', ...codex }), 'teste');
  assert.equal(detectarHarness({}, {}), 'desconhecido');
});

test('CLI: sem tarefa ativa e histórico global não gravável → falha (o evento não teria onde ficar)', () => {
  writeFileSync(join(base, 'arquivo'), 'x');
  const r = spawnSync(process.execPath, [EV, 'achado', '--papel', 'revisor'], { cwd: proj, input: '', encoding: 'utf8', env: { ...env(), NABUCO_HOME: join(base, 'arquivo', 'sub') } });
  assert.notEqual(r.status, 0);
});
