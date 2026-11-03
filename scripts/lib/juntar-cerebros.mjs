// Junta o cérebro desta máquina (~/.nabuco com commits próprios) a um remoto criado em outra máquina,
// quando os dois não têm ancestral comum. O remoto nunca muda: quem se ajusta é o lado local.
//   1. preparar (commit "sync: junta cérebro de outra máquina"): lições locais com ID que já existe no
//      remoto ganham o próximo número livre; o histórico local e as referências acompanham; casos com o
//      mesmo caminho e conteúdo diferente ganham sufixo (-2, -3…) e as evidências acompanham.
//   2. merge --allow-unrelated-histories; .gitignore/.gitattributes viram a união das linhas e os
//      arquivos de lições a união dos blocos (mais o texto livre local, no fim).
//   3. sobrou conflito em outro arquivo (ou algo falhou no meio): merge --abort e o ~/.nabuco volta.
// Lições de escopo projeto não moram no cérebro e não mudam; seus IDs (vistos nos históricos) ficam
// reservados para a renumeração não colidir com eles.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { lerLicoes, proximoId, acrescentarBloco } from './licoes.mjs';
import { IGNORAR, ATRIBUTOS, normalizarFimDeLinha } from '../sincronizar.mjs';

export const MENSAGEM_PREPARO = 'sync: junta cérebro de outra máquina';
const ARQ_LICOES = /^licoes\/(?:arquivo\/)?([a-z]+)\.md$/;
const ID_LICAO = /^[a-z]+-\d{4,}$/;
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const semCr = t => t.replace(/\r\n/g, '\n');

// caminho -> objeto (blob) de uma árvore
function arvore(git, ref) {
  const r = git(['ls-tree', '-r', '-z', ref]);
  const mapa = new Map();
  if (r.status !== 0) return mapa;
  for (const e of r.stdout.split('\0')) {
    const tab = e.indexOf('\t');
    if (tab < 0) continue;
    const [, tipo, obj] = e.slice(0, tab).split(' ');
    if (tipo === 'blob') mapa.set(e.slice(tab + 1), obj);
  }
  return mapa;
}

function mostrar(git, espec) {
  const r = git(['show', espec]);
  return r.status === 0 ? semCr(r.stdout) : null;
}

const lerLocal = (home, rel) => (existsSync(join(home, rel)) ? readFileSync(join(home, rel), 'utf8') : '');
const comparavel = b => semCr(b.bruto).trimEnd();

function eventos(texto) {
  const saida = [];
  for (const linha of String(texto ?? '').split('\n')) {
    try {
      const e = JSON.parse(linha);
      if (e && typeof e === 'object' && e.dados && typeof e.dados === 'object') saida.push(e);
    } catch { /* linha que não é evento */ }
  }
  return saida;
}

// todo ID de lição citado num histórico (inclusive as de escopo projeto, que não estão no cérebro)
function idsDoHistorico(texto) {
  const ids = new Set();
  const por = x => { if (typeof x === 'string' && ID_LICAO.test(x)) ids.add(x); };
  for (const { tipo, dados: d } of eventos(texto)) {
    if (typeof tipo === 'string' && tipo.startsWith('licao_')) { por(d.id); por(d.id_anterior); }
    if (tipo === 'licoes_entregues' && Array.isArray(d.ids)) d.ids.forEach(por);
    if (tipo === 'caso_criado') por(d.recorrencia_de);
  }
  return ids;
}

// Junção que não dá para fazer sem arriscar apontar errado: vira conflito (e o ~/.nabuco volta).
export class ConflitoDeJuncao extends Error {
  constructor(conflitos) { super(conflitos.join('; ')); this.conflitos = conflitos; }
}

