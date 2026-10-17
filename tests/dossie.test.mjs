import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atributos, tendencia, montarDossie } from '../scripts/lib/dossie.mjs';
import { formatarCaso } from '../scripts/lib/casos.mjs';

let relogio = 0;
const ts = () => new Date(Date.UTC(2026, 0, 1) + (relogio++) * 60000).toISOString();
const ev = (tipo, tarefa, papel, dados = {}) => ({ ts: ts(), tarefa, projeto: 'p', harness: 'claude', tipo, papel, dados });
function tarefa(n, corrigida) {
  const t = `t${n}`;
  return [ev('agente_inicio', t, 'dev'), ...(corrigida ? [ev('rodada_correcao', t, 'dev')] : []), ev('tarefa_fechada', t, 'gerente')];
}
const muitas = (ini, n, corrigida) => Array.from({ length: n }, (_, i) => tarefa(ini + i, corrigida)).flat();
const NULO = { faro: null, precisao: null, confiabilidade: null };

test('atributos: fórmulas das Decisões', () => {
  assert.deepEqual(atributos({ turnos_ate_causa: 1, aceitacao_1a: 0.75, recorrencia: 0.5, escapes: 0, amostra: 4 }), { faro: 1, precisao: 0.75, confiabilidade: 0.75 });
  assert.equal(atributos({ turnos_ate_causa: 10 }).faro, 0);
  assert.equal(atributos({ turnos_ate_causa: 5.5 }).faro, 0.5);
  assert.equal(atributos({ turnos_ate_causa: 0 }).faro, 1);
  // escapes só conta com amostra > 0
  assert.equal(atributos({ recorrencia: 0.2, escapes: 3, amostra: 0 }).confiabilidade, 0.8);
  assert.equal(atributos({ recorrencia: null, escapes: 1, amostra: 2 }).confiabilidade, 0.5);
  assert.deepEqual(atributos({ turnos_ate_causa: null, aceitacao_1a: null, recorrencia: null, escapes: null, amostra: 0 }), NULO);
  assert.deepEqual(atributos(undefined), NULO);
});

test('tendência: 10 ruins e depois 10 boas => precisão ↑; inverso ↓; estável →', () => {
  assert.equal(tendencia([...muitas(1, 10, true), ...muitas(100, 10, false)], 'dev').precisao, '↑');
  assert.equal(tendencia([...muitas(1, 10, false), ...muitas(100, 10, true)], 'dev').precisao, '↓');
  assert.equal(tendencia(muitas(1, 20, false), 'dev').precisao, '→');
});

test('tendência: sem "antes" (poucas tarefas) => null', () => {
  assert.deepEqual(tendencia(muitas(1, 3, false), 'dev'), NULO);
  assert.deepEqual(tendencia([], 'dev'), NULO);
});

let home, projeto, homeAntes;
const licao = (id, titulo, pos, neg, regra) =>
  `## ${id} · ${titulo}\n- gatilho: g\n- expectativa: e\n- faça: f\n- por quê: p\n- evidência: x · escopo: global\n- 👍 ${pos}  👎 ${neg}\n${regra ? `- regra: ${regra}\n` : ''}\n`;

before(() => {
  homeAntes = process.env.NABUCO_HOME;
  home = mkdtempSync(join(tmpdir(), 'nabuco dossiê-'));
  projeto = mkdtempSync(join(tmpdir(), 'nabuco projeto ç-'));
  process.env.NABUCO_HOME = home;
  mkdirSync(join(home, 'casos', 'dev'), { recursive: true });
  const caso = (sintoma, causa) => formatarCaso({ papel: 'dev', sintoma, causa_raiz: causa, correcao: 'c', verificacao: 'v', tags: [] });
  writeFileSync(join(home, 'casos', 'dev', '2026-08-antigo.md'), caso('quebrou antes', 'causa A'));
  writeFileSync(join(home, 'casos', 'dev', '2026-09-novo.md'), caso('quebrou depois', 'causa B'));
  mkdirSync(join(home, 'licoes'), { recursive: true });
  writeFileSync(join(home, 'licoes', 'dev.md'), `# Lições — dev\n\n${licao('dev-0001', 'ruim', 1, 3)}${licao('dev-0002', 'promovida', 6, 0, 'sempre rode o teste')}`);
  mkdirSync(join(projeto, '.nabuco', 'licoes'), { recursive: true });
  writeFileSync(join(projeto, '.nabuco', 'licoes', 'dev.md'), `# Lições — dev\n\n${licao('dev-0003', 'boa do projeto', 2, 1)}`);
});
after(() => {
  if (homeAntes === undefined) delete process.env.NABUCO_HOME; else process.env.NABUCO_HOME = homeAntes;
  rmSync(home, { recursive: true, force: true });
  rmSync(projeto, { recursive: true, force: true });
});

