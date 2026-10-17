export function gerarAgenteClaude(papel, fm, corpo, cfg) {
  const linhas = ['---', `name: ${papel}`, `description: ${JSON.stringify(fm.descricao)}`, `model: ${cfg.model}`, `effort: ${cfg.effort}`];
  if (fm.ferramentas) linhas.push(`tools: ${fm.ferramentas}`);
  linhas.push('---', '', corpo.trimEnd(), '');
  return linhas.join('\n');
}

// Strings JSON são strings básicas TOML válidas (mesmas regras de escape).
export function gerarAgenteCodex(papel, fm, corpo, cfg) {
  const l = [
    `# GERADO por build.mjs a partir de papeis/${papel}.md — não edite à mão.`,
    `name = ${JSON.stringify('nabuco-' + papel)}`,
    `description = ${JSON.stringify(fm.descricao)}`,
  ];
  if (cfg.model) l.push(`model = ${JSON.stringify(cfg.model)}`);
  l.push(`model_reasoning_effort = ${JSON.stringify(cfg.effort)}`);
  l.push(`developer_instructions = ${JSON.stringify(corpo.trim())}`);
  return l.join('\n') + '\n';
}
