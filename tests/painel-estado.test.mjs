import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarEstado, FUNCIONARIOS, NIVEL_NUM, MAX_LINHA } from '../scripts/lib/painel-estado.mjs';

const AGORA = Date.UTC(2026, 5, 1, 12, 0, 0);
const min = m => new Date(AGORA - m * 60000).toISOString();
const ev = (tipo, papel, ha, dados = {}, tarefa = 't', projeto = 'meu-proj') => ({ ts: min(ha), tarefa, projeto, harness: 'claude', tipo, papel, dados });
const base = { projeto: 'meu-proj', tarefa: null, nomes: {}, avatares: new Set(), agora: AGORA };
const func = (est, papel) => est.funcionarios.find(f => f.papel === papel);

test('constantes', () => {
  assert.equal(FUNCIONARIOS.length, 10);
  assert.equal(FUNCIONARIOS[0], 'gerente');
  assert.deepEqual(NIVEL_NUM, { 'Júnior': 1, 'Pleno': 2, 'Sênior': 3, 'Especialista': 4 });
});

test('sem dados: 10 ociosos, cinza (menos o gerente), tarefa null', () => {
  const est = montarEstado({ ...base, eventos: [] });
  assert.equal(est.versao, 0);
  assert.equal(est.projeto, 'meu-proj');
  assert.equal(est.tarefa, null);
  assert.equal(est.funcionarios.length, 10);
  for (const f of est.funcionarios) {
    assert.equal(f.estado, 'ocioso'); assert.equal(f.atividade, 0);
    assert.equal(f.nivel, null); assert.equal(f.cinza, f.papel !== 'gerente'); assert.equal(f.avatar, null);
  }
});

test('agente em andamento, finalizado e expirado (30 min)', () => {
  const ini = ev('agente_inicio', 'dev', 2, { agent_id: 'a1' });
  assert.equal(func(montarEstado({ ...base, eventos: [ini] }), 'dev').estado, 'trabalhando');
  const fim = ev('agente_fim', 'dev', 1, { agent_id: 'a1' });
  assert.equal(func(montarEstado({ ...base, eventos: [ini, fim] }), 'dev').estado, 'ocioso');
  const velho = ev('agente_inicio', 'dev', 31, { agent_id: 'a1' });
  assert.equal(func(montarEstado({ ...base, eventos: [velho] }), 'dev').estado, 'ocioso');
  // fim de outro agent_id não encerra
  const outro = ev('agente_fim', 'dev', 1, { agent_id: 'a2' });
  assert.equal(func(montarEstado({ ...base, eventos: [ini, outro] }), 'dev').estado, 'trabalhando');
  // ts inválido = muito antigo
  const ruim = { ...ini, ts: 'lixo' };
  assert.equal(func(montarEstado({ ...base, eventos: [ruim] }), 'dev').estado, 'ocioso');
});

test('atividade: 5 eventos => 0.5, 15 => 1', () => {
  const ini = ev('agente_inicio', 'dev', 4, { agent_id: 'a1' });
  const cinco = [ini, ...Array.from({ length: 4 }, () => ev('criterio', 'dev', 1))];
  assert.equal(func(montarEstado({ ...base, eventos: cinco }), 'dev').atividade, 0.5);
  const quinze = [ini, ...Array.from({ length: 14 }, () => ev('criterio', 'dev', 1))];
  assert.equal(func(montarEstado({ ...base, eventos: quinze }), 'dev').atividade, 1);
  const velhos = [ini, ...Array.from({ length: 4 }, () => ev('criterio', 'dev', 6))];
  assert.equal(func(montarEstado({ ...base, eventos: velhos }), 'dev').atividade, 0.1);
});

const tar = (fase, eventos = [], criterios = { criterios: [] }) => ({ nome: 'Minha tarefa', estado: { slug: 'minha', fase, tamanho: 'media', tipo: 'feature' }, criterios, eventos });