const modelos = {
  claude: { dev: { model: null, effort: 'high' }, docs: { model: 'inherit', effort: 'medium' }, revisor: { model: 'opus', effort: 'high' } },
  codex: { dev: { model: null, effort: 'high' }, revisor: { model: 'gpt-x', effort: 'low' } },
};

test('montarDossie: diário, lições, talentos, equipamento, métricas', () => {
  const eventos = [...muitas(1, 4, false), ev('caso_criado', null, 'dev', { turnos: 1 })];
  const d = montarDossie({ papel: 'dev', eventos, home, projeto, modelos, nome: 'Dev' });
  assert.equal(d.papel, 'dev');
  assert.equal(d.nome, 'Dev');
  assert.deepEqual(d.diario.map(c => c.data), ['2026-09', '2026-08']);
  assert.deepEqual(d.diario[0], { data: '2026-09', sintoma: 'quebrou depois', causa_raiz: 'causa B', arquivo: 'casos/dev/2026-09-novo.md' });
  assert.equal(d.licoes.length, 2);
  const porId = Object.fromEntries(d.licoes.map(l => [l.id, l]));
  assert.deepEqual(porId['dev-0001'], { id: 'dev-0001', titulo: 'ruim', positivos: 1, negativos: 3, ruim: true, escopo: 'global' });
  assert.equal(porId['dev-0003'].ruim, false);
  assert.equal(porId['dev-0003'].escopo, 'projeto');
  assert.deepEqual(d.talentos, [{ id: 'dev-0002', titulo: 'promovida', regra: 'sempre rode o teste' }]);
  assert.deepEqual(d.equipamento, { claude: '(sessão)/high', codex: '(sessão)/high' });
  assert.equal(d.amostra, 4);
  assert.equal(d.metricas.aceitacao_1a, 1);
  assert.equal('fontes' in d.metricas, false);
  assert.equal(d.nivel, 'Especialista');
  assert.equal(d.nivelNum, 4);
  assert.equal(d.provisorio, true);
  assert.deepEqual(d.atributos, { faro: 1, precisao: 1, confiabilidade: 1 });
  assert.deepEqual(d.fontes.recorrencia, [eventos.length - 1]);
  assert.deepEqual(Object.keys(d.tendencia).sort(), ['confiabilidade', 'faro', 'precisao']);
});

test('montarDossie: equipamento com modelo, inherit, ausente e gerente', () => {
  const eq = papel => montarDossie({ papel, eventos: [], home, projeto, modelos }).equipamento;
  assert.deepEqual(eq('revisor'), { claude: 'opus/high', codex: 'gpt-x/low' });
  assert.equal(eq('docs').claude, '(sessão)/medium');
  assert.equal(eq('docs').codex, null);
  const g = montarDossie({ papel: 'gerente', eventos: [], home, projeto, modelos });
  assert.deepEqual(g.equipamento, { claude: 'sessão', codex: 'sessão' });
  assert.equal(g.nome, 'Gerente');
});

test('montarDossie: diário limitado aos 20 mais recentes', () => {
  const dir = join(home, 'casos', 'tester');
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 25; i++) {
    writeFileSync(join(dir, `2026-${String((i % 12) + 1).padStart(2, '0')}-c${String(i).padStart(2, '0')}.md`),
      formatarCaso({ papel: 'tester', sintoma: `s${i}`, causa_raiz: 'c', correcao: 'c', verificacao: 'v' }));
  }
  const d = montarDossie({ papel: 'tester', eventos: [], home, projeto, modelos });
  assert.equal(d.diario.length, 20);
  assert.equal(d.diario[0].data, '2026-12');
  assert.equal(d.diario.at(-1).data, '2026-03');
});

test('home vazia (Review Focus 1): listas vazias, atributos nulos, sem exceção', () => {
  const vazia = mkdtempSync(join(tmpdir(), 'nabuco vazia-'));
  const antes = process.env.NABUCO_HOME;
  process.env.NABUCO_HOME = vazia;
  try {
    for (const papel of ['gerente', 'dev', 'revisor']) {
      const d = montarDossie({ papel, eventos: [], home: vazia, projeto: join(vazia, 'sem projeto'), modelos: null });
      assert.deepEqual(d.diario, []);
      assert.deepEqual(d.licoes, []);
      assert.deepEqual(d.talentos, []);
      assert.deepEqual(d.atributos, NULO);
      assert.deepEqual(d.tendencia, NULO);
      assert.equal(d.nivel, null);
      assert.equal(d.nivelNum, null);
      assert.equal(d.amostra, 0);
    }
    assert.deepEqual(montarDossie({ papel: 'dev', eventos: [], home: vazia, projeto: vazia, modelos: null }).equipamento, { claude: null, codex: null });
  } finally {
    process.env.NABUCO_HOME = antes;
    rmSync(vazia, { recursive: true, force: true });
  }
});
