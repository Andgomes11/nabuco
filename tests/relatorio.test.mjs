import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { periodoPorDias, periodoPorDatas, periodoDesde, montarRelatorio, formatarRelatorio, nomeArquivo } from '../scripts/lib/relatorio.mjs';
import { somarTokens } from '../scripts/evento.mjs';
import { PAPEIS_CEREBRO, ESCRITORES, JANELA_TAREFAS } from '../scripts/lib/constantes.mjs';
import { calcularMetricas } from '../scripts/lib/metricas.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(RAIZ, 'scripts', 'relatorio.mjs');
const EV = join(RAIZ, 'scripts', 'evento.mjs');
const TAREFA = join(RAIZ, 'scripts', 'tarefa.mjs');
const DIA = 24 * 3600e3;
const AGORA = Date.parse('2026-10-31T12:00:00Z');
const opc = { papeis: PAPEIS_CEREBRO, escritores: ESCRITORES };

let base, proj, home;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'nabuco rel-'));
  proj = join(base, 'meuproj'); home = join(base, 'home');
  mkdirSync(join(proj, '.git'), { recursive: true });
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

// Evento sintético `d` dias antes de AGORA.
const ev = (d, tipo, { tarefa = null, projeto = 'meuproj', papel = null, dados = {} } = {}) =>
  ({ ts: new Date(AGORA - d * DIA).toISOString(), tarefa, projeto, harness: 'claude', tipo, papel, dados });

// Histórico com: tarefa concluída (com rodada, achados, gate e critério falho), abandonada, em andamento,
// escape, cérebro, execuções com e sem tokens, agente alheio, outro projeto e evento fora do período.
function historico() {
  const t1 = { tarefa: '2026-10-28-login' }, t2 = { tarefa: '2026-10-29-busca' }, t3 = { tarefa: '2026-10-30-tela' };
  return [
    ev(30, 'tarefa_criada', { tarefa: 'velha', dados: { tamanho: 'trivial', tipo: 'bug' } }), // fora do período
    ev(3, 'tarefa_criada', { ...t1, dados: { tamanho: 'media', tipo: 'feature' } }),
    ev(3, 'plano_aprovado', t1),
    ev(2.9, 'agente_inicio', { ...t1, papel: 'dev', dados: { agent_id: 'a1', modelo: 'opus', effort: 'high' } }),
    ev(2.8, 'agente_fim', { ...t1, papel: 'dev', dados: { agent_id: 'a1', modelo: 'opus', effort: 'high', duracao_ms: 600000,
      tokens: { entrada: 100, saida: 50, cache_leitura: 1000, cache_escrita: 200 } } }),
    ev(2.7, 'criterio', { ...t1, dados: { id: 'c1', status: 'falhou' } }),
    ev(2.7, 'achado', { ...t1, papel: 'revisor', dados: { severidade: 'alta', resumo: 'SQL | injetável\nna busca' } }),
    ev(2.7, 'achado', { ...t1, papel: 'revisor', dados: { severidade: 'baixa', resumo: 'nome ruim' } }),
    ev(2.7, 'achado', { ...t1, papel: 'seguranca', dados: { severidade: 'media', resumo: 'segredo em log' } }),
    ev(2.6, 'rodada_correcao', { ...t1, papel: 'dev' }),
    ev(2.6, 'gate_bloqueou', { ...t1, dados: { fase: 'executando', pendencias: [{ id: 'c1' }] } }),
    ev(2.5, 'agente_inicio', { ...t1, papel: 'dev', dados: { agent_id: 'a2', modelo: 'opus', effort: 'high' } }),
    ev(2.4, 'agente_fim', { ...t1, papel: 'dev', dados: { agent_id: 'a2', modelo: 'opus', effort: 'high', duracao_ms: 300000 } }),
    ev(2.3, 'criterio', { ...t1, dados: { id: 'c1', status: 'passou' } }),
    ev(2, 'tarefa_fechada', t1),
    ev(1.5, 'correcao_usuario', { ...t1, papel: 'dev', dados: { apos_pronto: true, resumo: 'login quebrou no Safari' } }),
    ev(1.4, 'caso_criado', { papel: 'dev', dados: { arquivo: 'casos/dev/x.md', tags: ['login', 'safari'], turnos: 3 } }),
    ev(1.3, 'licao_criada', { papel: 'dev', dados: { id: 'dev-0002', escopo: 'global' } }),
    ev(2, 'tarefa_criada', { ...t2, dados: { tamanho: 'sensivel', tipo: 'bug' } }),
    ev(1.9, 'licao_usada', { ...t2, papel: 'dev', dados: { id: 'dev-0001', util: false } }),
    ev(1, 'tarefa_abandonada', { ...t2, dados: { motivo: 'mudou o escopo' } }),
    ev(0.5, 'tarefa_criada', { ...t3, dados: { tamanho: 'media', tipo: 'ui' } }),
    ev(0.4, 'agente_fim', { ...t3, papel: 'designer', dados: { agent_id: 'd1', modelo: 'sonnet', effort: 'medium' } }), // sem duração
    ev(0.3, 'agente_inicio', { ...t3, papel: 'designer', dados: { agent_id: 'd2' } }), // sem fim
    ev(0.3, 'agente_fim', { dados: { agent_id: 'x1' } }), // agente alheio
    ev(0.3, 'agente_fim', { dados: { agent_id: 'x2' } }),
    ev(0.2, 'achado', { projeto: 'outro', tarefa: 'o1', papel: 'revisor', dados: { severidade: 'alta', resumo: 'do outro projeto' } }),
    ev(0.2, 'tarefa_criada', { projeto: 'outro', tarefa: 'o1', dados: { tamanho: 'trivial', tipo: 'docs' } }),
    { ...ev(0.1, 'fase', { tarefa: 'x' }), ts: 'ontem' }, // sem data legível
  ];
}

