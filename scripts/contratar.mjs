#!/usr/bin/env node
// Contratar: cria, lista, (re)instala e remove funcionários do usuário (registro em ~/.nabuco/time/),
// instalados como `nabuco-<p>` em <CLAUDE_CONFIG_DIR|~/.claude>/agents e <CODEX_HOME|~/.codex>/agents.
// Nunca sobrescreve agente que não seja do registro. Saída: 0 ok, 1 regra, 2 uso incorreto.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { nabucoHome } from './lib/caminhos.mjs';
import { lerJson, escreverJson } from './lib/json.mjs';
import { commitHome } from './lib/git.mjs';
import { gravarArquivo } from './lib/repositorio-licoes.mjs';
import {
  validarContratacao, erroPapel, papelValido, lerTime, lerModelosTime, registroMd, gerarArquivos, heranca, destinos,
  arquivoRegistro, arquivoModelosTime, codexHome, agenteEhNosso, gravarAgente, apagarArquivo,
} from './lib/time.mjs';

class ErroUso extends Error {}
class ErroRegra extends Error {}

const USO = 'uso: contratar.mjs validar --de <json> [--codex auto|sim|nao] | novo --de <json> [--codex auto|sim|nao] | '
  + 'listar [--json] | instalar [--papel p] [--codex auto|sim|nao] | remover --papel p';
const home = nabucoHome();
const [comando, ...resto] = process.argv.slice(2);
const aviso = m => console.error(`nabuco: aviso: ${m}`);

function opcoes(spec) {
  try { return parseArgs({ args: resto, options: spec, allowPositionals: false }).values; }
  catch (e) { throw new ErroUso(e.message); }
}
function modoCodex(v) {
  if (!['auto', 'sim', 'nao'].includes(v)) throw new ErroUso('--codex deve ser auto, sim ou nao');
  return v === 'sim' || (v === 'auto' && existsSync(codexHome()));
}
// Slug malformado é erro de uso (2) e é checado antes de virar caminho.
function papelDaOpcao(p) {
  if (p === undefined) throw new ErroUso('falta --papel');
  if (!papelValido(p)) throw new ErroUso(erroPapel(p));
  const e = erroPapel(p);
  if (e) throw new ErroRegra(`${e}; não é um contratado`);
  return p;
}
function lerContratacao(arq) {
  if (!arq) throw new ErroUso('falta --de <arquivo.json>');
  let d;
  try { d = lerJson(arq); }
  catch (e) { throw new ErroUso(`não foi possível ler --de "${arq}": ${e.message}`); }
  const { erros, dados } = validarContratacao(d);
  if (erros.length) throw new ErroRegra('contratação inválida:\n' + erros.map(e => `  - ${e}`).join('\n'));
  return dados;
}
// O que impede `novo` de gravar: papel já registrado, agente alheio no destino, modelos.json ilegível.
function impedimentos(dados) {
  const erros = [];
  const p = dados.papel;
  if (existsSync(arquivoRegistro(home, p))) {
    erros.push(`"${p}" já está contratado; para mudar, edite ${arquivoRegistro(home, p)} e rode "contratar instalar --papel ${p}"`);
  }
  // Os dois destinos, mesmo sem instalar no Codex agora: um toml alheio bloquearia o instalar futuro.
  for (const arq of Object.values(destinos(p))) {
    if (existsSync(arq)) erros.push(`já existe ${arq} e não é do registro do nabuco; não sobrescrevo (escolha outro papel)`);
  }
  const lm = lerModelosTime(home);
  if (lm.erro) erros.push(`${arquivoModelosTime(home)} ilegível (${lm.erro}); corrija antes de contratar`);
  return erros;
}