// Blocos locais (ativos ou arquivados) com ID que já existe no remoto, com outro conteúdo: cada um ganha
// o próximo número livre, mesmo que dois blocos locais tenham o mesmo ID. Cada bloco leva o escopo
// (o arquivo ativo do cérebro é global; o arquivo morto guarda também lições de projeto aposentadas,
// com "escopo: projeto") e, se for de projeto, o projeto que a aposentou — é isso que decide quais
// eventos do histórico são dele.
function renumerar(home, git, ref, remotos, locais) {
  const papeis = new Set();
  for (const rel of [...remotos.keys(), ...locais.keys()]) {
    const m = rel.match(ARQ_LICOES);
    if (m) papeis.add(m[1]);
  }
  const histLocal = lerLocal(home, 'historico.jsonl');
  const reservados = [...idsDoHistorico(histLocal), ...idsDoHistorico(mostrar(git, `${ref}:historico.jsonl`))].map(id => `## ${id}\n`);
  const aposentadasDeProjeto = eventos(histLocal).filter(e => e.tipo === 'licao_aposentada' && e.dados.escopo === 'projeto');
  const blocos = [];
  const conflitos = [];
  for (const papel of [...papeis].sort()) {
    const rels = [`licoes/${papel}.md`, `licoes/arquivo/${papel}.md`];
    const textoRemoto = rels.map(rel => (remotos.has(rel) ? mostrar(git, `${ref}:${rel}`) ?? '' : ''));
    const textoLocal = rels.map(rel => lerLocal(home, rel));
    const doRemoto = textoRemoto.map(t => new Map(lerLicoes(t).blocos.map(b => [b.id, comparavel(b)])));
    const idsRemotos = new Set(doRemoto.flatMap(m => [...m.keys()]));
    const usados = [...textoRemoto, ...textoLocal, ...reservados];
    textoLocal.forEach((t, i) => {
      lerLicoes(t).blocos.forEach((b, indice) => {
        if (!idsRemotos.has(b.id)) return;
        if (doRemoto[i].get(b.id) === comparavel(b)) return; // a mesma lição nos dois lados
        const escopo = i === 1 && b.escopo === 'projeto' ? 'projeto' : 'global';
        let projeto = null;
        if (escopo === 'projeto') {
          const projetos = [...new Set(aposentadasDeProjeto.filter(e => e.dados.id === b.id).map(e => e.projeto ?? ''))];
          if (projetos.length > 1) conflitos.push(`${rels[i]} (${b.id} de escopo projeto foi aposentada em mais de um projeto: ${projetos.join(' e ')}; não dá para saber de qual é o bloco)`);
          projeto = projetos[0] ?? null;
        }
        const novo = proximoId(papel, usados);
        usados.push(`## ${novo}\n`);
        blocos.push({ rel: rels[i], indice, id: b.id, escopo, projeto, novo });
      });
    });
  }
  // Abordagem conservadora: a junção não segue a identidade de uma lição entre escopos. Se o histórico
  // local mostra que o ID de um bloco a renumerar mudou de escopo (em qualquer projeto), ou se um bloco
  // de projeto aposentado não diz de qual projeto é mas há eventos com o ID dele, não há como trocar
  // os eventos certos: vira conflito.
  const evLocais = eventos(histLocal);
  for (const x of blocos) {
    const mudancas = evLocais.filter(e => e.tipo === 'licao_editada' && Array.isArray(e.dados.campos) && e.dados.campos.includes('escopo')
      && (e.dados.id === x.id || e.dados.id_anterior === x.id));
    if (mudancas.length) {
      const onde = [...new Set(mudancas.map(e => e.projeto ?? '?'))].join(' e ');
      conflitos.push(`${x.rel} (${x.id} mudou de escopo no histórico desta máquina, no projeto ${onde}; a junção não segue a lição entre escopos)`);
    }
    if (x.escopo === 'projeto' && x.projeto === null && evLocais.some(e => idsDoHistorico(JSON.stringify(e)).has(x.id))) {
      conflitos.push(`${x.rel} (${x.id} é de escopo projeto, aposentada sem registro do projeto no histórico, e há eventos com esse ID; não dá para saber quais são dela)`);
    }
  }
  // dois blocos com o mesmo ID, escopo e projeto: o histórico não diz qual evento é de qual
  const vistos = new Map();
  for (const x of blocos) {
    const k = `${x.id}\0${x.escopo}\0${x.projeto}`;
    if (vistos.has(k)) conflitos.push(`${x.rel} (${x.id} aparece em mais de um bloco ${x.escopo === 'projeto' ? 'de projeto' : 'global'}; não dá para saber de qual são os eventos)`);
    vistos.set(k, x);
  }
  if (conflitos.length) throw new ConflitoDeJuncao([...new Set(conflitos)]);
  return blocos;
}