test('período: --dias, --desde/--ate em dia local e validação', () => {
  const p = periodoPorDias(7, AGORA);
  assert.equal(p.desde, AGORA - 7 * DIA);
  assert.ok(p.ate > AGORA);
  assert.match(p.descricao, /7 dias/);
  const d = periodoPorDatas('2026-10-01', '2026-10-05', AGORA);
  assert.equal(d.desde, new Date(2026, 9, 1).getTime());
  assert.equal(d.ate, new Date(2026, 9, 6).getTime()); // --ate inclui o dia inteiro
  assert.equal(nomeArquivo(d), '2026-10-01_2026-10-05.md');
  assert.equal(periodoPorDatas('2026-10-01', null, AGORA).ate, AGORA + 1);
  for (const ruim of ['2026-02-30', '2026-13-01', '26-10-01', 'ontem', '']) assert.throws(() => periodoPorDatas(ruim, null, AGORA), /AAAA-MM-DD/, ruim);
  assert.throws(() => periodoPorDatas('2026-10-05', '2026-10-01', AGORA), /depois/);
  assert.throws(() => periodoPorDias(0, AGORA));
  for (const dias of [999999999999, 1e20, Math.ceil(AGORA / DIA) + 1]) assert.throws(() => periodoPorDias(dias, AGORA), /1970/, String(dias));
  assert.doesNotThrow(() => periodoPorDias(Math.floor(AGORA / DIA), AGORA));
  for (const ruim of ['1969-12-31', '0000-01-01', '0099-06-01']) assert.throws(() => periodoPorDatas(ruim, null, AGORA), /1970/, ruim);
  assert.throws(() => periodoPorDatas('2026-10-01', '1969-12-31', AGORA), /1970|depois/);
  assert.doesNotThrow(() => periodoPorDatas('9999-01-01', '9999-12-31', AGORA));
  assert.throws(() => periodoDesde('1960-01-01T00:00:00Z', 'x', AGORA), /1970/);
  const r = periodoDesde('2026-10-20T10:00:00Z', 'desde a tag v1.0.0', AGORA);
  assert.equal(r.desde, Date.parse('2026-10-20T10:00:00Z'));
  assert.match(r.descricao, /v1\.0\.0/);
});

