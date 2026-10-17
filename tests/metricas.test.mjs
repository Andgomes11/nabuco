import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcularMetricas, lerHistorico } from '../scripts/lib/metricas.mjs';

let relogio = 0;
const ts = () => new Date(Date.UTC(2026, 0, 1) + (relogio++) * 60000).toISOString();
const ev = (tipo, tarefa, papel, dados = {}, projeto = 'p') => ({ ts: ts(), tarefa, projeto, harness: 'claude', tipo, papel, dados });
// tarefa fechada em que `papel` escreveu; corrigida => com rodada_correcao
function tarefa(n, { papel = 'dev', corrigida = false, falhas = 0 } = {}) {
  const t = `t${n}`;
  const e = [ev('agente_inicio', t, papel)];
  for (let i = 0; i < falhas; i++) e.push(ev('criterio', t, 'gerente', { status: 'falhou' }));
  if (corrigida) e.push(ev('rodada_correcao', t, papel));
  e.push(ev('tarefa_fechada', t, 'gerente'));
  return e;
}
const muitas = (ini, n, o) => Array.from({ length: n }, (_, i) => tarefa(ini + i, o)).flat();

test('aceitacao_1a do escritor e null do checador', () => {
  const evs = [...tarefa(1), ...tarefa(2), ...tarefa(3), ...tarefa(4, { corrigida: true }), ev('agente_inicio', 't1', 'revisor')];
  const m = calcularMetricas(evs);
  assert.equal(m.dev.aceitacao_1a, 0.75);
  assert.equal(m.dev.amostra, 4);
  assert.equal(m.revisor.aceitacao_1a, null);
  assert.equal(m.revisor.tentativas_ate_verde, null);
});

test('tentativas_ate_verde: media de 1 + criterios falhos', () => {
  const m = calcularMetricas([...tarefa(1, { falhas: 2 }), ...tarefa(2)]);
  assert.equal(m.dev.tentativas_ate_verde, 2);
});

test('recorrencia e turnos_ate_causa (todos os tempos, incl. tarefa null)', () => {
  const m = calcularMetricas([
    ev('caso_criado', null, 'dev', { turnos: 4 }),
    ev('caso_criado', null, 'dev', { recorrencia_de: 'x', turnos: 6 }),
  ]);
  assert.equal(m.dev.recorrencia, 0.5);
  assert.equal(m.dev.turnos_ate_causa, 5);
  assert.equal(m.dev.amostra, 0);
});

test('pct_util e promocoes', () => {
  const m = calcularMetricas([
    ev('licao_usada', null, 'dev', { util: true }), ev('licao_usada', null, 'dev', { util: true }),
    ev('licao_usada', null, 'dev', { util: false }), ev('licao_usada', null, 'dev', { util: true }),
    ev('licao_promovida', null, 'dev', { id: 'dev-0001' }),
  ]);
  assert.equal(m.dev.pct_util, 0.75);
  assert.equal(m.dev.promocoes, 1);
  assert.equal(m.docs.pct_util, null);
});

test('escapes na janela', () => {
  const evs = [...tarefa(1), ev('correcao_usuario', 't1', 'dev', { apos_pronto: true }), ev('correcao_usuario', 't1', 'dev', { apos_pronto: false }), ...tarefa(2)];
  const m = calcularMetricas(evs);
  assert.equal(m.dev.escapes, 1);
  // score = media(aceitacao 1, 1-min(1,1/2)=0.5)
  assert.ok(Math.abs(m.dev.score - (1 + 0.5) / 2) < 1e-9);
});

test('nivel cai: 30 boas e depois 30 ruins', () => {
  const boas = muitas(1, 30);
  const so = calcularMetricas(boas).dev;
  const depois = calcularMetricas([...boas, ...muitas(100, 30, { corrigida: true })]).dev;
  assert.equal(so.nivel, 'Especialista');
  assert.equal(depois.aceitacao_1a, 0);
  assert.equal(depois.amostra, 30);
  assert.equal(depois.nivel, 'Pleno'); // (0 + 1 de escapes) / 2 = 0.5, menor que Especialista
});