const rotulo = x => (x.escopo === 'projeto' ? `${x.id} (projeto${x.projeto ? ` ${x.projeto}` : ''})` : x.id);

// casos com o mesmo caminho e conteúdo diferente: o local ganha o primeiro sufixo livre
function renomearCasos(remotos, locais) {
  const mapa = new Map();
  const ocupados = new Set([...remotos.keys(), ...locais.keys()]);
  for (const [rel, obj] of locais) {
    if (!rel.startsWith('casos/') || !remotos.has(rel) || remotos.get(rel) === obj) continue;
    const base = rel.replace(/\.md$/, '');
    const ext = rel.slice(base.length);
    let novo;
    for (let i = 2; ocupados.has(novo = `${base}-${i}${ext}`); i++);
    ocupados.add(novo);
    mapa.set(rel, novo);
  }
  return mapa;
}

// Reescreve no histórico local os IDs dos blocos renumerados. O escopo de cada (projeto, ID) é
// acompanhado em ordem: licao_criada/licao_aposentada trazem dados.escopo e uma licao_editada com
// "escopo" em campos é uma mudança de escopo (troca global <-> projeto). Um evento é trocado só quando
// bate com um bloco renumerado: escopo projeto -> o bloco de projeto aposentado por aquele mesmo projeto;
// global (ou sem escopo conhecido: a lição existe no cérebro) -> o bloco global. Lição de projeto que
// não está no cérebro nunca muda. Devolve também, por caso (caminho original), a troca do
// recorrencia_de do caso_criado dele, para a linha "recorrência de:" do arquivo seguir a mesma decisão.
function reescreverHistorico(texto, blocos, casos) {
  const escopo = new Map();
  const recorrencias = new Map();
  const chave = (e, id) => `${e.projeto ?? ''}\0${id}`;
  const trocar = (e, id, esc = escopo.get(chave(e, id))) => {
    if (typeof id !== 'string') return id;
    const alvo = esc === 'projeto'
      ? blocos.find(x => x.id === id && x.escopo === 'projeto' && x.projeto === (e.projeto ?? ''))
      : blocos.find(x => x.id === id && x.escopo === 'global');
    return alvo ? alvo.novo : id;
  };
  const saida = texto.split('\n').map(linha => {
    let e;
    try { e = JSON.parse(linha); } catch { return linha; }
    const d = e?.dados;
    if (!d || typeof d !== 'object') return linha;
    const antes = JSON.stringify(d);
    const tipo = typeof e.tipo === 'string' ? e.tipo : '';
    if (tipo.startsWith('licao_')) {
      const id = d.id;
      if ((tipo === 'licao_criada' || tipo === 'licao_aposentada') && typeof d.escopo === 'string') escopo.set(chave(e, id), d.escopo);
      if (tipo === 'licao_editada' && Array.isArray(d.campos) && d.campos.includes('escopo')) {
        const origem = d.id_anterior ?? id;
        const anterior = escopo.get(chave(e, origem));
        if ('id_anterior' in d) d.id_anterior = trocar(e, d.id_anterior, anterior);
        escopo.delete(chave(e, origem));
        if (anterior) escopo.set(chave(e, id), anterior === 'projeto' ? 'global' : 'projeto');
      }
      if ('id' in d) d.id = trocar(e, id);
    }
    if (tipo === 'licoes_entregues' && Array.isArray(d.ids)) d.ids = d.ids.map(id => trocar(e, id));
    if (tipo === 'caso_criado') {
      const original = d.arquivo;
      if ('recorrencia_de' in d) {
        const novo = trocar(e, d.recorrencia_de);
        if (novo !== d.recorrencia_de && typeof original === 'string') recorrencias.set(original, { de: d.recorrencia_de, para: novo });
        d.recorrencia_de = novo;
      }
      if (typeof original === 'string' && casos.has(original)) d.arquivo = casos.get(original);
    }
    if (JSON.stringify(d) === antes) return linha;
    return JSON.stringify(e) + (linha.endsWith('\r') ? '\r' : '');
  }).join('\n');
  return { texto: saida, recorrencias };
}

