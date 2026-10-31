// Relatório do time: o que aconteceu num período, a partir dos eventos de ~/.nabuco/historico.jsonl.
// Funções puras: recebem eventos e opções, devolvem um objeto (montarRelatorio) ou Markdown (formatarRelatorio).
// Datas internas em ms UTC; o fuso local só aparece na exibição e na leitura de AAAA-MM-DD.
// O relatório não traz caminhos da máquina nem conteúdo de transcrições: só nomes, papéis, contagens e resumos.
import { calcularMetricas, chaveTarefa } from './metricas.mjs';
import { AMOSTRA_NIVEL } from './constantes.mjs';

const DIA = 24 * 3600e3;
const ehObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const dadosDe = e => (ehObj(e.dados) ? e.dados : {});
// mesmo rótulo do cérebro e do painel: nível só a partir de AMOSTRA_NIVEL tarefas
const rotuloNivel = m => (m.amostra > 0 && m.amostra < AMOSTRA_NIVEL ? `em avaliação (${m.amostra}/${AMOSTRA_NIVEL})`
  : m.nivel === null ? (m.amostra >= AMOSTRA_NIVEL ? 'sem indicador' : '—') : m.provisorio ? `${m.nivel} (provisório)` : m.nivel);
const tempo = e => Date.parse(e.ts);
const SEVERIDADES = ['alta', 'media', 'baixa', 'outra'];
const CAMPOS_TOKENS = ['entrada', 'saida', 'cache_leitura', 'cache_escrita'];
const ANO_MINIMO = 1970; // o período não começa antes da época Unix (e Date nunca sai do intervalo válido)

