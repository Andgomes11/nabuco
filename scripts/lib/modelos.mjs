import { join } from 'node:path';
import { lerJson } from './json.mjs';
import { nabucoHome } from './caminhos.mjs';
import { contratados } from './time.mjs';

export function carregarModelos(raiz) {
  try { return lerJson(join(raiz, 'modelos.json')); } catch { return null; }
}

// Modelos do plugin + os dos funcionários contratados (~/.nabuco/time). Contratado nunca
// substitui embutido: `contratados` já recusa nomes reservados.
export function carregarModelosTodos(raiz, home = nabucoHome()) {
  const plugin = carregarModelos(raiz);
  const cs = contratados(home);
  if (!cs.length) return plugin;
  const m = { claude: { ...plugin?.claude }, codex: { ...plugin?.codex } };
  for (const c of cs) { m.claude[c.papel] = c.claude; m.codex[c.papel] = c.codex; }
  return m;
}

export function configDe(modelos, harness, papel) {
  return modelos?.[harness]?.[papel] ?? null;
}
