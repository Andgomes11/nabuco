#!/usr/bin/env node
// Fila de pedidos do projeto (.nabuco/fila.json): o Gerente executa um item por vez, cada um como uma
// tarefa normal (`tarefa.mjs nova --fila <id>`). Esta CLI só monta e consulta a fila; não cria eventos
// (eventos vão para a tarefa ativa). Saída: 0 ok, 1 regra violada, 2 uso incorreto.
import { parseArgs } from 'node:util';
import { acharProjeto, dirProjeto, ehPastaGlobal, lerAtiva } from './lib/caminhos.mjs';
import { ErroFila, RE_ID_FILA, lerFila, gravarFila, adicionar, remover, mover, proximo, retomar, paradaDe, abandonarOrfaos } from './lib/fila.mjs';

class ErroUso extends Error {}
class ErroRegra extends Error {}

const USO = 'uso: fila.mjs add --pedido="<texto>" | listar [--json] | remover --id fN | mover --id fN --para N | '
  + 'proximo [--json] | config --commit-por-item sim|nao | retomar';
const projeto = acharProjeto(process.cwd());
const [comando, ...resto] = process.argv.slice(2);

function opcoes(spec) {
  try { return parseArgs({ args: resto, options: spec, allowPositionals: false }).values; }
  catch (e) { throw new ErroUso(e.message); }
}
function idDaOpcao(id) {
  if (id === undefined) throw new ErroUso('falta --id');
  if (!RE_ID_FILA.test(id)) throw new ErroUso(`--id "${id}" inválido (use o id da fila, ex.: f1)`);
  return id;
}
// Leitura/escrita: a fila nunca vai para a pasta global do nabuco.
function exigirProjeto() {
  if (ehPastaGlobal(dirProjeto(projeto))) throw new ErroRegra('esta pasta é a pasta global do nabuco; rode dentro de um projeto');
}
const umaLinha = t => t.replace(/\s+/g, ' ').trim();
// nome da tarefa ativa (ou null): item em andamento de outra tarefa conta como parada (veja `paradaDe`)
const ativa = () => lerAtiva(projeto)?.nome ?? null;
const textoParada = p => `${p.motivo}${p.desde ? ` (desde ${p.desde})` : ''}`;
const aviso = m => console.error(`nabuco: aviso: ${m}`);
const avisarAndamento = fila => {
  for (const x of fila.itens.filter(i => i.status === 'em_andamento')) aviso(`${x.id} em andamento (tarefa ${x.tarefa ?? '?'})`);
};

