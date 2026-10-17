export function parseFrontmatter(texto) {
  const t = texto.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { dados: {}, corpo: t };
  const fim = t.indexOf('\n---', 3);
  if (fim === -1) throw new Error('frontmatter sem fechamento (---)');
  const bloco = t.slice(4, fim);
  const corpo = t.slice(fim + 4).replace(/^\n/, '');
  const dados = {};
  for (const linha of bloco.split('\n')) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf(':');
    if (i === -1) throw new Error(`linha inválida no frontmatter: "${linha}"`);
    dados[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return { dados, corpo };
}
