import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dirProjeto } from './caminhos.mjs';
import { lerJson, escreverJson } from './json.mjs';

// Fila de pedidos do projeto (.nabuco/fila.json): o Gerente executa um item por vez, cada um como uma
// tarefa normal. As funções de lista são puras (mutam só o objeto recebido); ler/gravar tocam o disco.
export const STATUS_FILA = ['pendente', 'em_andamento', 'feito', 'abandonado'];
export const RE_ID_FILA = /^f[1-9]\d{0,8}$/;

// Violação de regra da fila (item inexistente, em andamento, arquivo ilegível): quem chama decide o exit.
export class ErroFila extends Error {}

export const arquivoFila = projeto => join(dirProjeto(projeto), 'fila.json');
// `commit_por_item` e `parada` valem só para a fila em curso (fila nova volta ao padrão, veja `adicionar`).
// `parada`: null ou { motivo, desde, item } — gravada quando um item é abandonado; só sai com `retomar`.
export const filaVazia = () => ({ commit_por_item: false, parada: null, itens: [] });

// Forma mínima que a CLI garante; qualquer desvio = ilegível (nunca "conserta" sobrescrevendo).
export function validarFila(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new ErroFila('não é um objeto');
  if (!Array.isArray(d.itens)) throw new ErroFila('sem lista "itens"');
  if (d.commit_por_item !== undefined && typeof d.commit_por_item !== 'boolean') throw new ErroFila('"commit_por_item" deve ser true ou false');
  const p = d.parada;
  if (p !== undefined && p !== null) {
    if (typeof p !== 'object' || Array.isArray(p)) throw new ErroFila('"parada" deve ser null ou um objeto');
    if (typeof p.motivo !== 'string' || !p.motivo.trim()) throw new ErroFila('"parada" sem motivo');
    if (typeof p.desde !== 'string') throw new ErroFila('"parada" sem "desde"');
    if (p.item !== undefined && p.item !== null && (typeof p.item !== 'string' || !RE_ID_FILA.test(p.item))) throw new ErroFila('"parada" com item inválido');
  }
  const vistos = new Set();
  for (const [i, it] of d.itens.entries()) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new ErroFila(`item ${i + 1} não é um objeto`);
    if (typeof it.id !== 'string' || !RE_ID_FILA.test(it.id)) throw new ErroFila(`item ${i + 1} com id inválido`);
    if (vistos.has(it.id)) throw new ErroFila(`id "${it.id}" repetido`);
    vistos.add(it.id);
    if (typeof it.pedido !== 'string' || !it.pedido.trim()) throw new ErroFila(`item ${it.id} sem pedido`);
    if (!STATUS_FILA.includes(it.status)) throw new ErroFila(`item ${it.id} com status inválido "${it.status}"`);
    if (it.tarefa !== undefined && it.tarefa !== null && typeof it.tarefa !== 'string') throw new ErroFila(`item ${it.id} com tarefa inválida`);
  }
  return { ...d, commit_por_item: d.commit_por_item ?? false, parada: d.parada ?? null };
}

// Sem arquivo = fila vazia. Ilegível ou fora da forma = ErroFila (o arquivo fica como está).
export function lerFila(projeto) {
  const arq = arquivoFila(projeto);
  if (!existsSync(arq)) return filaVazia();
  let d;
  try { d = lerJson(arq); } catch (e) { throw new ErroFila(`${arq} ilegível (${e.message}); corrija ou apague o arquivo`); }
  try { return validarFila(d); } catch (e) { throw new ErroFila(`${arq} ilegível (${e.message}); corrija ou apague o arquivo`); }
}
export function gravarFila(projeto, fila) {
  mkdirSync(dirProjeto(projeto), { recursive: true });
  escreverJson(arquivoFila(projeto), fila);
}

const achar = (fila, id) => {
  const it = fila.itens.find(x => x.id === id);
  if (!it) throw new ErroFila(`item "${id}" não existe na fila`);
  return it;
};

const emCurso = fila => fila.itens.some(x => x.status === 'pendente' || x.status === 'em_andamento');

