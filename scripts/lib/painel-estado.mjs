import { calcularMetricas } from './metricas.mjs';
import { PAPEIS } from './constantes.mjs';
import { pendencias } from './criterios.mjs';
import { resumirLimite } from './limite.mjs';
import { AMOSTRA_NIVEL } from './constantes.mjs';

export const FUNCIONARIOS = ['gerente', ...PAPEIS];
export const NIVEL_NUM = { 'Júnior': 1, 'Pleno': 2, 'Sênior': 3, 'Especialista': 4 };

const MIN = 60000;
const EXPIRA = 30 * MIN;
const JANELA_ATIVIDADE = 5 * MIN;
const FASES_TRABALHO = new Set(['planejando', 'executando', 'checando']);
const FASES_ESPERA = new Set(['aguardando_usuario', 'aguardando_aprovacao']);

const lista = x => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object') : []);
const tempo = e => { const t = Date.parse(e?.ts); return Number.isNaN(t) ? -Infinity : t; };
// agent_id ausente/nulo/vazio = null (nunca undefined, para não casar 'sem id' com 'sem id' por acaso)
const agentId = e => {
  const id = e.dados && typeof e.dados === 'object' ? e.dados.agent_id : null;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return typeof id === 'string' && id ? id : null;
};

// só o início mais recente do papel conta (um escritor por vez): início antigo sem fim é sessão morta.
// Com agent_id, fecha-o o fim com o mesmo agent_id. Sem agent_id não há como parear: fecha-o apenas um fim
// também sem agent_id POSTERIOR a ele (ts maior, ou mesmo ts e depois no histórico) — um fim sem id de uma
// sessão anterior não encerra um início novo.
function agenteAberto(meus) {
  let ult = null, iUlt = -1;
  meus.forEach((e, i) => { if (e.tipo === 'agente_inicio' && (ult === null || tempo(e) >= tempo(ult))) { ult = e; iUlt = i; } });
  if (ult === null) return false;
  const id = agentId(ult);
  return !meus.some((e, i) => {
    if (e.tipo !== 'agente_fim' || agentId(e) !== id) return false;
    if (id !== null) return true;
    return tempo(e) > tempo(ult) || (tempo(e) === tempo(ult) && i > iUlt);
  });
}

// linha do tempo da tarefa ativa: só os campos que o painel mostra, com texto livre cortado
export const MAX_LINHA = 80;
const CAMPOS = ['de', 'para', 'motivo', 'tamanho', 'tipo', 'id', 'acao', 'status', 'evidencia', 'severidade', 'resumo', 'passo', 'texto', 'duracao_ms', 'modelo', 'effort', 'agente', 'bloqueios'];
function enxuto(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const r = {};
  for (const k of CAMPOS) {
    const x = d[k];
    if (typeof x === 'string') r[k] = x.slice(0, 300);
    else if (typeof x === 'number' && Number.isFinite(x)) r[k] = x;
  }
  if (Array.isArray(d.pendencias)) r.pendencias = d.pendencias.length;
  return r;
}
function linhaDoTempo(evs) {
  return evs
    // agente sem papel e sem nome: ruído (agente interno do harness)
    .filter(e => typeof e.tipo === 'string' && !(e.tipo.startsWith('agente_') && !e.papel && !e.dados?.agente))
    .slice(-MAX_LINHA)
    .map(e => ({ ts: typeof e.ts === 'string' ? e.ts : null, tipo: e.tipo, papel: typeof e.papel === 'string' ? e.papel : null, dados: enxuto(e.dados) }));
}

// fila do projeto (.nabuco/fila.json): itens enxutos, com pedido cortado. Acima de MAX_FILA, os itens
// pendentes e em andamento nunca somem; dos encerrados ficam os mais recentes (`ocultos` conta o resto).
export const MAX_FILA = 50;
const ATIVOS_FILA = new Set(['pendente', 'em_andamento']);
const resumirParada = p => (p && typeof p === 'object' && typeof p.motivo === 'string'
  ? { motivo: p.motivo.slice(0, 200), desde: typeof p.desde === 'string' ? p.desde : null, item: typeof p.item === 'string' ? p.item : null }
  : null);
