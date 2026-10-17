import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizar, similaridade, ehTransitorio, normalizarTag } from '../scripts/lib/texto.mjs';

test('tokenizar ignora acentos, caixa e pontuação', () => {
  const a = tokenizar('Não foi possível: TypeError em user.ts');
  assert.deepEqual(a, tokenizar('nao foi possivel typeerror em USER.ts'));
  assert.ok(a.includes('typeerror')); assert.ok(a.includes('possivel'));
  assert.ok(!a.includes('em')); assert.ok(!a.includes('nao'));
});

test('similaridade (Jaccard)', () => {
  assert.ok(similaridade('erro de cache no build', 'build com erro de cache') >= 0.6);
  assert.equal(similaridade('a', ''), 0);
  assert.equal(similaridade('', ''), 0);
});

test('ehTransitorio', () => {
  assert.equal(ehTransitorio('npm ERR! code ECONNRESET'), true);
  assert.equal(ehTransitorio("'node' não é reconhecido como um comando"), true);
  assert.equal(ehTransitorio('AssertionError: expected 3'), false);
  assert.equal(ehTransitorio(undefined), false);
});

test('normalizarTag: minúsculas, sem acento, separadores viram "-", sem corte de tamanho', () => {
  assert.equal(normalizarTag('UI'), 'ui');
  assert.equal(normalizarTag('db'), 'db');
  assert.equal(normalizarTag('Estatística'), 'estatistica');
  assert.equal(normalizarTag(' off_by one '), 'off-by-one');
  assert.equal(normalizarTag('--'), '');
});
