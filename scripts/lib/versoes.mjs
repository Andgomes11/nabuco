import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const normPy = s => s.toLowerCase().replace(/[-_.]+/g, '-');

const FONTES = [
  ['package-lock.json', (t, p) => { const j = JSON.parse(t); return j.packages?.[`node_modules/${p}`]?.version ?? j.dependencies?.[p]?.version; }],
  ['pnpm-lock.yaml', (t, p) => t.match(new RegExp(`^\\s+['"]?/?${esc(p)}@([^(:'"\\s]+)`, 'm'))?.[1]],
  ['yarn.lock', (t, p) => t.match(new RegExp(`^"?${esc(p)}@[^\\n]*\\n\\s+version:? "?([^"\\n]+)"?`, 'm'))?.[1]],
  ['Cargo.lock', (t, p) => t.match(new RegExp(`^name = "${esc(p)}"\\nversion = "([^"]+)"`, 'm'))?.[1]],
  ['Gemfile.lock', (t, p) => t.match(new RegExp(`^ {4}${esc(p)} \\(([^)]+)\\)`, 'm'))?.[1]],
  ['go.mod', (t, p) => t.match(new RegExp(`^\\s*(?:require\\s+)?${esc(p)}\\s+(v\\S+)`, 'm'))?.[1]],
  ['pubspec.lock', (t, p) => t.match(new RegExp(`^ {2}${esc(p)}:\\n(?: {4}.*\\n)*? {4}version: "([^"]+)"`, 'm'))?.[1]],
  ['poetry.lock', (t, p) => {
    for (const m of t.matchAll(/^name = "([^"]+)"\nversion = "([^"]+)"/gm)) if (normPy(m[1]) === normPy(p)) return m[2];
  }],
  ['requirements.txt', (t, p) => {
    for (const m of t.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s;#]+)/gm)) if (normPy(m[1]) === normPy(p)) return m[2];
  }],
];

function faixaPackageJson(projeto, p) {
  const f = join(projeto, 'package.json');
  if (!existsSync(f)) return undefined;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j.dependencies?.[p] ?? j.devDependencies?.[p] ?? j.peerDependencies?.[p];
  } catch { return undefined; }
}

export function detectarVersoes(projeto, pacotes) {
  const textos = {};
  for (const [nome] of FONTES) {
    const f = join(projeto, nome);
    if (existsSync(f)) textos[nome] = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  }
  const out = {};
  for (const p of pacotes) {
    out[p] = { versao: null, fonte: null };
    for (const [nome, extrair] of FONTES) {
      if (textos[nome] === undefined) continue;
      let v;
      try { v = extrair(textos[nome], p); } catch { v = undefined; }
      if (v) { out[p] = { versao: v, fonte: nome }; break; }
    }
    if (!out[p].versao) {
      const faixa = faixaPackageJson(projeto, p);
      if (faixa) out[p] = { versao: faixa, fonte: 'package.json (faixa)' };
    }
  }
  return out;
}