// Instala os dois agentes de um contratado. Devolve { linha, ok }; nunca lança.
// Agente sem a marca do contratar (do usuário, mesmo com registro presente) nunca é sobrescrito.
function instalarUm(dados, codex) {
  const dst = destinos(dados.papel);
  const g = gerarArquivos(dados);
  const partes = [];
  let ok = true;
  for (const [h, nome, pasta] of [['claude', 'Claude', 'do Claude'], ['codex', 'Codex', 'do Codex']]) {
    if (h === 'codex' && !codex) { partes.push('Codex pulado'); continue; }
    try {
      if (existsSync(dst[h]) && !agenteEhNosso(dst[h])) {
        ok = false; partes.push(`${nome} alheio`);
        console.error(`nabuco: ${dst[h]} não foi gerado pelo nabuco; não sobrescrevo`);
      } else partes.push(`${nome} ${gravarAgente(dst[h], g[h])}`);
    } catch (e) {
      ok = false; partes.push(`${nome} falhou`);
      console.error(`nabuco: não consegui gravar ${dst[h]} (${e.message})`);
      if (e.code === 'EPERM' || e.code === 'EACCES') console.error(`nabuco: sem permissão na pasta ${pasta} (sandbox?); rode "contratar instalar" fora do sandbox`);
    }
  }
  return { linha: `${dados.papel}: ${partes.join(', ')}`, ok };
}

