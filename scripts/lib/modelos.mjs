import { join } from 'node:path';
import { lerJson } from './json.mjs';

export function carregarModelos(raiz) {
  try { return lerJson(join(raiz, 'modelos.json')); } catch { return null; }
}

export function configDe(modelos, harness, papel) {
  return modelos?.[harness]?.[papel] ?? null;
}
