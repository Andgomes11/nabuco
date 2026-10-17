import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ehTransitorio } from './texto.mjs';
import { LIMITE_LICOES, DIAS_SEM_USO, MIN_POSITIVOS_PROMOCAO } from './constantes.mjs';

function lerTexto(arq) {
  try { return existsSync(arq) ? readFileSync(arq, 'utf8') : ''; } catch { return ''; }
}

function lerEventos(dir) {
  const eventos = [];
  for (const linha of lerTexto(join(dir, 'eventos.jsonl')).split(/\r?\n/)) {
    if (!linha.trim()) continue;
    try {
      const e = JSON.parse(linha);
      if (e && typeof e === 'object' && !Array.isArray(e)) eventos.push(e);
    } catch { /* linha corrompida: ignora */ }
  }
  return eventos;
}

function secaoLog(dir) {
  const linhas = lerTexto(join(dir, 'progresso.md')).split(/\r?\n/);
  const i = linhas.findIndex(l => /^##\s+Log\s*$/.test(l));
  if (i < 0) return [];
  const fim = linhas.findIndex((l, j) => j > i && /^## /.test(l));
  return linhas.slice(i + 1, fim < 0 ? undefined : fim).filter(l => l.trim());
}

export function coletarSinais(dir) {
  let estado = {};
  try { estado = JSON.parse(lerTexto(join(dir, 'estado.json')).replace(/^﻿/, '')) ?? {}; } catch { /* sem estado */ }
  const eventos = lerEventos(dir);
  const de = t => eventos.filter(e => e.tipo === t);
  const dados = e => (e.dados && typeof e.dados === 'object' ? e.dados : {});

  const criterios_falhos = [];
  const transitorios = [];
  for (const e of de('criterio').filter(e => dados(e).status === 'falhou')) {
    const item = { id: dados(e).id, evidencia: String(dados(e).evidencia ?? '') };
    (ehTransitorio(item.evidencia) ? transitorios : criterios_falhos).push(item);
  }
  return {
    tarefa: basename(dir),
    tipo: estado.tipo ?? null,
    tamanho: estado.tamanho ?? null,
    papeis: [...new Set(eventos.map(e => e.papel).filter(Boolean))],
    criterios_falhos,
    rodadas: de('rodada_correcao').length,
    achados: de('achado').map(e => ({ papel: e.papel ?? null, severidade: dados(e).severidade, resumo: dados(e).resumo })),
    gate_bloqueios: de('gate_bloqueou').length,
    correcoes_usuario: de('correcao_usuario').map(e => ({ papel: e.papel ?? null, dados: dados(e) })),
    licoes_usadas: de('licao_usada').map(e => ({ id: dados(e).id, util: dados(e).util })),
    transitorios,
    log: secaoLog(dir),
  };
}

const DIA = 86400000;
const dias = (a, b) => (Date.parse(b) - Date.parse(a)) / DIA;

export function propostasHigiene(blocos, hoje) {
  const props = [];
  const ativasLista = blocos.filter(b => !b.regra);
  const grupos = new Map();
  for (const b of ativasLista) {
    const papel = String(b.id).replace(/-\d+$/, '');
    const chave = `${papel}\u0000${b.escopo ?? ''}`;
    if (!grupos.has(chave)) grupos.set(chave, { papel, escopo: b.escopo ?? null, n: 0 });
    grupos.get(chave).n++;
  }
  for (const g of grupos.values()) {
    if (g.n > LIMITE_LICOES) props.push({ id: null, papel: g.papel, motivo: 'excesso', detalhe: `${g.n} lições ativas em ${g.escopo ?? 'escopo desconhecido'} (limite ${LIMITE_LICOES})` });
  }
  for (const b of ativasLista) {
    const papel = String(b.id).replace(/-\d+$/, '');
    if (b.ultima && dias(b.ultima, hoje) > DIAS_SEM_USO) props.push({ id: b.id, papel, motivo: 'sem_uso', detalhe: `última em ${b.ultima}` });
    if (b.negativos > b.positivos) props.push({ id: b.id, papel, motivo: 'ruim', detalhe: `👍${b.positivos} 👎${b.negativos}` });
    if (b.positivos >= MIN_POSITIVOS_PROMOCAO && b.negativos === 0) props.push({ id: b.id, papel, motivo: 'promover', detalhe: `👍${b.positivos} 👎0, sem regra` });
  }
  return props;
}
