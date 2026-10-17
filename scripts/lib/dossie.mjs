import { basename } from 'node:path';
import { calcularMetricas, tarefasRecentes, chaveTarefa } from './metricas.mjs';
import { lerCasos } from './casos.mjs';
import { blocosDe, ativas } from './repositorio-licoes.mjs';
import { configDe } from './modelos.mjs';
import { NIVEL_NUM } from './painel-estado.mjs';

const MAX_DIARIO = 20;
const TAREFAS_RECENTES = 10;
const LIMIAR_TENDENCIA = 0.05;
const NULO = () => ({ faro: null, precisao: null, confiabilidade: null });
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Atributos 0..1 (null sem dado), fórmulas das Decisões da Fase 3.
export function atributos(m) {
  if (!m || typeof m !== 'object') return NULO();
  const t = num(m.turnos_ate_causa);
  const faro = t === null ? null : Math.max(0, Math.min(1, 1 - (t - 1) / 9));
  const precisao = num(m.aceitacao_1a);
  const rec = num(m.recorrencia);
  const esc = num(m.escapes);
  const amostra = num(m.amostra);
  const partes = [];
  if (rec !== null) partes.push(1 - rec);
  if (esc !== null && amostra !== null && amostra > 0) partes.push(1 - Math.min(1, esc / amostra));
  return { faro, precisao, confiabilidade: media(partes) };
}

const seta = (agora, antes) => {
  if (agora === null || antes === null) return null;
  const d = agora - antes;
  if (d >= LIMIAR_TENDENCIA - 1e-12) return '↑';
  if (d <= -LIMIAR_TENDENCIA + 1e-12) return '↓';
  return '→';
};

// Atributos com todos os eventos vs. sem os eventos das 10 tarefas fechadas mais recentes.
export function tendencia(eventos, papel) {
  const evs = Array.isArray(eventos) ? eventos : [];
  const recentes = tarefasRecentes(evs, TAREFAS_RECENTES);
  const antigos = evs.filter(e => { const k = e && typeof e === 'object' ? chaveTarefa(e) : null; return k === null || !recentes.has(k); });
  const agora = atributos(calcularMetricas(evs)[papel]);
  const antes = atributos(calcularMetricas(antigos)[papel]);
  return { faro: seta(agora.faro, antes.faro), precisao: seta(agora.precisao, antes.precisao), confiabilidade: seta(agora.confiabilidade, antes.confiabilidade) };
}

const equipamento = (modelos, harness, papel) => {
  const c = configDe(modelos, harness, papel);
  if (!c || typeof c !== 'object') return null;
  const modelo = c.model == null || c.model === 'inherit' ? '(sessão)' : c.model; // inherit = modelo da sessão
  return `${modelo}/${c.effort}`;
};

const nomeArquivo = c => basename(String(c.arquivo ?? ''));

function diarioDe(home, papel) {
  return lerCasos(home, papel)
    .sort((a, b) => nomeArquivo(b).localeCompare(nomeArquivo(a)) || String(b.arquivo).localeCompare(String(a.arquivo)))
    .slice(0, MAX_DIARIO)
    .map(c => ({
      data: /^\d{4}-\d{2}/.exec(nomeArquivo(c))?.[0] ?? null,
      sintoma: c.sintoma ?? null,
      causa_raiz: c.causa_raiz ?? null,
      arquivo: c.arquivo,
    }));
}

export function montarDossie({ papel, eventos, home, projeto, modelos, nome }) {
  const evs = Array.isArray(eventos) ? eventos : [];
  const todas = calcularMetricas(evs, { fontes: true })[papel];
  const { fontes = {}, ...metricas } = todas ?? {};
  const blocos = [...blocosDe('global', papel, projeto), ...blocosDe('projeto', papel, projeto)];
  return {
    papel,
    nome: nome ?? (papel === 'gerente' ? 'Gerente' : papel),
    nivel: metricas.nivel ?? null,
    nivelNum: NIVEL_NUM[metricas.nivel] ?? null,
    provisorio: metricas.provisorio ?? true,
    amostra: metricas.amostra ?? 0,
    metricas,
    atributos: atributos(metricas),
    tendencia: tendencia(evs, papel),
    fontes,
    equipamento: papel === 'gerente'
      ? { claude: 'sessão', codex: 'sessão' }
      : { claude: equipamento(modelos, 'claude', papel), codex: equipamento(modelos, 'codex', papel) },
    diario: diarioDe(home, papel),
    licoes: ativas(blocos).map(b => ({ id: b.id, titulo: b.titulo, positivos: b.positivos, negativos: b.negativos, ruim: b.negativos > b.positivos, escopo: b.escopo })),
    talentos: blocos.filter(b => b.regra).map(b => ({ id: b.id, titulo: b.titulo, regra: b.regra })),
  };
}
