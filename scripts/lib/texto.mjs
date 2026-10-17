const STOPWORDS = new Set(['para', 'com', 'que', 'nao', 'uma', 'por', 'dos', 'das', 'the', 'and', 'for', 'with', 'from']);
const TRANSITORIO = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|rate.?limit|429|503|token (expirado|expired|inválido|invalid)|command not found|não é reconhecido|is not recognized|ENOENT.*(node|npm|git)\b/i;

export function tokenizar(s) {
  const base = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return base.split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

export function similaridade(a, b) {
  const A = new Set(tokenizar(a)), B = new Set(tokenizar(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function ehTransitorio(s) {
  return TRANSITORIO.test(String(s ?? ''));
}

export function slugify(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
}
