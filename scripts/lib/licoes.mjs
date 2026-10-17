const CAMPOS = /^- (gatilho|expectativa|faça|por quê|evidência|regra|aposentada):\s?(.*)$/;
const VOTOS = /^- 👍\s*(\d+)\s+👎\s*(\d+)(?:\s*·\s*última:\s*(\S*))?\s*$/;
const TITULO = /^##\s+(\S+)(?:\s*·\s*(.*))?$/;

const semBom = t => String(t ?? '').replace(/^﻿/, '');
const linhas = t => t.split(/\r?\n/);

function parseBloco(bruto) {
  const b = { id: '', titulo: '', gatilho: '', expectativa: '', faca: '', porque: '', evidencia: [], escopo: 'global', positivos: 0, negativos: 0, ultima: null, regra: null, aposentada: null, bruto };
  for (const l of linhas(bruto)) {
    const t = l.match(TITULO);
    if (t && !b.id) { b.id = t[1]; b.titulo = (t[2] ?? '').trim(); continue; }
    const v = l.match(VOTOS);
    if (v) { b.positivos = Number(v[1]); b.negativos = Number(v[2]); b.ultima = v[3] || null; continue; }
    const c = l.match(CAMPOS);
    if (!c) continue;
    const val = c[2].trim();
    switch (c[1]) {
      case 'gatilho': b.gatilho = val; break;
      case 'expectativa': b.expectativa = val; break;
      case 'faça': b.faca = val; break;
      case 'por quê': b.porque = val; break;
      case 'regra': b.regra = val; break;
      case 'aposentada': b.aposentada = val; break;
      case 'evidência': {
        const m = val.match(/^(.*?)(?:\s*·\s*escopo:\s*(\S+))?$/);
        if (m[2]) b.escopo = m[2];
        const ev = m[1];
        const links = ev.match(/\[[^\]]*\]\([^)]*\)/g);
        b.evidencia = links ?? ev.split(',').map(x => x.trim()).filter(Boolean);
        break;
      }
    }
  }
  return b;
}

function separar(texto) {
  const t = semBom(texto);
  const idx = [];
  const re = /^## /gm;
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  const cabecalho = t.slice(0, idx.length ? idx[0] : t.length);
  const blocos = idx.map((ini, i) => parseBloco(t.slice(ini, i + 1 < idx.length ? idx[i + 1] : t.length)));
  return { cabecalho, blocos };
}

export function lerLicoes(texto) {
  return separar(texto);
}

function linhasDoBloco(b) {
  const l = [`## ${b.id} · ${b.titulo}`,
    `- gatilho: ${b.gatilho}`,
    `- expectativa: ${b.expectativa}`,
    `- faça: ${b.faca}`,
    `- por quê: ${b.porque}`,
    `- evidência: ${(b.evidencia ?? []).join(', ')} · escopo: ${b.escopo ?? 'global'}`,
    `- 👍 ${b.positivos ?? 0}  👎 ${b.negativos ?? 0}${b.ultima ? ` · última: ${b.ultima}` : ''}`];
  if (b.regra) l.push(`- regra: ${b.regra}`);
  if (b.aposentada) l.push(`- aposentada: ${b.aposentada}`);
  return l;
}

export function serializarBloco(b) {
  return linhasDoBloco(b).join('\n') + '\n';
}

function ehConhecida(l) {
  return TITULO.test(l) || VOTOS.test(l) || CAMPOS.test(l);
}

export function substituirBloco(texto, id, novo) {
  const alvo = separar(texto).blocos.find(b => b.id === id);
  if (!alvo) return texto;
  const pos = texto.indexOf(alvo.bruto);
  if (pos < 0) return texto;
  const fim = pos + alvo.bruto.length;
  if (novo === null) return texto.slice(0, pos) + texto.slice(fim);
  const eol = alvo.bruto.includes('\r\n') ? '\r\n' : '\n';
  const corpo = alvo.bruto.trimEnd();
  const cauda = alvo.bruto.slice(corpo.length);
  const extras = linhas(corpo).filter(l => l.trim() !== '' && !ehConhecida(l));
  const nova = [...linhasDoBloco(novo), ...extras].join(eol) + cauda;
  return texto.slice(0, pos) + nova + texto.slice(fim);
}

export function acrescentarBloco(texto, papel, bloco) {
  const ser = serializarBloco(bloco);
  if (!String(texto ?? '').trim()) return `# Lições — ${papel}\n\n${ser}`;
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  let base = texto;
  if (!/\n$/.test(base)) base += eol;
  if (!/(\r?\n){2}$/.test(base)) base += eol;
  return base + ser.replace(/\n/g, eol);
}

export function proximoId(papel, textos) {
  let max = 0;
  for (const t of textos) {
    const re = new RegExp(`^##\\s+${papel}-(\\d+)`, 'gm');
    let m;
    while ((m = re.exec(semBom(t)))) max = Math.max(max, Number(m[1]));
  }
  return `${papel}-${String(max + 1).padStart(4, '0')}`;
}
