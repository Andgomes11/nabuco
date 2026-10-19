// Uso do limite do plano (Claude Pro/Max), a partir das amostras que a status line grava em limite.jsonl.
// O limite é da conta inteira: o consumo "da tarefa" é aproximado (inclui outras sessões no mesmo período).

const MIN = 60000;
export const DURACAO = { h5: 5 * 60 * MIN, sem: 7 * 24 * 60 * MIN };
export const ANTIGO = 30 * MIN; // amostra mais velha que isso: o painel avisa que o número pode estar defasado

const finito = x => typeof x === 'number' && Number.isFinite(x);
const tempo = a => { const t = Date.parse(a?.ts); return Number.isNaN(t) ? null : t; };
const valida = j => j && typeof j === 'object' && finito(j.pct) ? j : null;

// amostras válidas, em ordem de tempo
export function normalizarAmostras(amostras) {
  return (Array.isArray(amostras) ? amostras : [])
    .filter(a => a && typeof a === 'object' && tempo(a) !== null && (valida(a.h5) || valida(a.sem)))
    .map(a => ({ t: tempo(a), h5: valida(a.h5), sem: valida(a.sem) }))
    .sort((x, y) => x.t - y.t);
}

// pontos percentuais consumidos na janela `chave` desde `inicio` (ms). Soma os aumentos dentro de cada
// janela; quando a janela renova, o valor novo conta inteiro (a janela nova começou do zero).
// Sem amostra antes do início, a primeira só conta se a janela dela começou depois do início.
export function consumoDesde(amostras, inicio, chave) {
  if (!finito(inicio)) return null;
  let anterior = null, total = 0, viu = false;
  for (const a of amostras) {
    const j = a[chave];
    if (!j) continue;
    if (a.t <= inicio) { anterior = j; continue; }
    viu = true;
    if (anterior && anterior.renova === j.renova) total += Math.max(0, j.pct - anterior.pct);
    else if (anterior) total += j.pct;
    else if (finito(j.renova) && j.renova * 1000 - DURACAO[chave] >= inicio) total += j.pct;
    anterior = j;
  }
  return viu || anterior ? Math.round(total * 10) / 10 : null;
}

// janela já renovada não vale mais: o percentual dela é de um período encerrado
function atual(amostras, chave, agora) {
  for (let i = amostras.length - 1; i >= 0; i--) {
    const j = amostras[i][chave];
    if (!j) continue;
    if (finito(j.renova) && j.renova * 1000 <= agora) return null;
    return { pct: j.pct, renova: finito(j.renova) ? new Date(j.renova * 1000).toISOString() : null };
  }
  return null;
}

// o que o painel mostra; null quando não há nenhuma amostra (status line não instalada ou plano sem limite)
export function resumirLimite(amostras, { agora, inicioTarefa } = {}) {
  const lista = normalizarAmostras(amostras);
  if (!lista.length) return null;
  const ultima = lista[lista.length - 1].t;
  const inicio = Date.parse(inicioTarefa);
  return {
    atualizado: new Date(ultima).toISOString(),
    antigo: agora - ultima > ANTIGO,
    h5: atual(lista, 'h5', agora),
    sem: atual(lista, 'sem', agora),
    tarefa: Number.isNaN(inicio) ? null : { h5: consumoDesde(lista, inicio, 'h5'), sem: consumoDesde(lista, inicio, 'sem') },
  };
}