test('gerente: aguardando, trabalhando e ocioso', () => {
  let g = func(montarEstado({ ...base, eventos: [], tarefa: tar('aguardando_usuario', [ev('x', null, 1)]) }), 'gerente');
  assert.equal(g.estado, 'aguardando'); assert.equal(g.atividade, 0);
  g = func(montarEstado({ ...base, eventos: [], tarefa: tar('aguardando_aprovacao') }), 'gerente');
  assert.equal(g.estado, 'aguardando');
  g = func(montarEstado({ ...base, eventos: [], tarefa: tar('executando', [ev('x', null, 1)]) }), 'gerente');
  assert.equal(g.estado, 'trabalhando'); assert.equal(g.atividade, 0.1);
  g = func(montarEstado({ ...base, eventos: [], tarefa: tar('executando', [ev('x', null, 40)]) }), 'gerente');
  assert.equal(g.estado, 'ocioso');
  g = func(montarEstado({ ...base, eventos: [], tarefa: tar('concluida', [ev('x', null, 1)]) }), 'gerente');
  assert.equal(g.estado, 'ocioso');
});

test('tarefa e gate', () => {
  const criterios = { criterios: [{ id: 'c1', status: 'passou', evidencia: 'ok' }, { id: 'c2', status: 'pendente' }, { id: 'c3', status: 'passou', evidencia: ' ' }] };
  const est = montarEstado({ ...base, eventos: [], tarefa: tar('executando', [], criterios) });
  assert.deepEqual(est.tarefa, {
    nome: 'Minha tarefa', slug: 'minha', fase: 'executando', tamanho: 'media', tipo: 'feature',
    gate: { passou: 1, total: 3, pendencias: [{ id: 'c2', motivo: 'status "pendente"' }, { id: 'c3', motivo: 'passou sem evidência registrada' }] },
    aviso: null, linha: [],
  });
  const vazio = montarEstado({ ...base, eventos: [], tarefa: tar('executando') });
  assert.deepEqual(vazio.tarefa.gate, { passou: 0, total: 0, pendencias: [] });
  const sem = montarEstado({ ...base, eventos: [], tarefa: { ...tar('executando'), criterios: null } });
  assert.deepEqual(sem.tarefa.gate, { passou: 0, total: 0, pendencias: [] });
});

test('nível e avatar', () => {
  const evs = [];
  for (let i = 0; i < 30; i++) {
    evs.push({ ts: min(1000 - i), tarefa: `t${i}`, projeto: 'p', tipo: 'agente_inicio', papel: 'dev', dados: {} });
    evs.push({ ts: min(1000 - i), tarefa: `t${i}`, projeto: 'p', tipo: 'agente_inicio', papel: 'revisor', dados: {} });
    evs.push({ ts: min(1000 - i), tarefa: `t${i}`, projeto: 'p', tipo: 'tarefa_fechada', papel: 'gerente', dados: {} });
  }
  for (let i = 0; i < 4; i++) {
    evs.push({ ts: min(900), tarefa: null, projeto: 'p', tipo: 'licao_usada', papel: 'revisor', dados: { util: true } });
    evs.push({ ts: min(900), tarefa: null, projeto: 'p', tipo: 'caso_criado', papel: 'revisor', dados: {} });
  }
  const est = montarEstado({ ...base, eventos: evs, avatares: new Set(['dev-4.jpg']), nomes: { dev: 'Dev Nome' } });
  const dev = func(est, 'dev');
  assert.equal(dev.nivel, 'Especialista'); assert.equal(dev.nivelNum, 4);
  assert.equal(dev.avatar, 'dev-4.jpg'); assert.equal(dev.cinza, false); assert.equal(dev.provisorio, false);
  assert.equal(dev.nome, 'Dev Nome');
  const rev = func(est, 'revisor');
  assert.equal(rev.nivelNum, 4); assert.equal(rev.avatar, null);
  assert.equal(func(est, 'gerente').nome, 'Gerente');
  assert.equal(func(est, 'tester').nome, 'tester');
  assert.equal(func(est, 'tester').nivelNum, null);
});