test('relatório: filtra período e projeto; resumo e tarefas (concluída, abandonada, em andamento)', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj' });
  assert.equal(r.projeto, 'meuproj');
  assert.deepEqual(r.resumo.tarefas, { criadas: 3, concluidas: 1, abandonadas: 1, em_andamento: 1 });
  assert.deepEqual(r.resumo.criterios, { passou: 1, falhou: 1 });
  assert.equal(r.resumo.rodadas, 1);
  assert.deepEqual(r.resumo.achados, { alta: 1, media: 1, baixa: 1, outra: 0 });
  assert.equal(r.resumo.escapes, 1);
  assert.equal(r.resumo.agentes.execucoes, 3);
  assert.equal(r.resumo.agentes.duracao_ms, 900000);
  const t = Object.fromEntries(r.tarefas.map(x => [x.tarefa, x]));
  assert.deepEqual(Object.keys(t).sort(), ['2026-10-28-login', '2026-10-29-busca', '2026-10-30-tela']);
  assert.equal(t['2026-10-28-login'].desfecho, 'concluída');
  assert.equal(t['2026-10-28-login'].duracao_ms, DIA);
  assert.deepEqual(t['2026-10-28-login'].achados, { alta: 1, media: 1, baixa: 1, outra: 0 });
  assert.equal(t['2026-10-28-login'].rodadas, 1);
  assert.equal(t['2026-10-28-login'].gate_bloqueios, 1);
  assert.deepEqual(t['2026-10-28-login'].criterios_falharam, ['c1']);
  assert.deepEqual([t['2026-10-28-login'].tamanho, t['2026-10-28-login'].tipo], ['media', 'feature']);
  assert.equal(t['2026-10-29-busca'].desfecho, 'abandonada');
  assert.equal(t['2026-10-30-tela'].desfecho, 'em andamento');
  assert.equal(t['2026-10-30-tela'].duracao_ms, null);
  // todos os projetos: entra o achado e a tarefa do outro projeto
  const todos = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: null });
  assert.equal(todos.projeto, null);
  assert.equal(todos.resumo.achados.alta, 2);
  assert.ok(todos.tarefas.some(x => x.projeto === 'outro' && x.tarefa === 'o1'));
  // a tarefa criada há 30 dias fica fora
  assert.ok(!todos.tarefas.some(x => x.tarefa === 'velha'));
});

