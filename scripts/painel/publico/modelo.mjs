// Funções puras de apresentação do painel (sem DOM): rodam no navegador e nos testes.

const finito = x => typeof x === 'number' && Number.isFinite(x);
const limitar01 = x => (finito(x) ? Math.max(0, Math.min(1, x)) : 0);

// colunas por segundo: só quem trabalha tem chuva em movimento, na proporção da atividade real
export function velocidadeChuva(f) {
  if (!f || f.estado !== 'trabalhando') return 0;
  return 2 + 18 * limitar01(f.atividade);
}

export function corDoEstado(estado) {
  if (estado === 'trabalhando') return 'verde';
  if (estado === 'aguardando') return 'vermelho';
  return 'apagado';
}

export function rotuloEstado(estado) {
  if (estado === 'trabalhando') return 'trabalhando';
  if (estado === 'aguardando') return 'aguardando você';
  return 'ocioso';
}

// o que o monitor mostra. Sem conexão com o servidor (encerrado), o estado é velho: nada anima nem
// afirma "trabalhando" — a tela fica "desconectado" até a conexão voltar
export function aparenciaMonitor(f, conectado) {
  if (!conectado) return { cor: 'desconectado', vel: 0, rotulo: 'sem conexão' };
  const estado = f?.estado;
  const atividade = estado === 'trabalhando' ? ` · atividade ${formatarAtributo(f.atividade)}` : '';
  return { cor: corDoEstado(estado), vel: velocidadeChuva(f), rotulo: rotuloEstado(estado) + atividade };
}

export function rotuloNivel(f) {
  if (!f || typeof f.nivel !== 'string' || !f.nivel) return 'sem avaliação';
  return f.provisorio ? `${f.nivel} · provisório` : f.nivel;
}

export function formatarAtributo(v) {
  return finito(v) ? `${Math.round(v * 100)}%` : '—';
}

export function seta(t) {
  return t === '↑' || t === '↓' || t === '→' ? t : '';
}

export function urlAvatar(f, chave) {
  if (!f || typeof f.avatar !== 'string' || !f.avatar) return null;
  return `/avatares/${encodeURIComponent(f.avatar)}?k=${encodeURIComponent(chave)}`;
}

export function urlFontes(papel, indicador, versao, chave) {
  return `/api/fontes/${encodeURIComponent(papel)}/${encodeURIComponent(indicador)}?v=${encodeURIComponent(versao)}&k=${encodeURIComponent(chave)}`;
}

// votos de uma lição: os eventos licao_usada daquele id
export function urlFontesLicao(papel, id, versao, chave) {
  return `/api/fontes/${encodeURIComponent(papel)}/licao/${encodeURIComponent(id)}?v=${encodeURIComponent(versao)}&k=${encodeURIComponent(chave)}`;
}

// indicadores da Fase 2 com fontes clicáveis; formato decide como o número aparece
export const INDICADORES = [
  { chave: 'amostra', rotulo: 'tarefas na amostra', formato: 'inteiro' },
  { chave: 'aceitacao_1a', rotulo: 'aceitação de primeira', formato: 'taxa' },
  { chave: 'tentativas_ate_verde', rotulo: 'tentativas até verde', formato: 'media' },
  { chave: 'recorrencia', rotulo: 'recorrência de bugs', formato: 'taxa' },
  { chave: 'turnos_ate_causa', rotulo: 'turnos até a causa', formato: 'media' },
  { chave: 'escapes', rotulo: 'escapes após pronto', formato: 'inteiro' },
  { chave: 'pct_util', rotulo: 'lições úteis', formato: 'taxa' },
  { chave: 'promocoes', rotulo: 'lições promovidas', formato: 'inteiro' },
];
const FORMATO = new Map(INDICADORES.map(i => [i.chave, i.formato]));

export function formatarIndicador(chave, v) {
  if (!finito(v)) return '—';
  const formato = FORMATO.get(chave);
  if (formato === 'taxa') return formatarAtributo(v);
  if (formato === 'media') return v.toFixed(1).replace('.', ',');
  return String(Math.round(v));
}

// atributos do dossiê e os indicadores que os alimentam (o clique leva às fontes deles)
export const ATRIBUTOS = [
  { chave: 'faro', rotulo: 'Faro', dica: 'achar a causa', indicadores: ['turnos_ate_causa'] },
  { chave: 'precisao', rotulo: 'Precisão', dica: 'acertar de primeira', indicadores: ['aceitacao_1a'] },
  { chave: 'confiabilidade', rotulo: 'Confiabilidade', dica: 'não deixar escapar nem repetir', indicadores: ['recorrencia', 'escapes'] },
];

// gate no cabeçalho: sem critérios é neutro ("nenhum critério definido"), nunca "todos passaram"
export function resumoGate(g) {
  const passou = finito(g?.passou) ? g.passou : 0;
  const total = finito(g?.total) ? g.total : 0;
  const pendencias = Array.isArray(g?.pendencias) ? g.pendencias : [];
  const base = { placar: `${passou}/${total}`, passou, total, pendencias };
  if (total === 0) return { ...base, situacao: 'vazio', mensagem: 'nenhum critério definido' };
  if (pendencias.length || passou < total) return { ...base, situacao: 'pendente', mensagem: pendencias.length ? null : 'critérios pendentes' };
  return { ...base, situacao: 'ok', mensagem: 'todos os critérios passaram com evidência' };
}