function resumirFila(fila) {
  if (!fila || typeof fila !== 'object') return null;
  const itens = lista(fila.itens).filter(i => typeof i.id === 'string' && typeof i.status === 'string');
  const aviso = typeof fila.aviso === 'string' && fila.aviso ? fila.aviso : null;
  if (!itens.length && !aviso) return null;
  const ativos = itens.filter(i => ATIVOS_FILA.has(i.status)).slice(0, MAX_FILA);
  const encerrados = itens.filter(i => !ATIVOS_FILA.has(i.status));
  const mostrar = new Set([...ativos, ...encerrados.slice(Math.max(0, encerrados.length - (MAX_FILA - ativos.length)))]);
  return {
    pendentes: itens.filter(i => i.status === 'pendente').length,
    commit_por_item: fila.commit_por_item === true,
    aviso,
    parada: resumirParada(fila.parada),
    ocultos: itens.length - mostrar.size,
    itens: itens.filter(i => mostrar.has(i)).map(i => ({
      id: i.id,
      pedido: typeof i.pedido === 'string' ? i.pedido.slice(0, 200) : '',
      status: i.status,
      tarefa: typeof i.tarefa === 'string' ? i.tarefa : null,
    })),
  };
}

// `funcionarios` (gerente + papéis) e `escritores`: padrão nos embutidos; o servidor inclui os contratados.
export function montarEstado({ eventos, tarefa, projeto, nomes, avatares, limite, agora, funcionarios: equipe = FUNCIONARIOS, escritores, fila = null }) {
  const evs = lista(eventos);
  const evsTarefa = lista(tarefa?.eventos);
  const limite30 = agora - EXPIRA;
  const limite5 = agora - JANELA_ATIVIDADE;
  const metricas = calcularMetricas(evs, { papeis: equipe, escritores });
  const fase = tarefa?.estado?.fase;

  const funcionarios = equipe.map(papel => {
    let estado = 'ocioso';
    let recentes5;
    if (papel === 'gerente') {
      if (tarefa && FASES_ESPERA.has(fase)) estado = 'aguardando';
      else if (tarefa && FASES_TRABALHO.has(fase) && evsTarefa.some(e => tempo(e) >= limite30)) estado = 'trabalhando';
      recentes5 = evsTarefa.filter(e => (e.papel === null || e.papel === 'gerente') && tempo(e) >= limite5).length;
    } else {
      // estado/atividade: só eventos deste projeto (ocupado em outro projeto não está trabalhando aqui);
      // nível e métricas continuam globais (o funcionário é o mesmo em todos os projetos)
      const meus = evs.filter(e => e.papel === papel && e.projeto === projeto);
      if (agenteAberto(meus) && meus.some(e => tempo(e) >= limite30)) estado = 'trabalhando';
      recentes5 = meus.filter(e => tempo(e) >= limite5).length;
    }
    const atividade = estado === 'trabalhando' ? Math.min(1, recentes5 / 10) : 0;
    const m = metricas[papel] ?? {};
    const amostra = Number.isInteger(m.amostra) ? m.amostra : 0;
    // com menos de AMOSTRA_NIVEL tarefas o nível ainda não diz nada: "em avaliação"
    const nivel = amostra >= AMOSTRA_NIVEL ? m.nivel ?? null : null;
    const nivelNum = nivel === null ? null : NIVEL_NUM[nivel] ?? null;
    const arquivo = `${papel}-${nivelNum ?? 1}.jpg`;
    return {
      papel,
      nome: nomes?.[papel] ?? (papel === 'gerente' ? 'Gerente' : papel),
      estado, atividade, nivel, nivelNum, amostra,
      // participou da tarefa aberta (ainda não conta na amostra, que é de tarefas concluídas)
      naTarefaAberta: papel === 'gerente' ? Boolean(tarefa) : evsTarefa.some(e => e.papel === papel),
      provisorio: m.provisorio ?? true,
      avatar: avatares?.has(arquivo) ? arquivo : null,
      // gerente não ganha nível (metricas.mjs), então "sem avaliação" não o deixa cinza
      cinza: nivel === null && papel !== 'gerente',
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
      // leitura degradada (ex.: criterios.json ilegível): o cabeçalho avisa em vez de esconder
      aviso: typeof tarefa.aviso === 'string' && tarefa.aviso ? tarefa.aviso : null,
      linha: linhaDoTempo(evsTarefa),
    };
  }
  // versao usa eventos.length cru de propósito: são índices no arquivo de histórico
  // limite do plano: consumo "da tarefa" é aproximado (o limite é da conta, inclui outras sessões)
  const plano = resumirLimite(limite, { agora, inicioTarefa: tarefa?.estado?.criada });
  return { versao: Array.isArray(eventos) ? eventos.length : 0, projeto, tarefa: t, funcionarios, limite: plano, fila: resumirFila(fila) };
}