test('relatório: tarefa criada antes do período usa tamanho/tipo e duração do histórico inteiro', () => {
  const evs = [
    ev(20, 'tarefa_criada', { tarefa: 'longa', dados: { tamanho: 'sensivel', tipo: 'infra' } }),
    ev(1, 'tarefa_fechada', { tarefa: 'longa' }),
    ev(1, 'tarefa_fechada', { tarefa: 'orfa' }),
  ];
  const r = montarRelatorio(evs, { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj' });
  const t = Object.fromEntries(r.tarefas.map(x => [x.tarefa, x]));
  assert.deepEqual([t.longa.tamanho, t.longa.tipo, t.longa.duracao_ms], ['sensivel', 'infra', 19 * DIA]);
  assert.equal(r.resumo.tarefas.criadas, 0);
  assert.equal(t.orfa.tamanho, null);
  assert.equal(r.qualidade.tarefas_sem_criacao, 1);
});

test('relatório: checadores, escapes e cérebro', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj' });
  assert.deepEqual(r.checadores.revisor.contagem, { alta: 1, media: 0, baixa: 1, outra: 0 });
  assert.deepEqual(r.checadores.seguranca.contagem, { alta: 0, media: 1, baixa: 0, outra: 0 });
  assert.deepEqual(r.checadores.revisor.destaques.map(d => d.severidade), ['alta']); // baixa não entra nos destaques
  assert.deepEqual(r.escapes, [{ papel: 'dev', projeto: 'meuproj', tarefa: '2026-10-28-login', resumo: 'login quebrou no Safari' }]);
  assert.equal(r.cerebro.casos.length, 1);
  assert.deepEqual(r.cerebro.casos[0].tags, ['login', 'safari']);
  assert.deepEqual(r.cerebro.licoes_criadas, [{ id: 'dev-0002', escopo: 'global', papel: 'dev' }]);
  assert.deepEqual(r.cerebro.licoes_usadas.map(l => [l.id, l.util]), [['dev-0001', false]]);
});

test('relatório: funcionários com execuções, tempo, modelos, métricas e tokens (presentes e ausentes)', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj' });
  const dev = r.funcionarios.dev;
  assert.equal(dev.execucoes, 2);
  assert.equal(dev.duracao_total_ms, 900000);
  assert.equal(dev.duracao_media_ms, 450000);
  assert.deepEqual(dev.modelos, { 'opus/high': 2 });
  assert.deepEqual(dev.tokens, { entrada: 100, saida: 50, cache_leitura: 1000, cache_escrita: 200, medidas: 1 });
  assert.equal(typeof dev.metricas.aceitacao_1a, 'number');
  assert.equal(dev.metricas.escapes, 1);
  const designer = r.funcionarios.designer;
  assert.equal(designer.execucoes, 1);
  assert.equal(designer.duracao_media_ms, null);
  assert.equal(designer.tokens, null); // não medido
  assert.ok(r.funcionarios.revisor, 'checador com achados aparece');
  assert.ok(!r.funcionarios.tester, 'papel sem atividade no período fica de fora');
  const md = formatarRelatorio(r);
  assert.match(md, /não medido/);
  assert.match(md, /entrada 100/);
});

test('relatório: métricas usam todas as tarefas fechadas no período, sem a janela de 30 do painel', () => {
  const n = JANELA_TAREFAS + 5;
  const evs = [];
  for (let i = 0; i < n; i++) {
    const t = { tarefa: `t${i}` };
    evs.push(ev(20 - i * 0.1, 'agente_inicio', { ...t, papel: 'dev', dados: { agent_id: `a${i}` } }),
      ev(20 - i * 0.1 - 0.01, 'tarefa_fechada', t));
  }
  assert.equal(calcularMetricas(evs).dev.amostra, JANELA_TAREFAS, 'painel e cérebro seguem com a janela padrão');
  const r = montarRelatorio(evs, { ...opc, periodo: periodoPorDias(30, AGORA), projeto: 'meuproj' });
  assert.equal(r.funcionarios.dev.metricas.amostra, n);
  assert.equal(r.resumo.tarefas.concluidas, n);
});

test('relatório: nível só a partir de AMOSTRA_NIVEL tarefas, como no painel e no cérebro', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj' });
  assert.equal(r.funcionarios.dev.metricas.amostra, 1);
  assert.match(formatarRelatorio(r), /^\| dev \| 1 \|[^\n]*\| em avaliação \(1\/3\) \|$/m);
});

test('relatório: contratado entra pelas listas dinâmicas de papéis', () => {
  const evs = [ev(1, 'agente_fim', { tarefa: 't', papel: 'tradutor', dados: { duracao_ms: 1000 } }), ev(1, 'tarefa_criada', { tarefa: 't' })];
  const r = montarRelatorio(evs, { periodo: periodoPorDias(7, AGORA), projeto: null, papeis: [...PAPEIS_CEREBRO, 'tradutor'], escritores: [...ESCRITORES, 'tradutor'] });
  assert.equal(r.funcionarios.tradutor.execucoes, 1);
  assert.ok(r.funcionarios.tradutor.metricas);
});

