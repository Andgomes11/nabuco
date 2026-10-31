// `nome` (padrão: o papel) é o name do agente no Claude; contratados usam `nabuco-<p>`.
// `marca` (padrão: nenhuma) é um comentário YAML logo após a primeira `---`: diz quem gerou o arquivo.
export function gerarAgenteClaude(papel, fm, corpo, cfg, { nome = papel, marca = null } = {}) {
  const linhas = ['---', ...(marca ? [marca] : []), `name: ${nome}`, `description: ${JSON.stringify(fm.descricao)}`, `model: ${cfg.model}`, `effort: ${cfg.effort}`];
  if (fm.ferramentas) linhas.push(`tools: ${fm.ferramentas}`);
  linhas.push('---', '', corpo.trimEnd(), '');
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
  l.push(`developer_instructions = ${JSON.stringify(corpo.trim())}`);
  return l.join('\n') + '\n';
}