// id novo = maior número + 1 (nunca reaproveita um id que ainda está na lista). Fila sem item pendente
// nem em andamento = fila nova: commit por item e parada da fila anterior não passam para ela.
export function adicionar(fila, pedido, criado) {
  const texto = typeof pedido === 'string' ? pedido.trim() : '';
  if (!texto) throw new ErroFila('pedido vazio');
  if (!emCurso(fila)) Object.assign(fila, { commit_por_item: false, parada: null });
  const maior = Math.max(0, ...fila.itens.map(x => Number(/^f(\d+)$/.exec(x.id)?.[1] ?? 0)));
  const item = { id: `f${maior + 1}`, pedido: texto, criado, status: 'pendente', tarefa: null };
  fila.itens.push(item);
  return item;
}

export function remover(fila, id) {
  const it = achar(fila, id);
  if (it.status === 'em_andamento') throw new ErroFila(`item ${id} está em andamento (tarefa ${it.tarefa ?? '?'}); conclua ou abandone a tarefa antes`);
  fila.itens = fila.itens.filter(x => x !== it);
  return it;
}

// `para` = posição entre os pendentes (1 = próximo); os itens já iniciados ficam onde estão.
export function mover(fila, id, para) {
  const it = achar(fila, id);
  if (it.status !== 'pendente') throw new ErroFila(`item ${id} não está pendente (${it.status}); só pendentes mudam de posição`);
  const pendentes = fila.itens.filter(x => x.status === 'pendente');
  if (!Number.isInteger(para) || para < 1 || para > pendentes.length) {
    throw new ErroFila(`posição ${para} fora da fila (use de 1 a ${pendentes.length})`);
  }
  const ordem = pendentes.filter(x => x !== it);
  ordem.splice(para - 1, 0, it);
  let k = 0;
  fila.itens = fila.itens.map(x => (x.status === 'pendente' ? ordem[k++] : x));
  return it;
}

export const proximo = fila => fila.itens.find(x => x.status === 'pendente') ?? null;

// Item em andamento cuja tarefa não é a ativa (`ativa` = nome da pasta ou null): o encerramento não chegou
// à fila (ex.: gravar falhou no `abandonar`). Conta como parada até o usuário mandar retomar.
const orfaos = (fila, ativa) => fila.itens.filter(x => x.status === 'em_andamento' && x.tarefa !== ativa);

// Parada que vale agora: a gravada ou, sem ela, a de um item órfão (`desde` desconhecido: null).
export function paradaDe(fila, ativa) {
  if (fila.parada) return fila.parada;
  const o = orfaos(fila, ativa)[0];
  return o ? { motivo: `item ${o.id} ficou em andamento sem tarefa ativa`, desde: null, item: o.id } : null;
}

// Resumo para status, painel e `tarefa status`. Com `ativa` (nome ou null), a parada inclui item órfão;
// sem ela (undefined), só a gravada.
export function resumoFila(fila, ativa) {
  const p = proximo(fila);
  const andamento = fila.itens.find(x => x.status === 'em_andamento');
  return {
    pendentes: fila.itens.filter(x => x.status === 'pendente').length,
    proximo: p ? { id: p.id, pedido: p.pedido } : null,
    em_andamento: andamento ? { id: andamento.id, tarefa: andamento.tarefa ?? null } : null,
    commit_por_item: fila.commit_por_item === true,
    parada: (ativa === undefined ? fila.parada : paradaDe(fila, ativa)) ?? null,
    total: fila.itens.length,
  };
}

// Item que a tarefa `nome` está executando: `status` final ('feito' | 'abandonado'). Devolve o item ou null.
// Abandonado para a fila (`parada`): o próximo item só roda depois que o usuário mandar retomar.
export function encerrarItem(fila, nome, status, quando = new Date().toISOString()) {
  const it = fila.itens.find(x => x.status === 'em_andamento' && x.tarefa === nome);
  if (!it) return null;
  it.status = status;
  if (status === 'abandonado') fila.parada = { motivo: `item ${it.id} abandonado`, desde: quando, item: it.id };
  return it;
}

// Limpa a parada (só com pedido do usuário). Devolve se havia parada.
export function retomar(fila) {
  const havia = Boolean(fila.parada);
  fila.parada = null;
  return havia;
}

// Retomar com item órfão (veja `paradaDe`): a tarefa dele já não está ativa, então ele fecha como
// abandonado. Devolve os itens marcados.
export function abandonarOrfaos(fila, ativa) {
  const lista = orfaos(fila, ativa);
  for (const it of lista) it.status = 'abandonado';
  return lista;
}
