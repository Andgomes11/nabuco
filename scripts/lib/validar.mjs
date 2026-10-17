export const MODELOS_CLAUDE = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
export const EFFORTS_CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORTS_CODEX = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const FERRAMENTAS_CLAUDE = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill'];

export function validarModelos(modelos, papeis) {
  const erros = [];
  for (const h of ['claude', 'codex']) {
    const sec = modelos?.[h];
    if (!sec || typeof sec !== 'object') { erros.push(`modelos.json: falta a seção "${h}"`); continue; }
    for (const p of papeis) {
      const c = sec[p];
      if (!c) { erros.push(`${h}.${p}: papel sem configuração`); continue; }
      if (h === 'claude' && !(MODELOS_CLAUDE.includes(c.model) || /^claude-[a-z0-9.-]+$/.test(c.model ?? ''))) {
        erros.push(`claude.${p}.model inválido: "${c.model}" (use ${MODELOS_CLAUDE.join(', ')} ou um ID claude-*)`);
      }
      if (h === 'codex' && c.model !== null && (typeof c.model !== 'string' || !c.model.trim())) {
        erros.push(`codex.${p}.model inválido: use null para herdar da sessão ou o nome de um modelo`);
      }
      const ef = h === 'claude' ? EFFORTS_CLAUDE : EFFORTS_CODEX;
      if (!ef.includes(c.effort)) erros.push(`${h}.${p}.effort inválido: "${c.effort}" (use ${ef.join(', ')})`);
    }
    for (const extra of Object.keys(sec)) {
      if (!papeis.includes(extra)) erros.push(`${h}.${extra}: papel desconhecido (não existe papeis/${extra}.md)`);
    }
  }
  return erros;
}

export function validarPapel(papel, fm) {
  const erros = [];
  if (!fm.nome) erros.push(`papeis/${papel}.md: falta "nome"`);
  if (!fm.descricao) erros.push(`papeis/${papel}.md: falta "descricao"`);
  if (fm.ferramentas) {
    for (const f of fm.ferramentas.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!FERRAMENTAS_CLAUDE.includes(f)) erros.push(`papeis/${papel}.md: ferramenta desconhecida "${f}"`);
    }
  }
  return erros;
}
