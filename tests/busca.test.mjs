import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranquear } from '../scripts/lib/busca.mjs';

const HOJE = '2026-10-17';
const L = (id, o = {}) => ({
  id, titulo: 'Titulo', gatilho: 'gatilho qualquer', expectativa: 'x', faca: 'faca algo', porque: 'y',
  evidencia: [], escopo: 'global', positivos: 0, negativos: 0, ultima: '2026-01-01', regra: null, aposentada: null, ...o,
});
const Q = "TypeError: cannot read properties of undefined (reading 'map')";
const ids = r => r.map(x => x.bloco.id);

const fixture = () => [
  L('dev-0001', { gatilho: 'Mensagem de CSS quebrado no build' }),
  L('dev-0002', { gatilho: 'TypeError cannot read properties of undefined ao chamar map', faca: 'checar array antes' }),
  L('dev-0003', { gatilho: 'Timeout no deploy' }),
  L('dev-0004', { gatilho: 'undefined em objeto' }),
  L('dev-0005', { gatilho: 'reading map', regra: 'hook' }),
];

test('lição cujo gatilho casa vem primeiro; promovida nunca aparece', () => {
  const r = ranquear(fixture(), { texto: Q, arquivos: [], hoje: HOJE });
  assert.equal(r[0].bloco.id, 'dev-0002');
  assert.ok(!ids(r).includes('dev-0005'));
  assert.ok(r.every(x => x.score > 0));
});

test('no máximo 3 resultados', () => {
  const bs = Array.from({ length: 8 }, (_, i) => L(`dev-000${i + 1}`, { gatilho: 'undefined map' }));
  assert.equal(ranquear(bs, { texto: Q, arquivos: [], hoje: HOJE }).length, 3);
});

test('empate de correspondência é decidido por 👍−👎, depois id menor', () => {
  const bs = [
    L('dev-0001', { gatilho: 'undefined' }),
    L('dev-0002', { gatilho: 'undefined', positivos: 3, negativos: 1 }),
    L('dev-0003', { gatilho: 'undefined' }),
  ];
  assert.deepEqual(ids(ranquear(bs, { texto: 'undefined', arquivos: [], hoje: HOJE })), ['dev-0002', 'dev-0001', 'dev-0003']);
});

test('consulta sem tokens úteis → []', () => {
  assert.deepEqual(ranquear(fixture(), { texto: 'a de o ??', arquivos: [], hoje: HOJE }), []);
  assert.deepEqual(ranquear(fixture(), { texto: '', arquivos: [], hoje: HOJE }), []);
});

test('sem correspondência não aparece, mesmo com votos e recência', () => {
  const bs = [L('dev-0001', { gatilho: 'zzz', positivos: 9, ultima: HOJE })];
  assert.deepEqual(ranquear(bs, { texto: 'undefined', arquivos: [], hoje: HOJE }), []);
});

test('acentos, caixa e pontuação não mudam o resultado', () => {
  const bs = [L('dev-0001', { gatilho: 'Não foi possível resolver módulo' }), L('dev-0002', { gatilho: 'outra coisa' })];
  const a = ranquear(bs, { texto: 'Não foi possível', arquivos: [], hoje: HOJE });
  const b = ranquear(bs, { texto: 'NAO FOI POSSIVEL:', arquivos: [], hoje: HOJE });
  assert.deepEqual(a, b);
  assert.equal(a[0].bloco.id, 'dev-0001');
});

test('palavra repetida na consulta não infla a correspondência', () => {
  const bs = [L('dev-0001', { gatilho: 'undefined' })];
  const a = ranquear(bs, { texto: 'undefined', arquivos: [], hoje: HOJE });
  const b = ranquear(bs, { texto: 'undefined undefined undefined', arquivos: [], hoje: HOJE });
  assert.equal(a[0].score, b[0].score);
});

test('pesos: gatilho 2, título+faça 1, recência 1, projeto 0,5, votos 0,5', () => {
  const base = L('dev-0001', { gatilho: 'undefined', ultima: '2026-01-01' });
  assert.equal(ranquear([base], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 2);
  const tf = L('dev-0001', { gatilho: 'x', titulo: 'undefined', faca: 'undefined' });
  assert.equal(ranquear([tf], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 1);
  assert.equal(ranquear([{ ...base, ultima: '2026-10-01' }], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 3);
  assert.equal(ranquear([{ ...base, ultima: '2026-09-17' }], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 3);
  assert.equal(ranquear([{ ...base, ultima: '2026-09-16' }], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 2);
  assert.equal(ranquear([{ ...base, escopo: 'projeto' }], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 2.5);
  assert.equal(ranquear([{ ...base, positivos: 2, negativos: 1 }], { texto: 'undefined', arquivos: [], hoje: HOJE })[0].score, 2.5);
});

test('projeto vem antes do global em empate', () => {
  const bs = [L('dev-0001', { gatilho: 'undefined' }), L('dev-0009', { gatilho: 'undefined', escopo: 'projeto' })];
  assert.deepEqual(ids(ranquear(bs, { texto: 'undefined', arquivos: [], hoje: HOJE })), ['dev-0009', 'dev-0001']);
});

test('arquivos citados casam por nome de arquivo, sem caixa e sem diretório', () => {
  const bs = [L('dev-0001', { gatilho: 'erro em User.ts ao salvar' }), L('dev-0002', { gatilho: 'nada a ver' })];
  const r = ranquear(bs, { texto: '', arquivos: ['src/auth/user.ts'], hoje: HOJE });
  assert.deepEqual(ids(r), ['dev-0001']);
  assert.equal(r[0].score, 2);
  assert.equal(ranquear(bs, { texto: '', arquivos: ['src\\auth\\USER.TS'], hoje: HOJE }).length, 1);
});
