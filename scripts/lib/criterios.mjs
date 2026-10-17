export function pendencias(criterios) {
  const lista = Array.isArray(criterios?.criterios) ? criterios.criterios : null;
  if (!lista) return [{ id: '-', motivo: 'criterios.json sem lista "criterios"' }];
  if (lista.length === 0) return [{ id: '-', motivo: 'nenhum critério definido' }];
  const out = [];
  for (const c of lista) {
    if (c.status !== 'passou') out.push({ id: c.id, motivo: `status "${c.status ?? 'pendente'}"` });
    else if (!c.evidencia || !String(c.evidencia).trim()) out.push({ id: c.id, motivo: 'passou sem evidência registrada' });
  }
  return out;
}
