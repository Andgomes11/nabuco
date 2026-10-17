import { calcularMetricas } from './metricas.mjs';
import { PAPEIS } from './constantes.mjs';
import { pendencias } from './criterios.mjs';

export const FUNCIONARIOS = ['gerente', ...PAPEIS];
export const NIVEL_NUM = { 'Júnior': 1, 'Pleno': 2, 'Sênior': 3, 'Especialista': 4 };

const MIN = 60000;
const EXPIRA = 30 * MIN;
const JANELA_ATIVIDADE = 5 * MIN;
const FASES_TRABALHO = new Set(['planejando', 'executando', 'checando']);
const FASES_ESPERA = new Set(['aguardando_usuario', 'aguardando_aprovacao']);

const lista = x => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object') : []);
const tempo = e => { const t = Date.parse(e?.ts); return Number.isNaN(t) ? -Infinity : t; };
const agentId = e => (e.dados && typeof e.dados === 'object' ? e.dados.agent_id : undefined);

function agenteAberto(meus) {
  const fechados = new Set(meus.filter(e => e.tipo === 'agente_fim').map(agentId));
  return meus.some(e => e.tipo === 'agente_inicio' && !fechados.has(agentId(e)));
}

export function montarEstado({ eventos, tarefa, projeto, nomes, avatares, agora }) {
  const evs = lista(eventos);
  const evsTarefa = lista(tarefa?.eventos);
  const limite30 = agora - EXPIRA;
  const limite5 = agora - JANELA_ATIVIDADE;
  const metricas = calcularMetricas(evs);
  const fase = tarefa?.estado?.fase;

  const funcionarios = FUNCIONARIOS.map(papel => {
    let estado = 'ocioso';
    let recentes5;
    if (papel === 'gerente') {
      if (tarefa && FASES_ESPERA.has(fase)) estado = 'aguardando';
      else if (tarefa && FASES_TRABALHO.has(fase) && evsTarefa.some(e => tempo(e) >= limite30)) estado = 'trabalhando';
      recentes5 = evsTarefa.filter(e => e.papel === null && tempo(e) >= limite5).length;
    } else {
      const meus = evs.filter(e => e.papel === papel);
      if (agenteAberto(meus) && meus.some(e => tempo(e) >= limite30)) estado = 'trabalhando';
      recentes5 = meus.filter(e => tempo(e) >= limite5).length;
    }
    const atividade = estado === 'trabalhando' ? Math.min(1, recentes5 / 10) : 0;
    const m = metricas[papel] ?? {};
    const nivel = m.nivel ?? null;
    const nivelNum = nivel === null ? null : NIVEL_NUM[nivel] ?? null;
    const arquivo = `${papel}-${nivelNum ?? 1}.jpg`;
    return {
      papel,
      nome: nomes?.[papel] ?? (papel === 'gerente' ? 'Gerente' : papel),
      estado, atividade, nivel, nivelNum,
      provisorio: m.provisorio ?? true,
      avatar: avatares?.has(arquivo) ? arquivo : null,
      cinza: nivel === null,
    };
  });

  let t = null;
  if (tarefa) {
    const crit = Array.isArray(tarefa.criterios?.criterios) ? tarefa.criterios.criterios : [];
    t = {
      nome: tarefa.nome,
      slug: tarefa.estado?.slug,
      fase,
      tamanho: tarefa.estado?.tamanho,
      tipo: tarefa.estado?.tipo,
      gate: {
        passou: crit.filter(c => c.status === 'passou' && c.evidencia && String(c.evidencia).trim()).length,
        total: crit.length,
        pendencias: crit.length ? pendencias(tarefa.criterios) : [],
      },
    };
  }
  return { versao: Array.isArray(eventos) ? eventos.length : 0, projeto, tarefa: t, funcionarios };
}