test('início antigo morto não mantém o papel trabalhando', () => {
  const morto = ev('agente_inicio', 'dev', 2880, { agent_id: 'a0' });
  const a1 = ev('agente_inicio', 'dev', 5, { agent_id: 'a1' });
  const a1fim = ev('agente_fim', 'dev', 4, { agent_id: 'a1' });
  assert.equal(func(montarEstado({ ...base, eventos: [morto, a1, a1fim] }), 'dev').estado, 'ocioso');
  const a2 = ev('agente_inicio', 'dev', 2, { agent_id: 'a2' });
  assert.equal(func(montarEstado({ ...base, eventos: [morto, a1, a1fim, a2] }), 'dev').estado, 'trabalhando');
});

test('gerente: atividade conta eventos da tarefa com papel null ou "gerente"', () => {
  const evs = [ev('x', null, 1), ev('tarefa_fase', 'gerente', 1), ev('tarefa_fase', 'gerente', 2), ev('criterio', 'dev', 1)];
  const g = func(montarEstado({ ...base, eventos: [], tarefa: tar('executando', evs) }), 'gerente');
  assert.equal(g.atividade, 0.3);
});

test('estado e atividade só contam eventos DESTE projeto; nível continua global', () => {
  const aqui = (tipo, ha, dados) => ev(tipo, 'dev', ha, dados, 't', 'meu-proj');
  const la = (tipo, ha, dados) => ev(tipo, 'dev', ha, dados, 't', 'outro-proj');
  // dev ocupado em outro projeto não aparece trabalhando aqui
  assert.equal(func(montarEstado({ ...base, eventos: [la('agente_inicio', 1, { agent_id: 'b1' })] }), 'dev').estado, 'ocioso');
  // trabalhando aqui: atividade ignora o volume do outro projeto
  const evs = [aqui('agente_inicio', 2, { agent_id: 'a1' }), aqui('criterio', 1), ...Array.from({ length: 8 }, () => la('criterio', 1))];
  const dev = func(montarEstado({ ...base, eventos: evs }), 'dev');
  assert.equal(dev.estado, 'trabalhando');
  assert.equal(dev.atividade, 0.2);
  // fim no outro projeto não encerra o agente daqui
  const fimLa = la('agente_fim', 1, { agent_id: 'a1' });
  assert.equal(func(montarEstado({ ...base, eventos: [aqui('agente_inicio', 2, { agent_id: 'a1' }), fimLa] }), 'dev').estado, 'trabalhando');
  // nível é global: tarefas de outro projeto contam
  const glob = [];
  for (let i = 0; i < 12; i++) {
    glob.push({ ts: min(1000 - i), tarefa: `t${i}`, projeto: 'outro-proj', tipo: 'agente_inicio', papel: 'dev', dados: {} });
    glob.push({ ts: min(1000 - i), tarefa: `t${i}`, projeto: 'outro-proj', tipo: 'tarefa_fechada', papel: 'gerente', dados: {} });
  }
  assert.equal(func(montarEstado({ ...base, eventos: glob }), 'dev').nivel, 'Especialista');
});