const comandos = {
  add() {
    const v = opcoes({ pedido: { type: 'string' } });
    if (v.pedido === undefined) throw new ErroUso('falta --pedido');
    if (!v.pedido.trim()) throw new ErroUso('--pedido vazio');
    exigirProjeto();
    const fila = lerFila(projeto);
    const it = adicionar(fila, v.pedido, new Date().toISOString());
    gravarFila(projeto, fila);
    const pend = fila.itens.filter(x => x.status === 'pendente').length;
    console.log(`${it.id} adicionado à fila (posição ${pend} de ${pend} pendentes)`);
  },

  listar() {
    const v = opcoes({ json: { type: 'boolean' } });
    exigirProjeto();
    const fila = lerFila(projeto);
    if (v.json) { console.log(JSON.stringify(fila, null, 2)); return; }
    if (!fila.itens.length) { console.log('fila vazia'); return; }
    console.log(`Fila (commit por item: ${fila.commit_por_item ? 'sim' : 'não'})`);
    const parada = paradaDe(fila, ativa());
    if (parada) console.log(`parada: ${textoParada(parada)}`);
    let n = 0;
    for (const x of fila.itens) {
      const marca = x.status === 'pendente' ? `${++n}.` : '-';
      console.log(`${marca} ${x.id} · ${x.status.replace('_', ' ')} · ${umaLinha(x.pedido)}${x.tarefa ? ` (tarefa ${x.tarefa})` : ''}`);
    }
  },

  remover() {
    const v = opcoes({ id: { type: 'string' } });
    const id = idDaOpcao(v.id);
    exigirProjeto();
    const fila = lerFila(projeto);
    remover(fila, id);
    gravarFila(projeto, fila);
    console.log(`${id} removido da fila`);
  },

  mover() {
    const v = opcoes({ id: { type: 'string' }, para: { type: 'string' } });
    const id = idDaOpcao(v.id);
    if (v.para === undefined) throw new ErroUso('falta --para');
    if (!/^\d{1,6}$/.test(v.para)) throw new ErroUso(`--para "${v.para}" deve ser um inteiro positivo`);
    exigirProjeto();
    const fila = lerFila(projeto);
    mover(fila, id, Number(v.para));
    gravarFila(projeto, fila);
    console.log(`${id} agora é o ${v.para}º pendente`);
  },

  // Só lê: quem marca o item é `tarefa.mjs nova --fila <id>`. Fila parada não devolve item para rodar:
  // devolve a parada (e o item que viria depois, só para mostrar ao usuário).
  proximo() {
    const v = opcoes({ json: { type: 'boolean' } });
    exigirProjeto();
    const fila = lerFila(projeto);
    const it = proximo(fila);
    const pendentes = fila.itens.filter(x => x.status === 'pendente').length;
    avisarAndamento(fila);
    const parada = paradaDe(fila, ativa());
    if (parada) {
      if (v.json) { console.log(JSON.stringify({ item: null, pendentes, parada, seguinte: it }, null, 2)); return; }
      console.log(`fila parada: ${textoParada(parada)}`);
      console.log(it ? `depois dela: ${it.id}: ${umaLinha(it.pedido)} (${pendentes} pendente${pendentes === 1 ? '' : 's'})` : 'nenhum item pendente');
      console.log('pergunte ao usuário se segue; só com o ok dele rode "fila.mjs retomar"');
      return;
    }
    if (v.json) { console.log(JSON.stringify({ item: it, pendentes, parada: null }, null, 2)); return; }
    if (!it) { console.log('nenhum item pendente na fila'); return; }
    console.log(`${it.id}: ${it.pedido}`);
    console.log(`(${pendentes} pendente${pendentes === 1 ? '' : 's'}; commit por item: ${fila.commit_por_item ? 'sim' : 'não'})`);
  },

  config() {
    const v = opcoes({ 'commit-por-item': { type: 'string' } });
    const c = v['commit-por-item'];
    if (!['sim', 'nao'].includes(c)) throw new ErroUso('--commit-por-item deve ser sim ou nao');
    exigirProjeto();
    const fila = lerFila(projeto);
    fila.commit_por_item = c === 'sim';
    gravarFila(projeto, fila);
    console.log(`commit por item: ${c === 'sim' ? 'sim' : 'não'}`);
  },

  // Tira a fila do estado "parada" (só com pedido do usuário). Item em andamento sem tarefa ativa (o
  // encerramento dele não chegou à fila) fecha como abandonado.
  retomar() {
    opcoes({});
    exigirProjeto();
    const fila = lerFila(projeto);
    const orfaos = abandonarOrfaos(fila, ativa());
    if (!retomar(fila) && !orfaos.length) { console.log('a fila não estava parada'); return; }
    gravarFila(projeto, fila);
    for (const it of orfaos) console.log(`${it.id} estava em andamento sem tarefa ativa (tarefa ${it.tarefa ?? '?'}): marcado como abandonado`);
    console.log('fila retomada');
  },
};

try {
  if (!Object.hasOwn(comandos, comando ?? '')) {
    throw new ErroUso(comando ? `comando desconhecido "${comando}"` : 'falta o comando (add, listar, remover, mover, proximo, config ou retomar)');
  }
  comandos[comando]();
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  if (e instanceof ErroUso) console.error(USO);
  process.exit(e instanceof ErroUso ? 2 : 1);
}