test('janela: so tarefas fechadas, ordenadas por ts', () => {
  const m = calcularMetricas([...muitas(1, 35), ev('agente_inicio', 'aberta', 'designer')]);
  assert.equal(m.dev.amostra, 30);
  assert.equal(m.designer.amostra, 0);
  assert.equal(m.designer.nivel, null);
  assert.equal(m.designer.score, null);
  assert.equal(m.designer.provisorio, true);
});

test('sem dados: todos os papeis presentes, incl. gerente', () => {
  const m = calcularMetricas([]);
  assert.equal(Object.keys(m).length, 10);
  assert.deepEqual(m.gerente, { amostra: 0, aceitacao_1a: null, tentativas_ate_verde: null, recorrencia: null, turnos_ate_causa: null, escapes: null, pct_util: null, promocoes: 0, score: null, nivel: null, provisorio: true });
});

test('provisorio: amostra 9 vs 10', () => {
  assert.equal(calcularMetricas(muitas(1, 9)).dev.provisorio, true);
  assert.equal(calcularMetricas(muitas(1, 10)).dev.provisorio, false);
});

test('volume nao sobe nivel: 10 perfeitas e 30 perfeitas tem o mesmo score', () => {
  assert.equal(calcularMetricas(muitas(1, 10)).dev.score, calcularMetricas(muitas(1, 30)).dev.score);
});

// so votos de licao (sem tarefas): score = pct_util = k/n, isola os limiares
const comScore = (k, n) => calcularMetricas(Array.from({ length: n }, (_, i) => ev('licao_usada', null, 'dev', { util: i < k }))).dev;
test('limiares de nivel: 0.5, 0.7, 0.85 exatos e logo abaixo', () => {
  assert.equal(comScore(10, 20).score, 0.5); assert.equal(comScore(10, 20).nivel, 'Pleno');
  assert.equal(comScore(9, 20).nivel, 'Júnior');
  assert.equal(comScore(14, 20).score, 0.7); assert.equal(comScore(14, 20).nivel, 'Sênior');
  assert.equal(comScore(13, 20).nivel, 'Pleno');
  assert.equal(comScore(17, 20).score, 0.85); assert.equal(comScore(17, 20).nivel, 'Especialista');
  assert.equal(comScore(16, 20).nivel, 'Sênior');
});

test('linhas e eventos corrompidos nao quebram', () => {
  const evs = [null, 42, 'x', {}, { tipo: 5 }, { tipo: 'agente_inicio' }, { tipo: 'tarefa_fechada', tarefa: 't1' }, { tipo: 'caso_criado', papel: 'dev' },
    { tipo: 'licao_usada', papel: 'dev', dados: null }, { tipo: 'criterio', tarefa: 't1', projeto: 'p', dados: 'x' }, ...tarefa(1)];
  const m = calcularMetricas(evs);
  assert.equal(m.dev.amostra, 1);
  assert.equal(m.dev.aceitacao_1a, 1);
});

test('lerHistorico: ausente => [], ignora invalidas e sem tipo', () => {
  const d = mkdtempSync(join(tmpdir(), 'nabuco mt-'));
  try {
    assert.deepEqual(lerHistorico(join(d, 'nada')), []);
    writeFileSync(join(d, 'historico.jsonl'), ['{"tipo":"a"}', 'lixo{', '{"x":1}', '{"tipo":3}', '', '[1]', 'null', '{"tipo":"b"}'].join('\r\n'));
    assert.deepEqual(lerHistorico(d).map(e => e.tipo), ['a', 'b']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('checador não ganha nível só por participar: escapes só existe para escritores (achado final #3)', () => {
  const evs = muitas(1, 12).concat(Array.from({ length: 12 }, (_, i) => ev('agente_inicio', `t${i + 1}`, 'revisor')));
  const m = calcularMetricas(evs);
  assert.equal(m.revisor.amostra, 12);
  assert.equal(m.revisor.escapes, null);
  assert.equal(m.revisor.score, null);
  assert.equal(m.revisor.nivel, null);
  assert.equal(m.gerente.escapes, null);
  assert.equal(m.gerente.nivel, null);
  // com votos, o checador passa a ter nível pelos votos
  const v = calcularMetricas([...evs, ev('licao_usada', null, 'revisor', { util: true })]);
  assert.equal(v.revisor.score, 1);
  assert.equal(m.dev.escapes, 0);
});
