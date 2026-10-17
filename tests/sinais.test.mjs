import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coletarSinais, propostasHigiene } from '../scripts/lib/sinais.mjs';

function fixture(eventos, progresso) {
  const dir = mkdtempSync(join(tmpdir(), 'nabuco sin-'));
  writeFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 'x', tamanho: 'media', tipo: 'bug', fase: 'executando' }));
  writeFileSync(join(dir, 'eventos.jsonl'), eventos.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') + '\n');
  if (progresso !== undefined) writeFileSync(join(dir, 'progresso.md'), progresso);
  return dir;
}
const ev = (tipo, papel, dados = {}) => ({ tipo, papel, dados });

test('coletarSinais agrega eventos e log', () => {
  const dir = fixture([
    ev('criterio', null, { id: 'c1', status: 'falhou', evidencia: 'AssertionError: x' }),
    ev('criterio', null, { id: 'c2', status: 'falhou', evidencia: 'read ECONNRESET' }),
    'linha {corrompida',
    ev('rodada_correcao', 'dev'), ev('rodada_correcao', 'dev'),
    ev('achado', 'revisor', { severidade: 'alta', resumo: 'bug' }),
    ev('gate_bloqueou', null),
    ev('correcao_usuario', 'dev', { apos_pronto: true }),
    ev('licao_usada', 'dev', { id: 'dev-0001', util: true }),
  ], '# P\n\n## Log\n- a\n- b\n\n## Outra\n- z\n');
  try {
    const s = coletarSinais(dir);
    assert.equal(s.tipo, 'bug'); assert.equal(s.tamanho, 'media');
    assert.deepEqual(s.criterios_falhos, [{ id: 'c1', evidencia: 'AssertionError: x' }]);
    assert.deepEqual(s.transitorios, [{ id: 'c2', evidencia: 'read ECONNRESET' }]);
    assert.equal(s.rodadas, 2); assert.equal(s.gate_bloqueios, 1);
    assert.deepEqual(s.papeis.sort(), ['dev', 'revisor']);
    assert.deepEqual(s.achados, [{ papel: 'revisor', severidade: 'alta', resumo: 'bug' }]);
    assert.deepEqual(s.correcoes_usuario, [{ papel: 'dev', dados: { apos_pronto: true } }]);
    assert.deepEqual(s.licoes_usadas, [{ id: 'dev-0001', util: true }]);
    assert.deepEqual(s.log, ['- a', '- b']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('coletarSinais: bug_resolvido só para bug concluído', () => {
  const casos = [['bug', 'concluida', true], ['bug', 'executando', false], ['feature', 'concluida', false]];
  for (const [tipo, fase, esperado] of casos) {
    const dir = fixture([]);
    writeFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 'x', tipo, fase }));
    try { assert.equal(coletarSinais(dir).bug_resolvido, esperado, tipo + '/' + fase); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('coletarSinais sem progresso.md nem eventos.jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nabuco sin-'));
  try {
    const s = coletarSinais(dir);
    assert.deepEqual(s.log, []); assert.deepEqual(s.papeis, []); assert.equal(s.rodadas, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const b = (n, o = {}) => ({ id: `dev-${String(n).padStart(4, '0')}`, escopo: 'global', positivos: 0, negativos: 0, ultima: '2026-10-01', regra: null, ...o });

test('higiene: excesso, sem_uso, ruim, promover', () => {
  const muitas = Array.from({ length: 31 }, (_, i) => b(i + 1));
  assert.deepEqual(propostasHigiene(muitas, '2026-10-17').map(p => [p.id, p.papel, p.motivo]), [[null, 'dev', 'excesso']]);
  assert.match(propostasHigiene(muitas, '2026-10-17')[0].detalhe, /31.*global/);
  assert.equal(propostasHigiene([b(1, { ultima: '2026-01-01' })], '2026-10-17')[0].motivo, 'sem_uso');
  assert.equal(propostasHigiene([b(1, { positivos: 1, negativos: 2 })], '2026-10-17')[0].motivo, 'ruim');
  assert.equal(propostasHigiene([b(1, { positivos: 5 })], '2026-10-17')[0].motivo, 'promover');
  assert.deepEqual(propostasHigiene([b(1, { positivos: 5, regra: 'hook' })], '2026-10-17'), []);
});

test('higiene: excesso conta por escopo', () => {
  const l = [...Array.from({ length: 20 }, (_, i) => b(i + 1)), ...Array.from({ length: 20 }, (_, i) => b(i + 21, { escopo: 'projeto' }))];
  assert.deepEqual(propostasHigiene(l, '2026-10-17'), []);
});

test('higiene: limites — 30 lições sem excesso, 31 com', () => {
  const n = k => Array.from({ length: k }, (_, i) => b(i + 1));
  assert.deepEqual(propostasHigiene(n(30), '2026-10-17'), []);
  assert.deepEqual(propostasHigiene(n(31), '2026-10-17').map(p => p.motivo), ['excesso']);
});

test('higiene: limites — última há exatamente 90 dias não é sem_uso; 91 é', () => {
  assert.deepEqual(propostasHigiene([b(1, { ultima: '2026-07-19' })], '2026-10-17'), []);
  assert.deepEqual(propostasHigiene([b(1, { ultima: '2026-07-18' })], '2026-10-17').map(p => p.motivo), ['sem_uso']);
});

test('higiene: limites de promover e ruim', () => {
  const motivos = o => propostasHigiene([b(1, o)], '2026-10-17').map(p => p.motivo);
  assert.deepEqual(motivos({ positivos: 4, negativos: 0 }), [], '👍4 👎0 ainda não promove');
  assert.deepEqual(motivos({ positivos: 5, negativos: 0 }), ['promover']);
  assert.deepEqual(motivos({ positivos: 5, negativos: 1 }), [], '👍5 👎1 não promove');
  assert.deepEqual(motivos({ positivos: 2, negativos: 2 }), [], '👍=👎 não é ruim');
  assert.deepEqual(motivos({ positivos: 2, negativos: 3 }), ['ruim']);
});

test('higiene: lição sem "última" é proposta como sem_uso', () => {
  const p = propostasHigiene([b(1, { ultima: null })], '2026-10-17');
  assert.deepEqual(p.map(x => [x.id, x.motivo]), [['dev-0001', 'sem_uso']]);
  assert.match(p[0].detalhe, /sem data/);
});
