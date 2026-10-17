import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { nabucoHome, dirProjeto, ehPastaGlobal } from './caminhos.mjs';
import { PAPEIS_CEREBRO } from './constantes.mjs';
import { lerLicoes, substituirBloco } from './licoes.mjs';

export const ESCOPOS = ['global', 'projeto'];

export const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local

// Escopo projeto sem projeto de verdade (a "pasta do projeto" é a pasta global, ex.: cwd = ~) => null:
// senão o arquivo do projeto seria o próprio arquivo global e a lição apareceria (e sumiria) duas vezes.
export function semProjeto(projeto) { return ehPastaGlobal(dirProjeto(projeto)); }
export function arquivoLicoes(escopo, papel, projeto) {
  if (escopo === 'projeto' && semProjeto(projeto)) return null;
  const base = escopo === 'projeto' ? dirProjeto(projeto) : nabucoHome();
  return join(base, 'licoes', `${papel}.md`);
}
export function arquivoMorto(papel) {
  return join(nabucoHome(), 'licoes', 'arquivo', `${papel}.md`);
}

export function lerArquivo(arq) {
  return arq && existsSync(arq) ? readFileSync(arq, 'utf8') : '';
}
export function gravarArquivo(arq, texto) {
  mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq, texto);
}

// Blocos de um papel num escopo, com o escopo real (o do arquivo) sobrescrevendo o declarado.
export function blocosDe(escopo, papel, projeto) {
  const arq = arquivoLicoes(escopo, papel, projeto);
  if (!arq) return [];
  return lerLicoes(lerArquivo(arq)).blocos.map(b => ({ ...b, escopo }));
}
export const ativas = blocos => blocos.filter(b => !b.regra);

export const papelDoId = id => String(id ?? '').match(/^([a-z]+)-\d+$/)?.[1] ?? null;

// Procura a lição primeiro no projeto, depois no global. null se não existir.
export function acharLicao(id, projeto) {
  const papel = papelDoId(id);
  if (!papel || !PAPEIS_CEREBRO.includes(papel)) return null;
  for (const escopo of ['projeto', 'global']) {
    const arquivo = arquivoLicoes(escopo, papel, projeto);
    if (!arquivo) continue;
    const texto = lerArquivo(arquivo);
    const bloco = lerLicoes(texto).blocos.find(b => b.id === id);
    if (bloco) return { papel, escopo, arquivo, texto, bloco };
  }
  return null;
}

// Texto serializado do bloco `novo` preservando as linhas livres que o usuário pôs no bloco original.
export function blocoComExtras(original, novo) {
  return substituirBloco(original.bruto, original.id, novo);
}

// Lista de evidências que sobrevive ao parse: se algum item é link markdown (ou tem vírgula/·),
// todos viram links, porque o parser só lê links quando há algum.
const ehLink = s => /^\[[^\]]*\]\([^)]*\)$/.test(s);
export function normalizarEvidencia(lista) {
  const itens = lista.map(s => String(s).trim()).filter(Boolean);
  if (!itens.some(s => ehLink(s) || /,|·/.test(s))) return itens;
  const alvo = s => s.replace(/[()\s]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  return itens.map(s => (ehLink(s) ? s : `[${s.replace(/[[\]]/g, '')}](${alvo(s)})`));
}