test('agente sem agent_id: só um fim sem agent_id POSTERIOR fecha o início (undefined não casa com qualquer coisa)', () => {
  const est = evs => func(montarEstado({ ...base, eventos: evs }), 'dev').estado;
  const ini = ev('agente_inicio', 'dev', 2);
  assert.equal(est([ini]), 'trabalhando');
  // fim sem agent_id de uma sessão anterior não encerra o início novo
  assert.equal(est([ev('agente_fim', 'dev', 10), ini]), 'trabalhando');
  assert.equal(est([ini, ev('agente_fim', 'dev', 10)]), 'trabalhando', 'a ordem no arquivo não importa, vale o ts');
  // fim sem agent_id depois do início encerra
  assert.equal(est([ini, ev('agente_fim', 'dev', 1)]), 'ocioso');
  // mesmo instante: vale a ordem no histórico
  const fimMesmo = { ...ev('agente_fim', 'dev', 2) };
  assert.equal(est([ini, fimMesmo]), 'ocioso');
  // com e sem agent_id não se misturam
  assert.equal(est([ini, ev('agente_fim', 'dev', 1, { agent_id: 'a1' })]), 'trabalhando');
  assert.equal(est([ev('agente_inicio', 'dev', 2, { agent_id: 'a1' }), ev('agente_fim', 'dev', 1)]), 'trabalhando');
  // agent_id nulo conta como ausente
  assert.equal(est([ev('agente_inicio', 'dev', 2, { agent_id: null }), ev('agente_fim', 'dev', 10)]), 'trabalhando');
});

test('tarefa.aviso: repassado do leitor (ex.: criterios.json ilegível); sem aviso = null', () => {
  assert.equal(montarEstado({ ...base, eventos: [], tarefa: tar('executando') }).tarefa.aviso, null);
  const aviso = 'criterios.json ilegível — mostrando a última leitura boa';
  assert.equal(montarEstado({ ...base, eventos: [], tarefa: { ...tar('executando'), aviso } }).tarefa.aviso, aviso);
  assert.equal(montarEstado({ ...base, eventos: [], tarefa: { ...tar('executando'), aviso: 42 } }).tarefa.aviso, null);
});

test('limite do plano: null sem amostras; com tarefa, consumo desde a criação dela', () => {
  assert.equal(montarEstado({ ...base, eventos: [] }).limite, null);
  const renova = Math.floor((AGORA + 60 * 60000) / 1000);
  const limite = [{ ts: min(30), h5: { pct: 10, renova } }, { ts: min(5), h5: { pct: 16, renova } }];
  const t = { ...tar('executando'), estado: { ...tar('executando').estado, criada: min(20) } };
  const est = montarEstado({ ...base, eventos: [], tarefa: t, limite });
  assert.equal(est.limite.h5.pct, 16);
  assert.deepEqual(est.limite.tarefa, { h5: 6, sem: null });
  assert.equal(montarEstado({ ...base, eventos: [], limite }).limite.tarefa, null);
});

test('linha do tempo: eventos da tarefa enxutos, sem ruído de agente interno, no máximo MAX_LINHA', () => {
  const evs = [
    ev('fase', null, 9, { de: 'planejando', para: 'executando', extra: { grande: 1 } }),
    ev('delegacao', null, 8, { para: 'dev', passo: 'x'.repeat(400) }),
    ev('agente_inicio', 'dev', 8, { agent_id: 'a', modelo: 'opus' }),
    ev('agente_fim', null, 7, { agent_id: 'interno' }),
    ev('agente_inicio', null, 6, { agente: 'Explore' }),
    ev('gate_bloqueou', null, 5, { pendencias: [{ id: 'c1' }, { id: 'c2' }] }),
  ];
  const l = montarEstado({ ...base, eventos: [], tarefa: tar('executando', evs) }).tarefa.linha;
  assert.deepEqual(l.map(e => e.tipo), ['fase', 'delegacao', 'agente_inicio', 'agente_inicio', 'gate_bloqueou']);
  assert.deepEqual(l[0].dados, { de: 'planejando', para: 'executando' });
  assert.equal(l[1].dados.passo.length, 300);
  assert.equal(l[1].papel, null);
  assert.equal(l[3].dados.agente, 'Explore');
  assert.equal(l[4].dados.pendencias, 2);
  const muitos = Array.from({ length: 120 }, (_, i) => ev('nota', null, 120 - i, { texto: String(i) }));
  const m = montarEstado({ ...base, eventos: [], tarefa: tar('executando', muitos) }).tarefa.linha;
  assert.equal(m.length, MAX_LINHA);
  assert.equal(m[m.length - 1].dados.texto, '119');
});