test('relatório: qualidade dos dados é explícita (ilegíveis, sem data, sem duração, sem fim, sem papel)', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj', ilegiveis: 2 });
  assert.equal(r.qualidade.linhas_ilegiveis, 2);
  assert.equal(r.qualidade.eventos_sem_data, 1);
  assert.equal(r.qualidade.fim_sem_duracao, 1);
  assert.equal(r.qualidade.inicio_sem_fim, 1);
  assert.equal(r.qualidade.execucoes_sem_papel, 2);
  assert.equal(r.qualidade.execucoes_sem_tokens, 2);
  assert.equal(r.qualidade.sem_eventos, false);
  const md = formatarRelatorio(r);
  for (const s of ['## Resumo', '## Tarefas', '## Checadores', '## Escapes', '## Cérebro', '## Funcionários', '## Qualidade dos dados']) assert.ok(md.includes(s), s);
  assert.match(md, /Linhas ilegíveis no histórico[^\n]*2/);
  assert.match(md, /fora do nabuco[^\n]*2/);
  // resumo hostil não quebra a tabela nem a lista
  assert.ok(md.includes('SQL \\| injetável na busca'));
});

test('relatório: período sem eventos diz "nenhum evento no período", nunca relatório limpo', () => {
  const r = montarRelatorio(historico(), { ...opc, periodo: periodoPorDatas('2020-01-01', '2020-01-02', AGORA), projeto: 'meuproj' });
  assert.equal(r.qualidade.sem_eventos, true);
  assert.equal(r.eventos, 0);
  const md = formatarRelatorio(r);
  assert.match(md, /nenhum evento no período/i);
  assert.doesNotMatch(md, /Nenhum escape registrado/);
  assert.doesNotMatch(md, /\| Tarefas concluídas \| 0 \|/);
  for (const s of ['## Resumo', '## Qualidade dos dados']) assert.ok(md.includes(s), s);
  const semArquivo = formatarRelatorio(montarRelatorio([], { ...opc, periodo: periodoPorDias(7, AGORA), projeto: 'meuproj', historicoExiste: false }));
  assert.match(semArquivo, /histórico não encontrado/i);
});