// troca o ID no título dos blocos indicados (por posição no arquivo: dois blocos podem ter o mesmo ID)
function renomearBlocos(texto, trocas) {
  if (!trocas.length) return texto;
  let saida = '', pos = 0;
  lerLicoes(texto).blocos.forEach((b, i) => {
    const k = texto.indexOf(b.bruto, pos);
    if (k < 0) return;
    const t = trocas.find(x => x.indice === i);
    saida += texto.slice(pos, k) + (t ? b.bruto.replace(new RegExp(`^(##\\s+)${escapar(b.id)}(?![\\w-])`), (_, p) => p + t.novo) : b.bruto);
    pos = k + b.bruto.length;
  });
  return saida + texto.slice(pos);
}

function gravarSeMudou(arq, antes, depois) {
  if (depois !== antes) writeFileSync(arq, depois);
}

// Passo 1, só leitura: as trocas a fazer (blocos renumerados; casos: Map antigo -> novo).
// Lança ConflitoDeJuncao se alguma lição não dá para renumerar com segurança.
export function planejarJuncao(home, git, ref = 'origin/main') {
  const remotos = arvore(git, ref);
  const locais = arvore(git, 'HEAD');
  return { locais, blocos: renumerar(home, git, ref, remotos, locais), casos: renomearCasos(remotos, locais) };
}

// Passo 1, aplicação: grava as trocas do plano e commita se houve alguma.
export function aplicarJuncao(home, git, { locais, blocos, casos }) {
  if (!blocos.length && !casos.size) return;
  for (const [antigo, novo] of casos) {
    mkdirSync(dirname(join(home, novo)), { recursive: true });
    renameSync(join(home, antigo), join(home, novo));
  }
  // o histórico primeiro: a linha "recorrência de:" de cada caso segue a decisão do caso_criado dele
  let recorrencias = new Map();
  const arqHist = join(home, 'historico.jsonl');
  if (locais.has('historico.jsonl') && existsSync(arqHist)) {
    const texto = readFileSync(arqHist, 'utf8');
    const r = reescreverHistorico(texto, blocos, casos);
    gravarSeMudou(arqHist, texto, r.texto);
    recorrencias = r.recorrencias;
  }
  const novoCaminho = rel => casos.get(rel) ?? rel;
  for (const rel of locais.keys()) {
    const arq = join(home, novoCaminho(rel));
    if (!existsSync(arq)) continue;
    const texto = readFileSync(arq, 'utf8');
    if (ARQ_LICOES.test(rel)) {
      // o ID no título de cada bloco renumerado e os caminhos dos casos renomeados nas evidências
      let novo = renomearBlocos(texto, blocos.filter(x => x.rel === rel));
      novo = novo.replace(/^(- evidência:.*)$/gm, l => [...casos].reduce((acc, [a, n]) => acc.replace(new RegExp(`${escapar(a)}(?![\\w-])`, 'g'), n), l));
      gravarSeMudou(arq, texto, novo);
    } else if (rel.startsWith('casos/') && recorrencias.has(rel)) {
      const { de, para } = recorrencias.get(rel);
      gravarSeMudou(arq, texto, texto.replace(/^(recorrência de:.*)$/gm, l => l.replace(new RegExp(`${escapar(de)}(?![\\w-])`), para)));
    }
  }
  git(['add', '-A']);
  if (git(['diff', '--cached', '--quiet']).status === 1) {
    const c = git(['commit', '-q', '-m', MENSAGEM_PREPARO]);
    if (c.status !== 0) throw new Error(`commit da preparação falhou: ${(c.stderr || c.stdout || '').trim()}`);
  }
}

function uniaoDeLinhas(nossas, deles, garantir) {
  const saida = [];
  const vistas = new Set();
  for (const l of [...(nossas ?? '').split('\n'), ...(deles ?? '').split('\n'), ...garantir]) {
    const t = l.trim();
    if (!t || vistas.has(t)) continue;
    vistas.add(t);
    saida.push(l.trimEnd());
  }
  return saida.join('\n') + '\n';
}

// texto de um arquivo de lições fora dos blocos, sem o cabeçalho padrão "# Lições — <papel>"
function textoLivre(papel, texto) {
  let resto = semCr(texto ?? '');
  for (const b of lerLicoes(resto).blocos) resto = resto.replace(b.bruto, '\n');
  resto = resto.replace(/^﻿/, '').replace(new RegExp(`^\\s*# Lições — ${escapar(papel)}[ \\t]*(?:\\n|$)`), '');
  return resto.replace(/\n{3,}/g, '\n\n').trim();
}

