import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarCaso, gravarCaso, lerCasos, formatarCaso } from '../scripts/lib/casos.mjs';

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'nabuco casos-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));
const caso = (o = {}) => ({ papel: 'dev', sintoma: 'Falha no build: cache', causa_raiz: 'cache velho', correcao: 'limpar', verificacao: 'npm test → ok', tags: ['cache', 'build'], turnos: 3, ...o });

test('validarCaso lista obrigatórios e papel inválido', () => {
  const e = validarCaso({ papel: 'dev' });
  for (const k of ['sintoma', 'causa_raiz', 'correcao', 'verificacao']) assert.ok(e.some(x => x.includes(k)), k);
  assert.ok(validarCaso(caso({ papel: 'chefe' })).some(x => x.includes('papel')));
  assert.deepEqual(validarCaso(caso()), []);
  assert.ok(validarCaso(caso({ turnos: -1 })).length);
  assert.ok(validarCaso(caso({ tags: [1] })).length);
});

test('gravarCaso numera duplicatas', () => {
  const a = gravarCaso(home, caso()), b = gravarCaso(home, caso());
  assert.match(a, /^casos\/dev\/\d{4}-\d{2}-falha-no-build-cache\.md$/);
  assert.match(b, /-cache-2\.md$/);
  assert.ok(existsSync(join(home, b)));
});

test('lerCasos relê tags, turnos e arquivo', () => {
  const arq = gravarCaso(home, caso({ recorrencia_de: 'dev-0001' }));
  assert.deepEqual(lerCasos(home, 'gerente'), []);
  const [c] = lerCasos(home, 'dev');
  assert.equal(c.arquivo, arq); assert.deepEqual(c.tags, ['cache', 'build']);
  assert.equal(c.turnos, 3); assert.equal(c.causa_raiz, 'cache velho'); assert.equal(c.recorrencia_de, 'dev-0001');
  assert.equal(lerCasos(home).length, 1);
});

test('formatarCaso segue a spec', () => {
  const t = formatarCaso(caso({ hipotese_errada: 'rede' }));
  assert.match(t, /^sintoma: /m); assert.match(t, /^causa raiz: /m); assert.match(t, /^hipótese errada: rede$/m);
  assert.match(t, /^verificação: /m);
  assert.ok(t.trim().endsWith('custo: 3 turnos · tags: cache, build · papel: dev'));
});
