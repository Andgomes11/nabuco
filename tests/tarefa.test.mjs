import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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

test('nova: "ativa" velha apontando para tarefa já concluída/abandonada é limpa', () => {
  for (const fase of ['concluida', 'abandonada']) {
    const dir = run('nova', '--slug', `a-${fase}`, '--tamanho', 'trivial', '--tipo', 'bug').out.trim();
    const est = JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'));
    writeFileSync(join(dir, 'estado.json'), JSON.stringify({ ...est, fase }));
    const r = run('nova', '--slug', `b-${fase}`, '--tamanho', 'trivial', '--tipo', 'bug');
    assert.equal(r.code, 0, r.err);
    assert.match(readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8'), new RegExp(`b-${fase}`));
    run('abandonar');
  }
});

test('nova: recusa rodar na pasta global do nabuco', () => {
  const base = mkdtempSync(join(tmpdir(), 'nabuco global-'));
  try {
    const r = spawnSync(process.execPath, [CLI, 'nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug'],
      { cwd: base, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: join(base, '.nabuco'), NABUCO_HARNESS: 'teste' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /pasta global do nabuco; rode dentro de um projeto/);
    assert.ok(!existsSync(join(base, '.nabuco', 'tarefas')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('criterio-add: criterios.json sem lista → erro de regra', () => {
  const dir = run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug').out.trim();
  writeFileSync(join(dir, 'criterios.json'), '{"tarefa":"x"}');
  const r = run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(r.code, 1);
  assert.match(r.err, /criterios\.json inválido/);
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

test('criterio --status falhou grava evidência (500 chars) no evento', () => {
  run('nova', '--slug', 'ev', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(run('criterio', '--id', 'c1', '--status', 'falhou', '--evidencia=X').code, 0);
  run('criterio', '--id', 'c1', '--status', 'falhou', '--evidencia', 'y'.repeat(600));
  const nome = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const evs = linhas(join(proj, '.nabuco', 'tarefas', nome, 'eventos.jsonl')).filter(e => e.tipo === 'criterio' && e.dados.status === 'falhou');
  assert.equal(evs[0].dados.evidencia, 'X');
  assert.equal(evs[1].dados.evidencia.length, 500);
});

test('histórico global não gravável: comando da tarefa avisa e não falha (evento não duplica no retry)', () => {
  assert.equal(run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug').code, 0);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  writeFileSync(join(dirname(proj), 'arquivo'), 'x');
  home = join(dirname(proj), 'arquivo', 'sub'); // mkdir falha: o "pai" é um arquivo
  const r = run('aprovar');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /histórico global/);
  const tipos = linhas(join(proj, '.nabuco', 'tarefas', ativa, 'eventos.jsonl')).map(e => e.tipo);
  assert.deepEqual(tipos, ['tarefa_criada', 'plano_aprovado']);
});

test('criterio-editar: livre antes do plano aprovado; evento registra a edição', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'npm test');
  const r = run('criterio-editar', '--id', 'c1', '--verificacao=node --test');
  assert.equal(r.code, 0, r.err);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const dir = join(proj, '.nabuco', 'tarefas', ativa);
  const [c1] = JSON.parse(readFileSync(join(dir, 'criterios.json'), 'utf8')).criterios;
  assert.equal(c1.verificacao, 'node --test'); assert.equal(c1.descricao, 'd');
  const ev = linhas(join(dir, 'eventos.jsonl')).at(-1);
  assert.equal(ev.tipo, 'criterio');
  assert.deepEqual(ev.dados, { id: 'c1', acao: 'editado', verificacao: { de: 'npm test', para: 'node --test' } });
});

test('criterio-editar: depois do plano aprovado exige --ok-usuario e --motivo; verificação nova zera a evidência', () => {
  run('nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'npm test');
  run('aprovar');
  run('criterio', '--id', 'c1', '--status', 'passou', '--evidencia', '3 passed');
  const sem = run('criterio-editar', '--id', 'c1', '--verificacao=node --test');
  assert.equal(sem.code, 1);
  assert.match(sem.err, /plano já aprovado/);
  assert.equal(run('criterio-editar', '--id', 'c1', '--verificacao=node --test', '--ok-usuario').code, 2); // falta --motivo
  const ok = run('criterio-editar', '--id', 'c1', '--verificacao=node --test', '--motivo=sandbox bloqueia npm', '--ok-usuario');
  assert.equal(ok.code, 0, ok.err);
  const ativa = readFileSync(join(proj, '.nabuco', 'ativa'), 'utf8').trim();
  const dir = join(proj, '.nabuco', 'tarefas', ativa);
  const [c1] = JSON.parse(readFileSync(join(dir, 'criterios.json'), 'utf8')).criterios;
  assert.equal(c1.status, 'pendente'); assert.equal(c1.evidencia, '');
  const ev = linhas(join(dir, 'eventos.jsonl')).at(-1);
  assert.equal(ev.dados.motivo, 'sandbox bloqueia npm'); assert.equal(ev.dados.ok_usuario, true);
});

test('criterio-editar: sem campo para mudar → exit 2; id inexistente → exit 1', () => {
  run('nova', '--slug', 'x', '--tamanho', 'trivial', '--tipo', 'bug');
  run('criterio-add', '--id', 'c1', '--descricao', 'd', '--verificacao', 'v');
  assert.equal(run('criterio-editar', '--id', 'c1').code, 2);
  assert.equal(run('criterio-editar', '--id', 'c9', '--descricao=x').code, 1);
});