const comandos = {
  validar() {
    const v = opcoes({ de: { type: 'string' }, codex: { type: 'string', default: 'auto' } });
    const codex = modoCodex(v.codex);
    const dados = lerContratacao(v.de);
    const erros = impedimentos(dados);
    if (erros.length) throw new ErroRegra(erros.join('\n'));
    const dst = destinos(dados.papel);
    const g = gerarArquivos(dados);
    console.log(`nabuco: contratação válida — ${dados.papel} (${dados.tipo}), ferramentas: ${dados.ferramentas.join(', ')}\n`);
    console.log(`=== Claude Code: ${dst.claude} ===\n${g.claude}`);
    if (codex) console.log(`=== Codex: ${dst.codex} ===\n${g.codex}`);
    else console.log(`=== Codex: não será instalado (pasta do Codex não encontrada; use --codex sim para forçar) ===\n`);
    const h = heranca(home, dados.papel);
    if (h.licoes || h.casos) console.log(`⚠️ herdará ${h.licoes} lições e ${h.casos} casos de um papel anterior chamado "${dados.papel}"`);
    console.log(`registro: ${arquivoRegistro(home, dados.papel)}`);
  },

  novo() {
    const v = opcoes({ de: { type: 'string' }, codex: { type: 'string', default: 'auto' } });
    const codex = modoCodex(v.codex);
    const dados = lerContratacao(v.de);
    const erros = impedimentos(dados);
    if (erros.length) throw new ErroRegra(erros.join('\n'));
    const p = dados.papel;
    const { modelos } = lerModelosTime(home);
    modelos.claude = { ...modelos.claude, [p]: dados.claude };
    modelos.codex = { ...modelos.codex, [p]: dados.codex };
    try {
      gravarArquivo(arquivoRegistro(home, p), registroMd(dados));
      mkdirSync(dirname(arquivoModelosTime(home)), { recursive: true });
      escreverJson(arquivoModelosTime(home), modelos);
    } catch (e) { throw new ErroRegra(`não consegui gravar o registro (${e.message})`); }
    const r = instalarUm(dados, codex);
    commitHome(home, `time: contratar ${p}`);
    console.log(`${r.ok ? '✅' : '⚠️'} ${r.linha}`);
    if (!r.ok) throw new ErroRegra(`registro gravado, mas a instalação ficou incompleta; corrija e rode "contratar instalar --papel ${p}"`);
    console.log(`nabuco: ${p} contratado. Reinicie a sessão do Claude Code/Codex para o agente nabuco-${p} aparecer.`);
  },

  listar() {
    const v = opcoes({ json: { type: 'boolean' } });
    const { contratados, avisos } = lerTime(home);
    const semCorpo = contratados.map(({ corpo, ...c }) => c);
    if (v.json) { console.log(JSON.stringify({ contratados: semCorpo, avisos }, null, 2)); }
    else if (!contratados.length) console.log(avisos.length ? 'nenhum contratado carregado (veja os avisos)' : 'nenhum funcionário contratado');
    else for (const c of contratados) console.log(`${c.papel} · ${c.tipo} · ${c.nome} — ${c.descricao} [${c.ferramentas.join(', ')}]`);
    for (const a of avisos) aviso(a);
  },

  instalar() {
    const v = opcoes({ papel: { type: 'string' }, codex: { type: 'string', default: 'auto' } });
    const codex = modoCodex(v.codex);
    const p = v.papel === undefined ? null : papelDaOpcao(v.papel);
    const { contratados, avisos, invalidos } = lerTime(home);
    for (const a of avisos) aviso(a);
    let alvos = contratados;
    if (p) {
      if (invalidos.includes(p)) throw new ErroRegra(`o registro de "${p}" é inválido (veja os avisos); corrija antes de instalar`);
      alvos = contratados.filter(c => c.papel === p);
      if (!alvos.length) throw new ErroRegra(`"${p}" não está contratado`);
    }
    if (!alvos.length) {
      if (avisos.length) throw new ErroRegra('nenhum contratado válido para instalar; corrija o registro (veja os avisos)');
      console.log('nenhum funcionário contratado; nada a instalar');
      return;
    }
    let ok = true;
    for (const c of alvos) {
      const r = instalarUm(c, codex);
      ok &&= r.ok;
      console.log(`${r.ok ? '✅' : '⚠️'} ${r.linha}`);
    }
    // Registro com entrada ignorada nunca sai como ok (só quando a instalação foi de todos).
    if (!p && avisos.length) throw new ErroRegra('há registros ignorados (veja os avisos); só os válidos foram instalados');
    if (!ok) throw new ErroRegra('instalação incompleta');
  },

  remover() {
    const v = opcoes({ papel: { type: 'string' } });
    const p = papelDaOpcao(v.papel);
    const reg = arquivoRegistro(home, p);
    if (!existsSync(reg)) throw new ErroRegra(`"${p}" não está contratado`);
    const dst = destinos(p);
    // Agentes primeiro: se algum falhar, o registro fica e dá para tentar de novo.
    try {
      for (const arq of [dst.claude, dst.codex]) {
        if (!existsSync(arq)) continue;
        if (agenteEhNosso(arq)) apagarArquivo(arq);
        else aviso(`${arq} não é do nabuco; deixei como está`);
      }
    } catch (e) {
      const dica = e.code === 'EPERM' || e.code === 'EACCES' ? '; rode fora do sandbox' : '';
      throw new ErroRegra(`não consegui apagar o agente de "${p}" (${e.message})${dica}; o registro ficou`);
    }
    apagarArquivo(reg);
    const lm = lerModelosTime(home);
    if (lm.erro) aviso(`${arquivoModelosTime(home)} ilegível (${lm.erro}); a entrada de "${p}" ficou nele`);
    else if (existsSync(arquivoModelosTime(home))) {
      delete lm.modelos.claude?.[p];
      delete lm.modelos.codex?.[p];
      escreverJson(arquivoModelosTime(home), lm.modelos);
    }
    commitHome(home, `time: remover ${p}`);
    console.log(`✅ ${p} removido (agentes e registro). As lições e casos de "${p}" ficam no disco: recontratar com o mesmo nome herda.`);
  },
};

try {
  if (!Object.hasOwn(comandos, comando ?? '')) {
    throw new ErroUso(comando ? `comando desconhecido "${comando}"` : 'falta o comando (validar, novo, listar, instalar ou remover)');
  }
  comandos[comando]();
} catch (e) {
  console.error(`nabuco: ${e.message}`);
  if (e instanceof ErroUso) console.error(USO);
  process.exit(e instanceof ErroUso ? 2 : 1);
}