// --- CLI ---
const linhas = evs => evs.map(e => JSON.stringify(e)).join('\n') + '\n';
function run(args, { cwd = proj, extraEnv = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, TZ: 'UTC', ...extraEnv } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
// Histórico do CLI relativo ao "agora" real (o CLI usa o relógio).
const evAgora = (d, tipo, o = {}) => ({ ...ev(0, tipo, o), ts: new Date(Date.now() - d * DIA).toISOString() });

test('CLI: padrão 7 dias no projeto atual; --projeto todos; linha corrompida contada; sem caminhos absolutos', () => {
  writeFileSync(join(home, 'historico.jsonl'), linhas([
    evAgora(1, 'tarefa_criada', { tarefa: 'a', dados: { tamanho: 'media', tipo: 'bug' } }),
    evAgora(1, 'tarefa_criada', { projeto: 'outro', tarefa: 'b', dados: { tamanho: 'media', tipo: 'bug' } }),
    evAgora(10, 'tarefa_criada', { tarefa: 'antiga' }),
  ]) + '{quebrada\n');
  const r = run([]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /# Relatório do time nabuco — meuproj/);
  assert.match(r.out, /\| a \|/);
  assert.doesNotMatch(r.out, /antiga|\| b \|/);
  assert.match(r.out, /Linhas ilegíveis no histórico[^\n]*1/);
  for (const caminho of [base, home, proj]) assert.ok(!r.out.includes(caminho), 'relatório não traz caminho absoluto');
  const t = run(['--projeto', 'todos', '--dias', '30']);
  assert.equal(t.code, 0, t.err);
  assert.match(t.out, /todos os projetos/);
  assert.match(t.out, /antiga/);
  assert.match(t.out, /\| outro \| b \|/);
});

test('CLI: --json, --desde/--ate e --gravar (projeto e global)', () => {
  writeFileSync(join(home, 'historico.jsonl'), linhas([evAgora(1, 'tarefa_criada', { tarefa: 'a' })]));
  const j = run(['--json']);
  assert.equal(j.code, 0, j.err);
  const dados = JSON.parse(j.out);
  assert.equal(dados.resumo.tarefas.criadas, 1);
  assert.equal(dados.projeto, 'meuproj');
  const d = run(['--desde', '2020-01-01', '--ate', '2020-01-31']);
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /nenhum evento no período/i);
  const g = run(['--desde', '2020-01-01', '--ate', '2020-01-31', '--gravar']);
  assert.equal(g.code, 0, g.err);
  const arq = join(proj, '.nabuco', 'relatorios', '2020-01-01_2020-01-31.md');
  assert.ok(existsSync(arq));
  assert.match(readFileSync(arq, 'utf8'), /## Qualidade dos dados/);
  assert.match(g.out, /relatorios[\\/]2020-01-01_2020-01-31\.md/);
  const gt = run(['--projeto', 'todos', '--gravar']);
  assert.equal(gt.code, 0, gt.err);
  assert.equal(readdirSync(join(home, 'relatorios')).length, 1);
  assert.deepEqual(readdirSync(join(proj, '.nabuco', 'relatorios')), ['2020-01-01_2020-01-31.md']);
});

test('CLI: uso incorreto sai 2', () => {
  for (const args of [['--dias', 'x'], ['--dias', '0'], ['--dias', '7', '--desde', '2026-10-01'], ['--ate', '2026-10-01'],
    ['--projeto', 'outro'], ['--desde', '2026-13-01'], ['--desde', '2026-10-05', '--ate', '2026-10-01'], ['--desde-release', '--dias', '3'],
    ['--desde-release'], ['--xyz'], ['--dias', '999999999999'], ['--dias', '99999999999999999999999'],
    ['--desde', '1969-12-31'], ['--desde', '0000-01-01'], ['--desde', '2026-10-01', '--ate', '0000-01-01']]) {
    const r = run(args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, /nabuco: /);
    assert.doesNotMatch(r.err, /\n\s+at /, 'sem stack trace');
  }
  const futuro = run(['--desde', '9999-01-01', '--ate', '9999-12-31', '--json']);
  assert.equal(futuro.code, 0, futuro.err);
  assert.equal(JSON.parse(futuro.out).eventos, 0);
});

test('CLI: --desde-release usa a data da última tag semver', () => {
  rmSync(join(proj, '.git'), { recursive: true, force: true });
  const git = (args, data) => {
    const r = spawnSync('git', ['-C', proj, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
      { encoding: 'utf8', env: { ...process.env, ...(data ? { GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data } : {}) } });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q']);
  writeFileSync(join(proj, 'x.txt'), 'x');
  git(['add', '-A']);
  const dataTag = new Date(Date.now() - 3 * DIA).toISOString();
  git(['commit', '-q', '-m', 'x'], dataTag);
  git(['tag', 'v1.2.0']);
  writeFileSync(join(home, 'historico.jsonl'), linhas([
    evAgora(5, 'tarefa_criada', { tarefa: 'antes' }), evAgora(1, 'tarefa_criada', { tarefa: 'depois' }),
  ]));
  const r = run(['--desde-release']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /v1\.2\.0/);
  assert.match(r.out, /depois/);
  assert.doesNotMatch(r.out, /\| antes \|/);
});

// --- tokens ---
const transcript = linhasT => { const f = join(base, 'agent-x.jsonl'); writeFileSync(f, linhasT.join('\n') + '\n'); return f; };
const assistente = (id, u) => JSON.stringify({ type: 'assistant', requestId: `r-${id}`, message: { id, role: 'assistant', usage: u } });
const U = (i, o, cr, cc) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc });

test('tokens: soma usage do transcript, sem repetir a mesma mensagem e ignorando o resto', () => {
  const f = transcript([
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }),
    assistente('m1', U(10, 5, 100, 20)),
    assistente('m1', U(10, 5, 100, 20)), // mesmo id (um bloco de conteúdo por linha): conta uma vez
    assistente('m2', U(1, 2, 3, 4)),
    '{quebrada',
    JSON.stringify({ type: 'user', message: { usage: U(999, 999, 999, 999) } }), // só assistant conta
  ]);
  assert.deepEqual(somarTokens(f), { entrada: 11, saida: 7, cache_leitura: 103, cache_escrita: 24 });
});

