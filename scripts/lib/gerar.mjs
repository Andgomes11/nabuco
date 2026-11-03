import { readFileSync } from 'node:fs';

// Regras comuns a todo agente gerado (embutidos e contratados). Lidas relativas a este módulo para
// valer também no plugin instalado; papeis/comum/ não é um papel (construir só lê papeis/*.md).
export const REGRAS_DO_TIME = readFileSync(new URL('../../papeis/comum/regras-do-time.md', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n').trim();

// Corpo com as regras antes da seção Entrega (o mesmo título que time.mjs exige dos contratados) ou no fim.
export function comRegras(corpo) {
  const e = /^#{1,6}[ \t]+Entrega\b/im.exec(corpo);
  if (!e) return corpo.trimEnd() + '\n\n' + REGRAS_DO_TIME + '\n';
  return corpo.slice(0, e.index) + REGRAS_DO_TIME + '\n\n' + corpo.slice(e.index);
}

// `nome` (padrão: o papel) é o name do agente no Claude; contratados usam `nabuco-<p>`.
// `marca` (padrão: nenhuma) é um comentário YAML logo após a primeira `---`: diz quem gerou o arquivo.
export function gerarAgenteClaude(papel, fm, corpo, cfg, { nome = papel, marca = null } = {}) {
  const linhas = ['---', ...(marca ? [marca] : []), `name: ${nome}`, `description: ${JSON.stringify(fm.descricao)}`, `model: ${cfg.model}`, `effort: ${cfg.effort}`];
  if (fm.ferramentas) linhas.push(`tools: ${fm.ferramentas}`);
  linhas.push('---', '', comRegras(corpo).trimEnd(), '');
  return linhas.join('\n');
}

// Strings JSON são strings básicas TOML válidas (mesmas regras de escape).
// `origem` vai no cabeçalho: de onde o arquivo foi gerado.
export function gerarAgenteCodex(papel, fm, corpo, cfg, { origem = `build.mjs a partir de papeis/${papel}.md` } = {}) {
  const l = [
    `# GERADO por ${origem} — não edite à mão.`,
    `name = ${JSON.stringify('nabuco-' + papel)}`,
    `description = ${JSON.stringify(fm.descricao)}`,
  ];
  if (cfg.model) l.push(`model = ${JSON.stringify(cfg.model)}`);
  l.push(`model_reasoning_effort = ${JSON.stringify(cfg.effort)}`);
  l.push(`developer_instructions = ${JSON.stringify(comRegras(corpo).trim())}`);
  return l.join('\n') + '\n';
}
