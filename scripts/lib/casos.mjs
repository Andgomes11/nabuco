import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAPEIS_CEREBRO } from './constantes.mjs';
import { slugify } from './texto.mjs';

export const CAMPOS_CASO = ['sintoma', 'contexto', 'hipotese_errada', 'causa_raiz', 'correcao', 'verificacao', 'sinal_precoce'];
const ROTULOS = {
  sintoma: 'sintoma', contexto: 'contexto', hipotese_errada: 'hipótese errada', causa_raiz: 'causa raiz',
  correcao: 'correção', verificacao: 'verificação', sinal_precoce: 'sinal precoce',
};
const OBRIGATORIOS = ['sintoma', 'causa_raiz', 'correcao', 'verificacao'];
const uma = s => String(s).replace(/\s*[\r\n]+\s*/g, ' ').trim();
const vazio = v => typeof v !== 'string' || !v.trim();

export function validarCaso(c) {
  const erros = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['caso deve ser um objeto'];
  if (!PAPEIS_CEREBRO.includes(c.papel)) erros.push(`papel inválido (use: ${PAPEIS_CEREBRO.join(', ')})`);
  for (const k of OBRIGATORIOS) if (vazio(c[k])) erros.push(`falta ${k}`);
  for (const k of CAMPOS_CASO) if (c[k] != null && typeof c[k] !== 'string') erros.push(`${k} deve ser texto`);
  if (c.tags != null && !(Array.isArray(c.tags) && c.tags.every(t => typeof t === 'string'))) erros.push('tags deve ser lista de textos');
  if (c.turnos != null && !(Number.isInteger(c.turnos) && c.turnos >= 0)) erros.push('turnos deve ser inteiro >= 0');
  if (c.recorrencia_de != null && vazio(c.recorrencia_de)) erros.push('recorrencia_de deve ser um id');
  return erros;
}

export function formatarCaso(c) {
  const linhas = [];
  for (const k of CAMPOS_CASO) {
    if (k === 'sintoma' || !vazio(c[k])) linhas.push(`${ROTULOS[k]}: ${uma(c[k] ?? '')}`);
  }
  if (!vazio(c.recorrencia_de)) linhas.push(`recorrência de: ${uma(c.recorrencia_de)}`);
  const custo = Number.isInteger(c.turnos) ? `${c.turnos} turnos` : 'n/d';
  linhas.push(`custo: ${custo} · tags: ${(c.tags ?? []).map(uma).join(', ')} · papel: ${c.papel}`);
  return linhas.join('\n') + '\n';
}

function interpretar(texto, arquivo) {
  const c = { arquivo, tags: [] };
  const inverso = Object.fromEntries(Object.entries(ROTULOS).map(([k, r]) => [r, k]));
  for (const l of texto.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([^:]+):\s?(.*)$/.exec(l);
    if (!m) continue;
    const rot = m[1].trim();
    if (inverso[rot]) c[inverso[rot]] = m[2].trim();
    else if (rot === 'recorrência de') c.recorrencia_de = m[2].trim();
    else if (rot === 'custo') {
      const t = /^(\d+) turnos/.exec(m[2]);
      if (t) c.turnos = Number(t[1]);
      const g = /tags:\s*(.*?)\s*·\s*papel:/.exec(m[2]);
      if (g) c.tags = g[1].split(',').map(s => s.trim()).filter(Boolean);
      const p = /papel:\s*(\S+)/.exec(m[2]);
      if (p) c.papel = p[1];
    }
  }
  return c;
}

export function gravarCaso(home, c) {
  const mes = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const slug = slugify(c.sintoma) || 'caso';
  const dir = join(home, 'casos', c.papel);
  mkdirSync(dir, { recursive: true });
  let nome = `${mes}-${slug}.md`;
  for (let i = 2; existsSync(join(dir, nome)); i++) nome = `${mes}-${slug}-${i}.md`;
  writeFileSync(join(dir, nome), formatarCaso(c));
  return `casos/${c.papel}/${nome}`;
}

export function lerCasos(home, papel) {
  const papeis = papel ? [papel] : PAPEIS_CEREBRO;
  const saida = [];
  for (const p of papeis) {
    const dir = join(home, 'casos', p);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(x => x.endsWith('.md')).sort()) {
      const c = interpretar(readFileSync(join(dir, f), 'utf8'), `casos/${p}/${f}`);
      c.papel ||= p;
      saida.push(c);
    }
  }
  return saida;
}