test('tokens: ausente, ilegível, grande demais ou sem usage → null', () => {
  assert.equal(somarTokens(undefined), null);
  assert.equal(somarTokens(join(base, 'nao-existe.jsonl')), null);
  assert.equal(somarTokens(join(base)), null);
  const txt = join(base, 'x.txt'); writeFileSync(txt, assistente('m', U(1, 1, 1, 1)));
  assert.equal(somarTokens(txt), null, 'só .jsonl');
  const f = transcript([assistente('m1', U(10, 5, 100, 20))]);
  assert.equal(somarTokens(f, 10), null, 'acima do limite não lê');
  assert.equal(somarTokens(transcript([JSON.stringify({ type: 'user' })])), null);
});

function hook(payload) {
  const r = spawnSync(process.execPath, [EV, '--hook'], { cwd: proj, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, NABUCO_HOME: home, NABUCO_HARNESS: 'claude' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  return readFileSync(join(home, 'historico.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).at(-1);
}

test('tokens: hook agente_fim grava dados.tokens só para papéis do nabuco; erro vira sem tokens', () => {
  spawnSync(process.execPath, [TAREFA, 'nova', '--slug', 'x', '--tamanho', 'media', '--tipo', 'bug'], { cwd: proj, env: { ...process.env, NABUCO_HOME: home } });
  const f = transcript([assistente('m1', U(10, 5, 100, 20))]);
  hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco:dev', agent_id: 'a1', cwd: proj });
  const fim = hook({ hook_event_name: 'SubagentStop', agent_type: 'nabuco:dev', agent_id: 'a1', cwd: proj, agent_transcript_path: f });
  assert.deepEqual(fim.dados.tokens, { entrada: 10, saida: 5, cache_leitura: 100, cache_escrita: 20 });
  assert.equal(typeof fim.dados.duracao_ms, 'number');
  const alheio = hook({ hook_event_name: 'SubagentStop', agent_type: 'Explore', agent_id: 'z', cwd: proj, agent_transcript_path: f });
  assert.equal(alheio.dados.tokens, undefined);
  const inicio = hook({ hook_event_name: 'SubagentStart', agent_type: 'nabuco:dev', agent_id: 'a2', cwd: proj, agent_transcript_path: f });
  assert.equal(inicio.dados.tokens, undefined, 'só no fim');
  const sumiu = hook({ hook_event_name: 'SubagentStop', agent_type: 'nabuco:dev', agent_id: 'a2', cwd: proj, agent_transcript_path: join(base, 'sumiu.jsonl') });
  assert.equal(sumiu.dados.tokens, undefined);
  assert.equal(typeof sumiu.dados.duracao_ms, 'number');
  const ruim = hook({ hook_event_name: 'SubagentStop', agent_type: 'nabuco:dev', agent_id: 'a3', cwd: proj, agent_transcript_path: { x: 1 } });
  assert.equal(ruim.dados.tokens, undefined);
  // o relatório mostra o consumo medido e conta o não medido
  const r = run(['--json']);
  const dev = JSON.parse(r.out).funcionarios.dev;
  assert.deepEqual(dev.tokens, { entrada: 10, saida: 5, cache_leitura: 100, cache_escrita: 20, medidas: 1 });
  assert.equal(dev.execucoes, 3);
});
