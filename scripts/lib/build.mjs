import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { lerJson } from './json.mjs';
import { validarModelos, validarPapel } from './validar.mjs';
import { gerarAgenteClaude, gerarAgenteCodex } from './gerar.mjs';

const PASTAS_GERADAS = ['agents', 'codex-agents'];

export function construir(raiz) {
  const papeis = readdirSync(join(raiz, 'papeis')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  const modelos = lerJson(join(raiz, 'modelos.json'));
  const erros = validarModelos(modelos, papeis);
  const arquivos = new Map();
  for (const p of papeis) {
    let fm, corpo;
    try { ({ dados: fm, corpo } = parseFrontmatter(readFileSync(join(raiz, 'papeis', p + '.md'), 'utf8'))); }
    catch (e) { erros.push(`papeis/${p}.md: ${e.message}`); continue; }
    const ep = validarPapel(p, fm);
    erros.push(...ep);
    if (ep.length || !modelos?.claude?.[p] || !modelos?.codex?.[p]) continue;
    arquivos.set(`agents/${p}.md`, gerarAgenteClaude(p, fm, corpo, modelos.claude[p]));
    arquivos.set(`codex-agents/nabuco-${p}.toml`, gerarAgenteCodex(p, fm, corpo, modelos.codex[p]));
  }
  return { papeis, arquivos, erros };
}

function existentes(raiz) {
  const out = [];
  for (const pasta of PASTAS_GERADAS) {
    const d = join(raiz, pasta);
    if (existsSync(d)) for (const f of readdirSync(d)) out.push(`${pasta}/${f}`);
  }
  return out;
}

export function escrever(raiz, arquivos) {
  for (const rel of existentes(raiz)) if (!arquivos.has(rel)) rmSync(join(raiz, ...rel.split('/')), { force: true });
  for (const [rel, conteudo] of arquivos) {
    const partes = rel.split('/');
    mkdirSync(join(raiz, ...partes.slice(0, -1)), { recursive: true });
    writeFileSync(join(raiz, ...partes), conteudo);
  }
}

export function diferencas(raiz, arquivos) {
  const dif = [];
  for (const rel of existentes(raiz)) if (!arquivos.has(rel)) dif.push(`${rel} (obsoleto)`);
  for (const [rel, conteudo] of arquivos) {
    const caminho = join(raiz, ...rel.split('/'));
    if (!existsSync(caminho) || readFileSync(caminho, 'utf8') !== conteudo) dif.push(rel);
  }
  return dif;
}
