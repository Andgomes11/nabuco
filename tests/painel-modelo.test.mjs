import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  velocidadeChuva, corDoEstado, rotuloNivel, formatarAtributo, seta, urlAvatar,
  rotuloEstado, urlFontes, formatarIndicador, ATRIBUTOS, INDICADORES,
} from '../scripts/painel/publico/modelo.mjs';

test('velocidadeChuva: ocioso e aguardando param; trabalhando = 2 + 18 × atividade', () => {
  assert.equal(velocidadeChuva({ estado: 'ocioso', atividade: 1 }), 0);
  assert.equal(velocidadeChuva({ estado: 'aguardando', atividade: 1 }), 0);
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: 0.5 }), 11);
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: 0 }), 2);
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: 1 }), 20);
});

test('velocidadeChuva: entrada estranha não quebra nem passa dos limites', () => {
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: 7 }), 20);
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: -1 }), 2);
  assert.equal(velocidadeChuva({ estado: 'trabalhando' }), 2);
  assert.equal(velocidadeChuva({ estado: 'trabalhando', atividade: NaN }), 2);
  assert.equal(velocidadeChuva({ estado: 'xyz', atividade: 1 }), 0);
  assert.equal(velocidadeChuva(null), 0);
});

test('corDoEstado', () => {
  assert.equal(corDoEstado('trabalhando'), 'verde');
  assert.equal(corDoEstado('aguardando'), 'vermelho');
  assert.equal(corDoEstado('ocioso'), 'apagado');
  assert.equal(corDoEstado(undefined), 'apagado');
});

test('rotuloEstado: estado em texto, não só cor', () => {
  assert.equal(rotuloEstado('trabalhando'), 'trabalhando');
  assert.equal(rotuloEstado('aguardando'), 'aguardando você');
  assert.equal(rotuloEstado('ocioso'), 'ocioso');
  assert.equal(rotuloEstado('???'), 'ocioso');
});

test('rotuloNivel', () => {
  assert.equal(rotuloNivel({ nivel: 'Sênior', provisorio: false }), 'Sênior');
  assert.equal(rotuloNivel({ nivel: 'Sênior', provisorio: true }), 'Sênior · provisório');
  assert.equal(rotuloNivel({ nivel: null }), 'sem avaliação');
  assert.equal(rotuloNivel({ nivel: null, provisorio: true }), 'sem avaliação');
  assert.equal(rotuloNivel({}), 'sem avaliação');
  assert.equal(rotuloNivel(null), 'sem avaliação');
});

test('formatarAtributo', () => {
  assert.equal(formatarAtributo(0.756), '76%');
  assert.equal(formatarAtributo(0), '0%');
  assert.equal(formatarAtributo(1), '100%');
  assert.equal(formatarAtributo(null), '—');
  assert.equal(formatarAtributo(undefined), '—');
  assert.equal(formatarAtributo(NaN), '—');
});

test('seta', () => {
  assert.equal(seta('↑'), '↑');
  assert.equal(seta('↓'), '↓');
  assert.equal(seta('→'), '→');
  assert.equal(seta(null), '');
  assert.equal(seta('x'), '');
});

test('urlAvatar', () => {
  assert.equal(urlAvatar({ avatar: 'dev-3.jpg' }, 'abc123'), '/avatares/dev-3.jpg?k=abc123');
  assert.equal(urlAvatar({ avatar: null }, 'abc123'), null);
  assert.equal(urlAvatar({}, 'abc123'), null);
  assert.equal(urlAvatar(null, 'abc123'), null);
});

test('urlFontes: papel, indicador, versão e chave codificados', () => {
  assert.equal(urlFontes('dev', 'aceitacao_1a', 45, 'k1'), '/api/fontes/dev/aceitacao_1a?v=45&k=k1');
});

test('ATRIBUTOS ligam cada atributo aos indicadores que o alimentam', () => {
  assert.deepEqual(ATRIBUTOS.map(a => [a.chave, a.indicadores]), [
    ['faro', ['turnos_ate_causa']],
    ['precisao', ['aceitacao_1a']],
    ['confiabilidade', ['recorrencia', 'escapes']],
  ]);
  assert.deepEqual(INDICADORES.map(i => i.chave), [
    'amostra', 'aceitacao_1a', 'tentativas_ate_verde', 'recorrencia', 'turnos_ate_causa', 'escapes', 'pct_util', 'promocoes',
  ]);
});

test('formatarIndicador: taxas em %, contagens inteiras, médias com 1 casa, nulo = —', () => {
  assert.equal(formatarIndicador('aceitacao_1a', 0.8), '80%');
  assert.equal(formatarIndicador('recorrencia', 0.25), '25%');
  assert.equal(formatarIndicador('pct_util', 1), '100%');
  assert.equal(formatarIndicador('amostra', 12), '12');
  assert.equal(formatarIndicador('escapes', 0), '0');
  assert.equal(formatarIndicador('promocoes', 3), '3');
  assert.equal(formatarIndicador('tentativas_ate_verde', 1.5), '1,5');
  assert.equal(formatarIndicador('turnos_ate_causa', 2), '2,0');
  assert.equal(formatarIndicador('escapes', null), '—');
  assert.equal(formatarIndicador('aceitacao_1a', undefined), '—');
});

test('resumoGate: sem critérios => neutro "nenhum critério definido", nunca "todos passaram"', async () => {
  const { resumoGate } = await import('../scripts/painel/publico/modelo.mjs');
  const vazio = resumoGate({ passou: 0, total: 0, pendencias: [] });
  assert.equal(vazio.situacao, 'vazio');
  assert.equal(vazio.mensagem, 'nenhum critério definido');
  assert.equal(vazio.placar, '0/0');
  assert.deepEqual(vazio.pendencias, []);
  assert.equal(resumoGate(undefined).situacao, 'vazio');
  const ok = resumoGate({ passou: 2, total: 2, pendencias: [] });
  assert.equal(ok.situacao, 'ok');
  assert.equal(ok.mensagem, 'todos os critérios passaram com evidência');
  const pend = resumoGate({ passou: 1, total: 2, pendencias: [{ id: 'c2', motivo: 'm' }] });
  assert.equal(pend.situacao, 'pendente');
  assert.equal(pend.mensagem, null);
  assert.deepEqual(pend.pendencias, [{ id: 'c2', motivo: 'm' }]);
  // placar incompleto sem pendências listadas não vira "todos passaram"
  assert.equal(resumoGate({ passou: 1, total: 2, pendencias: [] }).situacao, 'pendente');
});