// remoto como está + os blocos locais que ele não tem + o texto livre local que ele não tem (no fim)
function uniaoDeLicoes(papel, nossas, deles) {
  if (deles == null) return nossas ?? '';
  const idsDeles = new Set(lerLicoes(deles).blocos.map(b => b.id));
  let texto = deles;
  for (const b of lerLicoes(nossas ?? '').blocos) {
    if (idsDeles.has(b.id) || !ID_LICAO.test(b.id)) continue;
    texto = acrescentarBloco(texto, papel, b.bruto);
  }
  const livre = textoLivre(papel, nossas);
  if (livre && !semCr(deles).includes(livre)) texto = texto.replace(/\s*$/, '') + '\n\n' + livre + '\n';
  return texto;
}

const emConflito = git => git(['diff', '--name-only', '--diff-filter=U', '-z']).stdout.split('\0').filter(Boolean);

// Passo 2 (depois do merge com conflito): resolve os arquivos conhecidos; devolve os que sobram.
export function resolverConflitos(home, git) {
  const sobra = [];
  for (const rel of emConflito(git)) {
    const nossas = mostrar(git, `:2:${rel}`);
    const deles = mostrar(git, `:3:${rel}`);
    let txt = null;
    if (rel === '.gitignore') txt = uniaoDeLinhas(nossas, deles, IGNORAR);
    else if (rel === '.gitattributes') txt = uniaoDeLinhas(nossas, deles, ATRIBUTOS);
    else if (rel === 'historico.jsonl') txt = uniaoDeLinhas(nossas, deles, []);
    else if (ARQ_LICOES.test(rel)) txt = uniaoDeLicoes(rel.match(ARQ_LICOES)[1], nossas, deles);
    if (txt === null) { sobra.push(rel); continue; }
    writeFileSync(join(home, rel), txt);
    git(['add', '--', rel]);
  }
  return sobra;
}

// Tudo junto. { ok: true, licoes, casos } ou { ok: false, conflitos, erro } com o ~/.nabuco de volta:
// no HEAD de quando a junção começou ou, com `alvo` (o HEAD de antes do setup), nesse commit — o que foi
// commitado depois dele volta a ser alteração pendente no disco, nunca apagado.
export function juntarCerebros(home, git, { ref = 'origin/main', alvo = null } = {}) {
  const inicio = git(['rev-parse', 'HEAD']).stdout.trim();
  let plano = null;
  const voltar = (conflitos, erro) => {
    const passo = f => { try { f(); } catch { /* volta o máximo possível */ } };
    passo(() => { if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0) git(['merge', '--abort']); });
    passo(() => git(['reset', '-q', '--hard', inicio]));
    // caso renomeado antes do commit da preparação fica fora do índice: o reset não o tira
    for (const novo of plano?.casos.values() ?? []) {
      passo(() => { if (!plano.locais.has(novo)) rmSync(join(home, novo), { force: true }); });
    }
    if (alvo && alvo !== inicio) passo(() => git(['reset', '-q', '--mixed', alvo]));
    return { ok: false, conflitos, erro };
  };
  const texto = r => (r?.error?.message || r?.stderr || r?.stdout || '').trim();
  try {
    plano = planejarJuncao(home, git, ref);
    aplicarJuncao(home, git, plano);
    const m = git(['merge', '-q', '--no-edit', '--allow-unrelated-histories', ref]);
    if (m.status !== 0) {
      if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status !== 0) return voltar([], texto(m));
      const sobra = resolverConflitos(home, git);
      if (sobra.length) return voltar(sobra, texto(m));
      const c = git(['commit', '-q', '--no-edit']);
      if (c.status !== 0) return voltar(emConflito(git), texto(c));
    }
    normalizarFimDeLinha(home, git);
    return { ok: true, licoes: plano.blocos.map(x => [rotulo(x), x.novo]), casos: [...plano.casos] };
  } catch (e) {
    if (e instanceof ConflitoDeJuncao) return voltar(e.conflitos, e.message);
    return voltar([], `falha inesperada ao juntar os cérebros (${e.message}); nada foi mudado`);
  }
}
