import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerLicoes, serializarBloco, substituirBloco, acrescentarBloco, proximoId } from '../scripts/lib/licoes.mjs';

const B1 = '## dev-0001 · Rodar o build limpo antes de culpar o cache\r\n- gatilho: build passa local e falha no CI\r\n- expectativa: se for cache, limpar resolve\r\n- faça: apagar dist e rebuildar\r\n- por quê: artefato velho\r\n- evidência: [c1](casos/dev/2026-10-a.md), [c2](casos/dev/2026-10-b.md) · escopo: global\r\n- 👍 2  👎 1 · última: 2026-10-01\r\n';
const LIVRE = 'minha anotação livre\r\n';
const B2 = '## dev-0002 · Ler o erro inteiro\r\n- gatilho: stack trace longo\r\n- expectativa: causa na primeira linha\r\n- faça: ler de cima\r\n- por quê: pressa\r\n- evidência: [c3](casos/dev/2026-10-c.md) · escopo: projeto\r\n- 👍 4  👎 0 · última: 2026-10-05\r\n';
const T = '﻿# Lições — dev\r\n\r\n' + B1 + LIVRE + '\r\n' + B2;

test('lerLicoes: dois blocos com campos corretos', () => {
  const { cabecalho, blocos } = lerLicoes(T);
  assert.equal(blocos.length, 2);
  assert.ok(cabecalho.startsWith('# Lições — dev'));
  const [a, b] = blocos;
  assert.equal(a.id, 'dev-0001'); assert.equal(a.titulo, 'Rodar o build limpo antes de culpar o cache');
  assert.equal(a.gatilho, 'build passa local e falha no CI');
  assert.deepEqual([a.positivos, a.negativos, a.ultima], [2, 1, '2026-10-01']);
  assert.deepEqual(a.evidencia, ['[c1](casos/dev/2026-10-a.md)', '[c2](casos/dev/2026-10-b.md)']);
  assert.equal(a.escopo, 'global'); assert.equal(a.regra, null); assert.equal(a.aposentada, null);
  assert.equal(b.escopo, 'projeto'); assert.equal(b.positivos, 4);
  assert.ok(a.bruto.startsWith('## dev-0001') && a.bruto.includes('\r\n'));
});

test('serializarBloco reproduz o formato da spec', () => {
  const b = lerLicoes(T).blocos[0];
  const esperado = B1.replace(/\r\n/g, '\n');
  assert.equal(serializarBloco(b), esperado);
  assert.deepEqual(lerLicoes(serializarBloco(b)).blocos[0], { ...b, bruto: serializarBloco(b) });
});

test('serializarBloco: regra e aposentada opcionais', () => {
  const b = { ...lerLicoes(T).blocos[0], regra: 'hook X', aposentada: '2026-10-10 · obsoleta' };
  const s = serializarBloco(b);
  assert.ok(s.includes('- regra: hook X\n') && s.includes('- aposentada: 2026-10-10 · obsoleta\n'));
  const r = lerLicoes(s).blocos[0];
  assert.equal(r.regra, 'hook X'); assert.equal(r.aposentada, '2026-10-10 · obsoleta');
});

test('substituirBloco: só a linha 👍 do bloco 2 muda', () => {
  const b = lerLicoes(T).blocos[1];
  const r = substituirBloco(T, 'dev-0002', { ...b, positivos: 3 });
  assert.equal(r, T.replace('👍 4  👎 0', '👍 3  👎 0'));
  assert.ok(r.startsWith('﻿'));
});

test('substituirBloco: preserva linha livre dentro do bloco e CRLF', () => {
  const b = lerLicoes(T).blocos[0];
  const r = substituirBloco(T, 'dev-0001', { ...b, negativos: 2 });
  assert.equal(r, T.replace('👎 1', '👎 2'));
});

test('substituirBloco null remove só o bloco e preserva texto livre', () => {
  const b1 = lerLicoes(T).blocos[0];
  assert.equal(b1.bruto, B1);
  const r = substituirBloco(T, 'dev-0001', null);
  assert.equal(r, T.replace(B1, ''));
  assert.ok(r.includes(LIVRE));
  assert.deepEqual(lerLicoes(r).blocos.map(x => x.id), ['dev-0002']);
  assert.equal(substituirBloco(T, 'dev-9999', null), T);
  const comRodape = T + 'rodapé do usuário\r\n';
  const r2 = substituirBloco(comRodape, 'dev-0002', null);
  assert.equal(r2, comRodape.replace(B2, ''));
  assert.ok(r2.endsWith('rodapé do usuário\r\n'));
});

test('seções que não são lições ficam intactas e fora de blocos', () => {
  const t = '# Lições — dev\n\n## Notas\ntexto meu\n\n## dev-0001 · a\n- gatilho: g\n\n## Outra\nx\n';
  const { blocos } = lerLicoes(t);
  assert.deepEqual(blocos.map(x => x.id), ['dev-0001']);
  assert.equal(substituirBloco(t, 'dev-0001', null), '# Lições — dev\n\n## Notas\ntexto meu\n\n## Outra\nx\n');
});

test('título com outro separador ou sem título', () => {
  for (const [h, tit] of [['## dev-0001 - um', 'um'], ['## dev-0001 — um', 'um'], ['## dev-0001: um', 'um'], ['## dev-0001 – um', 'um'], ['## dev-0001', '']]) {
    const [b] = lerLicoes(h + '\n- gatilho: g\n').blocos;
    assert.equal(b.id, 'dev-0001', h); assert.equal(b.titulo, tit, h);
  }
});

test('campos em NFD são reconhecidos', () => {
  const t = ('## dev-0001 · a\n- gatilho: g\n- faça: f\n- por quê: p\n- evidência: x · escopo: projeto\n').normalize('NFD');
  const [b] = lerLicoes(t).blocos;
  assert.deepEqual([b.faca, b.porque, b.escopo], ['f', 'p', 'projeto']);
});

test('bloco sem 👍/👎 não lança', () => {
  const { blocos } = lerLicoes('# Lições — dev\n\n## dev-0003 · x\n- gatilho: y\n- faça: z\n');
  assert.equal(blocos[0].positivos, 0); assert.equal(blocos[0].negativos, 0);
  assert.equal(blocos[0].ultima, null);
  assert.deepEqual(lerLicoes('').blocos, []);
});

test('proximoId', () => {
  assert.equal(proximoId('dev', [T, '## dev-0007 · x\n']), 'dev-0008');
  assert.equal(proximoId('dev', []), 'dev-0001');
  assert.equal(proximoId('dev', ['## tester-0099 · x\n']), 'dev-0001');
});

test('acrescentarBloco', () => {
  const b = lerLicoes(T).blocos[0];
  const novo = acrescentarBloco('', 'dev', b);
  assert.ok(novo.startsWith('# Lições — dev\n\n## dev-'));
  const dois = acrescentarBloco(novo, 'dev', { ...b, id: 'dev-0002' });
  assert.ok(dois.startsWith(novo));
  assert.deepEqual(lerLicoes(dois).blocos.map(x => x.id), ['dev-0001', 'dev-0002']);
  const semFim = acrescentarBloco('# Lições — dev', 'dev', b);
  assert.equal(lerLicoes(semFim).blocos.length, 1);
});