// --- período: { desde, ate (exclusivo), descricao, desdeDia, ateDia } ---
const doisDig = n => String(n).padStart(2, '0');
export const dataLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`; };
const dataHoraLocal = ms => { const d = new Date(ms); return `${dataLocal(ms)} ${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`; };
const periodo = (desde, ate, descricao) => ({ desde, ate, descricao, desdeDia: dataLocal(desde), ateDia: dataLocal(ate - 1) });

export function periodoPorDias(dias, agora = Date.now()) {
  if (!Number.isInteger(dias) || dias < 1) throw new Error('--dias deve ser um inteiro positivo');
  if (agora - dias * DIA < 0) throw new Error(`--dias ${dias} é grande demais: o período começaria antes de ${ANO_MINIMO}`);
  return periodo(agora - dias * DIA, agora + 1, `últimos ${dias} dias`);
}

// AAAA-MM-DD => meia-noite local daquele dia; data inexistente (2026-02-30) é erro.
function diaLocal(s, opcao) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!d || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    if (m && Number(m[1]) < ANO_MINIMO) throw new Error(`${opcao} "${s}" é antes de ${ANO_MINIMO}`);
    throw new Error(`${opcao} "${s}" não é uma data AAAA-MM-DD válida`);
  }
  if (d.getFullYear() < ANO_MINIMO) throw new Error(`${opcao} "${s}" é antes de ${ANO_MINIMO}`);
  return d;
}

// `ate` inclui o dia inteiro; sem `ate`, vai até agora.
export function periodoPorDatas(desde, ate = null, agora = Date.now()) {
  const ini = diaLocal(desde, '--desde').getTime();
  let fim = agora + 1;
  if (ate !== null && ate !== undefined) {
    const d = diaLocal(ate, '--ate');
    fim = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }
  if (fim <= ini) throw new Error(ate ? '--ate deve ser no mesmo dia ou depois de --desde' : '--desde está depois de hoje');
  return periodo(ini, fim, ate ? `de ${desde} a ${ate}` : `desde ${desde}`);
}

// Desde um instante ISO (ex.: data do commit da última tag) até agora.
export function periodoDesde(iso, descricao, agora = Date.now()) {
  const ini = Date.parse(iso);
  if (Number.isNaN(ini)) throw new Error(`data inválida "${iso}"`);
  if (ini > agora) throw new Error(`a data base (${iso}) está no futuro`);
  if (ini < 0) throw new Error(`a data base (${iso}) é antes de ${ANO_MINIMO}`);
  return periodo(ini, agora + 1, descricao);
}

export const nomeArquivo = p => `${p.desdeDia}_${p.ateDia}.md`;

// --- montagem ---
function severidade(s) {
  const n = String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return SEVERIDADES.includes(n) ? n : 'outra';
}
const contagemVazia = () => ({ alta: 0, media: 0, baixa: 0, outra: 0 });
const texto = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const numero = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const tokensDe = e => {
  const t = dadosDe(e).tokens;
  return ehObj(t) && CAMPOS_TOKENS.every(k => numero(t[k]) !== null) ? t : null;
};

// `projeto`: nome (basename) do projeto, ou null para todos. `papeis`/`escritores`: listas dinâmicas (time.mjs).
// `ilegiveis`/`historicoExiste`: o que a leitura do arquivo achou (lerHistoricoDetalhado).
export function montarRelatorio(eventos, { periodo: p, projeto = null, papeis, escritores, ilegiveis = 0, historicoExiste = true, gerado = new Date().toISOString() }) {
  const validos = (Array.isArray(eventos) ? eventos : []).filter(e => ehObj(e) && typeof e.tipo === 'string');
  const escopo = projeto === null ? validos : validos.filter(e => e.projeto === projeto);
  const semData = escopo.filter(e => Number.isNaN(tempo(e)));
  const comData = escopo.filter(e => !Number.isNaN(tempo(e))).sort((a, b) => tempo(a) - tempo(b));
  const noPeriodo = comData.filter(e => tempo(e) >= p.desde && tempo(e) < p.ate);
  const ateFim = comData.filter(e => tempo(e) < p.ate);
  const doTipo = (evs, t) => evs.filter(e => e.tipo === t);

  // tarefas com atividade no período; tamanho, tipo e desfecho olham o histórico até o fim do período
  const tarefas = new Map();
  for (const e of noPeriodo) {
    const k = chaveTarefa(e);
    if (k === null || tarefas.has(k)) continue;
    const daTarefa = ateFim.filter(x => chaveTarefa(x) === k);
    const criacao = daTarefa.find(x => x.tipo === 'tarefa_criada');
    const fim = daTarefa.filter(x => x.tipo === 'tarefa_fechada' || x.tipo === 'tarefa_abandonada').at(-1);
    const noP = noPeriodo.filter(x => chaveTarefa(x) === k);
    const achados = contagemVazia();
    for (const a of doTipo(noP, 'achado')) achados[severidade(dadosDe(a).severidade)]++;
    tarefas.set(k, {
      projeto: e.projeto, tarefa: e.tarefa,
      tamanho: criacao ? texto(dadosDe(criacao).tamanho) || null : null,
      tipo: criacao ? texto(dadosDe(criacao).tipo) || null : null,
      criada: criacao ? criacao.ts : null,
      desfecho: !fim ? 'em andamento' : fim.tipo === 'tarefa_fechada' ? 'concluída' : 'abandonada',
      duracao_ms: criacao && fim ? Math.max(0, tempo(fim) - tempo(criacao)) : null,
      rodadas: doTipo(noP, 'rodada_correcao').length,
      achados,
      gate_bloqueios: doTipo(noP, 'gate_bloqueou').length,
      criterios_falharam: [...new Set(doTipo(noP, 'criterio').filter(c => dadosDe(c).status === 'falhou').map(c => texto(dadosDe(c).id)))],
      _ordem: criacao ? tempo(criacao) : tempo(e),
    });
  }
  const listaTarefas = [...tarefas.values()].sort((a, b) => a._ordem - b._ordem).map(({ _ordem, ...t }) => t);

  // checadores: achados por papel × severidade, com os resumos de alta e média
  const checadores = {};
  for (const a of doTipo(noPeriodo, 'achado')) {
    const papel = a.papel ?? '(sem papel)';
    const c = (checadores[papel] ??= { contagem: contagemVazia(), destaques: [] });
    const sev = severidade(dadosDe(a).severidade);
    c.contagem[sev]++;
    if (sev === 'alta' || sev === 'media') c.destaques.push({ severidade: sev, projeto: a.projeto ?? null, tarefa: a.tarefa ?? null, resumo: texto(dadosDe(a).resumo) });
  }

  const escapes = doTipo(noPeriodo, 'correcao_usuario').filter(e => dadosDe(e).apos_pronto === true)
    .map(e => ({ papel: e.papel ?? null, projeto: e.projeto ?? null, tarefa: e.tarefa ?? null, resumo: texto(dadosDe(e).resumo) }));

  const cerebro = {
    casos: doTipo(noPeriodo, 'caso_criado').map(e => ({
      papel: e.papel ?? null, tarefa: e.tarefa ?? null,
      tags: Array.isArray(dadosDe(e).tags) ? dadosDe(e).tags.map(texto) : [],
    })),
    licoes_criadas: doTipo(noPeriodo, 'licao_criada').map(e => ({ id: texto(dadosDe(e).id), escopo: texto(dadosDe(e).escopo) || null, papel: e.papel ?? null })),
    licoes_usadas: doTipo(noPeriodo, 'licao_usada').filter(e => typeof dadosDe(e).util === 'boolean')
      .map(e => ({ id: texto(dadosDe(e).id), util: dadosDe(e).util, papel: e.papel ?? null, tarefa: e.tarefa ?? null })),
  };

  // funcionários: papéis com qualquer evento no período (inclui contratados e papéis que sumiram do time)
  const vistos = [...new Set(noPeriodo.map(e => e.papel).filter(x => typeof x === 'string' && x))];
  const todosPapeis = [...papeis, ...vistos.filter(x => !papeis.includes(x))];
  // o período inteiro: sem a janela das últimas 30 tarefas que o painel e o cérebro usam
  const metricas = calcularMetricas(noPeriodo, { papeis: todosPapeis, escritores, janela: Infinity });
  const funcionarios = {};
  const finsDoTime = doTipo(noPeriodo, 'agente_fim').filter(e => e.papel);
  for (const papel of todosPapeis.filter(x => vistos.includes(x))) {
    const fins = finsDoTime.filter(e => e.papel === papel);
    const duracoes = fins.map(e => numero(dadosDe(e).duracao_ms)).filter(x => x !== null);
    const total = duracoes.reduce((a, b) => a + b, 0);
    const modelos = {};
    for (const f of fins) {
      const d = dadosDe(f);
      const m = `${texto(d.modelo) || '?'}${d.effort ? `/${texto(d.effort)}` : ''}`;
      modelos[m] = (modelos[m] ?? 0) + 1;
    }
    const medidos = fins.map(tokensDe).filter(Boolean);
    const tokens = medidos.length
      ? { ...Object.fromEntries(CAMPOS_TOKENS.map(k => [k, medidos.reduce((s, t) => s + t[k], 0)])), medidas: medidos.length }
      : null;
    funcionarios[papel] = {
      execucoes: fins.length, duracao_total_ms: total, duracao_media_ms: duracoes.length ? total / duracoes.length : null,
      modelos, tokens, metricas: metricas[papel] ?? null,
    };
  }

  const tokensTotal = Object.values(funcionarios).filter(f => f.tokens);
  const idsFim = new Set(doTipo(escopo, 'agente_fim').map(e => dadosDe(e).agent_id).filter(Boolean));
  const qualidade = {
    historico_existe: historicoExiste,
    linhas_ilegiveis: ilegiveis,
    eventos_sem_data: semData.length,
    fim_sem_duracao: finsDoTime.filter(e => numero(dadosDe(e).duracao_ms) === null).length,
    inicio_sem_fim: doTipo(noPeriodo, 'agente_inicio').filter(e => e.papel && !idsFim.has(dadosDe(e).agent_id)).length,
    execucoes_sem_papel: doTipo(noPeriodo, 'agente_fim').filter(e => !e.papel).length,
    execucoes_sem_tokens: finsDoTime.filter(e => !tokensDe(e)).length,
    tarefas_sem_criacao: listaTarefas.filter(t => t.criada === null).length,
    sem_eventos: noPeriodo.length === 0,
  };

  const achados = contagemVazia();
  for (const a of doTipo(noPeriodo, 'achado')) achados[severidade(dadosDe(a).severidade)]++;
  const unicas = t => new Set(doTipo(noPeriodo, t).map(chaveTarefa).filter(Boolean)).size;
  const criterios = doTipo(noPeriodo, 'criterio');
  return {
    gerado, projeto,
    periodo: { desde: new Date(p.desde).toISOString(), ate: new Date(p.ate).toISOString(), descricao: p.descricao, desde_dia: p.desdeDia, ate_dia: p.ateDia },
    eventos: noPeriodo.length,
    resumo: {
      tarefas: {
        criadas: unicas('tarefa_criada'), concluidas: unicas('tarefa_fechada'), abandonadas: unicas('tarefa_abandonada'),
        em_andamento: listaTarefas.filter(t => t.desfecho === 'em andamento').length,
      },
      criterios: { passou: criterios.filter(c => dadosDe(c).status === 'passou').length, falhou: criterios.filter(c => dadosDe(c).status === 'falhou').length },
      rodadas: doTipo(noPeriodo, 'rodada_correcao').length,
      achados,
      escapes: escapes.length,
      agentes: {
        execucoes: finsDoTime.length,
        duracao_ms: finsDoTime.reduce((s, e) => s + (numero(dadosDe(e).duracao_ms) ?? 0), 0),
      },
      tokens: tokensTotal.length
        ? { ...Object.fromEntries(CAMPOS_TOKENS.map(k => [k, tokensTotal.reduce((s, f) => s + f.tokens[k], 0)])), medidas: tokensTotal.reduce((s, f) => s + f.tokens.medidas, 0) }
        : null,
    },
    tarefas: listaTarefas, checadores, escapes, cerebro, funcionarios, qualidade,
  };
}

// --- Markdown ---
const celula = s => String(s ?? '').replace(/\r?\n|\r/g, ' ').replace(/\|/g, '\\|').trim();
const curto = (s, max = 200) => { const t = celula(s); return t.length > max ? `${t.slice(0, max)}…` : t; };
const milhar = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pct = x => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const num = (x, casas = 1) => (x === null || x === undefined ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(casas));
const SEV = { alta: 'alta', media: 'média', baixa: 'baixa', outra: 'outra' };
const nomeTarefa = (r, t) => (r.projeto === null ? `${celula(t.projeto ?? '?')} › ${celula(t.tarefa ?? '(sem tarefa)')}` : celula(t.tarefa ?? '(sem tarefa)'));

export function duracao(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${s % 60 ? ` ${s % 60}s` : ''}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${doisDig(m % 60)}min` : ''}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`;
}

const fmtTokens = t => (t ? `entrada ${milhar(t.entrada)} · saída ${milhar(t.saida)} · cache leitura ${milhar(t.cache_leitura)} · cache escrita ${milhar(t.cache_escrita)}` : 'não medido');
const fmtAchados = c => `${c.alta} alta, ${c.media} média, ${c.baixa} baixa${c.outra ? `, ${c.outra} sem severidade conhecida` : ''}`;
const SEM_EVENTOS = '_Nenhum evento no período._';

export function formatarRelatorio(r) {
  const vazio = r.qualidade.sem_eventos;
  const desde = Date.parse(r.periodo.desde), ate = Date.parse(r.periodo.ate) - 1;
  const md = [
    `# Relatório do time nabuco — ${r.projeto === null ? 'todos os projetos' : celula(r.projeto)}`,
    '',
    `Período: ${dataHoraLocal(desde)} a ${dataHoraLocal(ate)} (${celula(r.periodo.descricao)}) · gerado em ${dataHoraLocal(Date.parse(r.gerado))} · ${r.eventos} evento(s)`,
  ];
  if (vazio) {
    md.push('', `> **Nenhum evento no período${r.projeto === null ? '' : ` para o projeto ${celula(r.projeto)}`}.** Nada foi conferido: isto não quer dizer que deu tudo certo. Veja "Qualidade dos dados".`);
  }

  md.push('', '## Resumo', '');
  if (vazio) md.push(SEM_EVENTOS);
  else {
    const s = r.resumo;
    md.push('| Item | Total |', '|---|---|',
      `| Tarefas criadas | ${s.tarefas.criadas} |`,
      `| Tarefas concluídas | ${s.tarefas.concluidas} |`,
      `| Tarefas abandonadas | ${s.tarefas.abandonadas} |`,
      `| Tarefas em andamento | ${s.tarefas.em_andamento} |`,
      `| Critérios verificados | ${s.criterios.passou} passaram, ${s.criterios.falhou} falharam |`,
      `| Rodadas de correção | ${s.rodadas} |`,
      `| Achados dos checadores | ${fmtAchados(s.achados)} |`,
      `| Escapes (correção do usuário depois do pronto) | ${s.escapes} |`,
      `| Execuções de funcionários | ${s.agentes.execucoes} (tempo total ${duracao(s.agentes.duracao_ms)}) |`,
      `| Tokens | ${s.tokens ? `${fmtTokens(s.tokens)} (${s.tokens.medidas} de ${s.agentes.execucoes} execuções medidas)` : 'não medido'} |`);
  }

  md.push('', '## Tarefas', '');
  if (vazio) md.push(SEM_EVENTOS);
  else if (!r.tarefas.length) md.push('Nenhuma tarefa com atividade no período (só eventos fora de tarefa).');
  else {
    md.push(`| ${r.projeto === null ? 'Projeto | ' : ''}Tarefa | Tamanho | Tipo | Desfecho | Duração | Rodadas | Achados (A/M/B) | Gate bloqueou | Critérios que falharam |`,
      `|${r.projeto === null ? '---|' : ''}---|---|---|---|---|---|---|---|---|`);
    for (const t of r.tarefas) {
      md.push(`| ${r.projeto === null ? `${celula(t.projeto)} | ` : ''}${celula(t.tarefa)} | ${celula(t.tamanho ?? '?')} | ${celula(t.tipo ?? '?')} | ${t.desfecho} | ${duracao(t.duracao_ms)} | ${t.rodadas} | ${t.achados.alta}/${t.achados.media}/${t.achados.baixa}${t.achados.outra ? ` (+${t.achados.outra})` : ''} | ${t.gate_bloqueios} | ${t.criterios_falharam.map(celula).join(', ') || '—'} |`);
    }
    md.push('', 'Rodadas, achados, bloqueios e critérios contam só o que aconteceu dentro do período; duração vai da criação ao fechamento.');
  }

  md.push('', '## Checadores', '');
  const chec = Object.entries(r.checadores).sort(([a], [b]) => a.localeCompare(b));
  if (vazio) md.push(SEM_EVENTOS);
  else if (!chec.length) md.push('Nenhum achado registrado no período.');
  else {
    md.push('| Papel | Alta | Média | Baixa | Outra |', '|---|---|---|---|---|');
    for (const [papel, c] of chec) md.push(`| ${celula(papel)} | ${c.contagem.alta} | ${c.contagem.media} | ${c.contagem.baixa} | ${c.contagem.outra} |`);
    const destaques = chec.flatMap(([papel, c]) => c.destaques.map(d => ({ papel, ...d })));
    if (destaques.length) {
      md.push('', 'Achados de severidade alta e média:', '');
      for (const d of destaques) md.push(`- **${SEV[d.severidade]}** · ${celula(d.papel)} · ${nomeTarefa(r, d)}: ${curto(d.resumo) || '(sem resumo)'}`);
    }
  }

  md.push('', '## Escapes', '');
  if (vazio) md.push(SEM_EVENTOS);
  else if (!r.escapes.length) md.push('Nenhum escape registrado no período (correção do usuário depois do pronto).');
  else for (const e of r.escapes) md.push(`- ${celula(e.papel ?? '(sem papel)')} · ${nomeTarefa(r, e)}: ${curto(e.resumo) || '(sem resumo)'}`);

  md.push('', '## Cérebro', '');
  if (vazio) md.push(SEM_EVENTOS);
  else {
    const c = r.cerebro;
    const uteis = c.licoes_usadas.filter(l => l.util).length;
    md.push(`- Casos criados: ${c.casos.length}`);
    for (const k of c.casos) md.push(`  - ${celula(k.papel ?? '(sem papel)')}${k.tarefa ? ` · ${celula(k.tarefa)}` : ''}${k.tags.length ? ` — tags: ${k.tags.map(celula).join(', ')}` : ''}`);
    md.push(`- Lições criadas: ${c.licoes_criadas.length}`);
    for (const l of c.licoes_criadas) md.push(`  - ${celula(l.id)}${l.escopo ? ` (${celula(l.escopo)})` : ''}`);
    md.push(`- Lições usadas: ${c.licoes_usadas.length} (👍 ${uteis}, 👎 ${c.licoes_usadas.length - uteis})`);
    for (const l of c.licoes_usadas) md.push(`  - ${celula(l.id)} ${l.util ? '👍' : '👎'} · ${celula(l.papel ?? '(sem papel)')}${l.tarefa ? ` · ${celula(l.tarefa)}` : ''}`);
  }

  md.push('', '## Funcionários', '');
  const funcs = Object.entries(r.funcionarios);
  if (vazio) md.push(SEM_EVENTOS);
  else if (!funcs.length) md.push('Nenhum funcionário do time com atividade no período.');
  else {
    md.push('| Papel | Execuções | Tempo total | Tempo médio | Modelo/effort | Tokens |', '|---|---|---|---|---|---|');
    for (const [papel, f] of funcs) {
      const modelos = Object.entries(f.modelos).map(([m, n]) => `${celula(m)} (${n})`).join(', ') || '—';
      const tokens = f.tokens ? `${fmtTokens(f.tokens)}${f.tokens.medidas < f.execucoes ? ` (${f.tokens.medidas} de ${f.execucoes} medidas)` : ''}` : f.execucoes ? 'não medido' : '—';
      md.push(`| ${celula(papel)} | ${f.execucoes} | ${f.execucoes ? duracao(f.duracao_total_ms) : '—'} | ${duracao(f.duracao_media_ms)} | ${modelos} | ${tokens} |`);
    }
    md.push('', '| Papel | Amostra | Aceitação 1ª | Tentativas até verde | Escapes | Lições úteis | Nível |', '|---|---|---|---|---|---|---|');
    for (const [papel, f] of funcs) {
      const m = f.metricas;
      if (!m) { md.push(`| ${celula(papel)} | — | — | — | — | — | — |`); continue; }
      md.push(`| ${celula(papel)} | ${m.amostra} | ${pct(m.aceitacao_1a)} | ${num(m.tentativas_ate_verde)} | ${m.escapes ?? '—'} | ${pct(m.pct_util)} | ${rotuloNivel(m)} |`);
    }
    md.push('', 'Métricas calculadas só com os eventos do período (amostra = tarefas fechadas no período em que o papel atuou). Tokens vêm do transcript do agente no Claude Code; Codex e eventos antigos ficam como "não medido". Sem preço em dinheiro.');
  }

  const q = r.qualidade;
  md.push('', '## Qualidade dos dados', '');
  if (!q.historico_existe) md.push('- **Histórico não encontrado** (`historico.jsonl` não existe): nenhum evento foi lido.');
  if (vazio) md.push(`- **Nenhum evento no período**${r.projeto === null ? '' : ` para o projeto ${celula(r.projeto)}`}: as seções acima não conferiram nada.`);
  md.push(
    `- Linhas ilegíveis no histórico (arquivo inteiro, ignoradas): ${q.linhas_ilegiveis}`,
    `- Eventos sem data legível (fora de qualquer período): ${q.eventos_sem_data}`,
    `- Execuções do time sem duração (fim sem início correspondente): ${q.fim_sem_duracao}`,
    `- Execuções do time iniciadas sem fim registrado: ${q.inicio_sem_fim}`,
    `- Execuções de agentes fora do nabuco (sem papel), ignoradas: ${q.execucoes_sem_papel}`,
    `- Execuções do time sem tokens medidos: ${q.execucoes_sem_tokens}`,
    `- Tarefas sem evento de criação no histórico (tamanho e tipo desconhecidos): ${q.tarefas_sem_criacao}`,
  );
  if (r.projeto !== null) md.push(`- Projeto identificado só pelo nome da pasta (${celula(r.projeto)}): outra pasta com o mesmo nome entra junto.`);
  return md.join('\n') + '\n';
}
