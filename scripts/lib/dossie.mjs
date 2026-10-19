import { basename } from 'node:path';
import { calcularMetricas, tarefasRecentes, chaveTarefa } from './metricas.mjs';
import { lerCasos } from './casos.mjs';
import { blocosDe, ativas } from './repositorio-licoes.mjs';
import { configDe } from './modelos.mjs';
import { NIVEL_NUM } from './painel-estado.mjs';
import { AMOSTRA_NIVEL } from './constantes.mjs';

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
  // escritor: aceitação de primeira; checador: achados que viraram correção
  const precisao = num(m.aceitacao_1a) ?? num(m.achados_uteis);
  const rec = num(m.recorrencia);
  const esc = num(m.escapes);
  const amostra = num(m.amostra);
  const partes = [];
  if (rec !== null) partes.push(1 - rec);
  // sem aceitação nem achados avaliáveis (checador que só participou), "nada escapou" não é mérito
  const avaliavel = num(m.aceitacao_1a) !== null || num(m.achados_uteis) !== null;
  if (esc !== null && avaliavel && amostra !== null && amostra > 0) partes.push(1 - Math.min(1, esc / amostra));
  return { faro, precisao, confiabilidade: media(partes) };
}

// tolerância 1e-12: a diferença de duas taxas em ponto flutuante pode cair um fio abaixo de 0,05
// (ex.: 0.7 - 0.65 = 0.04999999999999993); sem ela, uma variação de exatamente 5 pontos viraria '→'
const seta = (agora, antes) => {
  if (agora === null || antes === null) return null;
  const d = agora - antes;
  if (d >= LIMIAR_TENDENCIA - 1e-12) return '↑';
  if (d <= -LIMIAR_TENDENCIA + 1e-12) return '↓';
  return '→';
};

// indicadores que alimentam cada atributo (os mesmos do clique em modelo.mjs)
const INDICADORES_ATRIBUTO = { faro: ['turnos_ate_causa'], precisao: ['aceitacao_1a', 'achados_uteis'], confiabilidade: ['recorrencia', 'escapes'] };

// índices (no array original) das fontes dos indicadores; `mapa` traduz índices de um subconjunto
const fontesDe = (fontes, indicadores, mapa) =>
  [...new Set(indicadores.flatMap(ind => (fontes?.[ind] ?? []).map(i => (mapa ? mapa[i] : i))))].sort((a, b) => a - b);

// Atributos com todos os eventos vs. sem os eventos das 10 tarefas fechadas mais recentes.
// Sem "antes" real (as fontes do atributo são as mesmas nos dois lados, ou o antes não tem fonte) => null.
export function tendencia(eventos, papel) {
  const evs = Array.isArray(eventos) ? eventos : [];
  const recentes = tarefasRecentes(evs, TAREFAS_RECENTES);
  const mapa = [];
  evs.forEach((e, i) => { const k = e && typeof e === 'object' ? chaveTarefa(e) : null; if (k === null || !recentes.has(k)) mapa.push(i); });
  const antigos = mapa.map(i => evs[i]);
  const mAgora = calcularMetricas(evs, { fontes: true })[papel];
  const mAntes = calcularMetricas(antigos, { fontes: true })[papel];
  const agora = atributos(mAgora);
  const antes = atributos(mAntes);
  const res = NULO();
  for (const [attr, inds] of Object.entries(INDICADORES_ATRIBUTO)) {
    const fAgora = fontesDe(mAgora?.fontes, inds);
    const fAntes = fontesDe(mAntes?.fontes, inds, mapa);
    if (fAntes.length === 0 || fAntes.join(',') === fAgora.join(',')) continue;
    res[attr] = seta(agora[attr], antes[attr]);
  }
  return res;
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
    // nível só aparece a partir de AMOSTRA_NIVEL tarefas; antes, "em avaliação"
    nivel: (metricas.amostra ?? 0) >= AMOSTRA_NIVEL ? metricas.nivel ?? null : null,
    nivelNum: (metricas.amostra ?? 0) >= AMOSTRA_NIVEL ? NIVEL_NUM[metricas.nivel] ?? null : null,
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
