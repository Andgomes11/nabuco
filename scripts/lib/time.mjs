// Funcionários contratados pelo usuário: registro em ~/.nabuco/time/ (papeis/<p>.md + modelos.json),
// instalados como agentes `nabuco-<p>` no Claude Code e no Codex. Entradas são hostis: o slug é
// validado antes de virar caminho e nada aqui monta comando de shell.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nabucoHome } from './caminhos.mjs';
import { PAPEIS, ESCRITORES } from './constantes.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { lerJson } from './json.mjs';
import { FERRAMENTAS_CLAUDE, validarModelos } from './validar.mjs';
import { gerarAgenteClaude, gerarAgenteCodex } from './gerar.mjs';
import { lerLicoes } from './licoes.mjs';
import { gravarArquivo } from './repositorio-licoes.mjs';

// Só a-z: papelDoId, RE_AVATAR e RE_LICAO usam [a-z]+ (sem hífen, dígito ou acento).
export const RE_PAPEL = /^[a-z]{2,20}$/;
// Embutidos, o gerente, a pasta licoes/arquivo/ e nomes de dispositivo do Windows.
export const RESERVADOS = [...PAPEIS, 'gerente', 'arquivo', 'con', 'prn', 'aux', 'nul'];
export const TIPOS_CONTRATADO = ['escritor', 'checador'];
export const FERRAMENTAS_CHECADOR = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
export const MAX_NOME = 40;
export const MAX_DESCRICAO = 400;
export const MAX_CORPO = 20000;
// Marca de geração: 1ª linha do toml do Codex e 1ª linha do frontmatter (comentário YAML) do agente do Claude.
export const MARCA = '# GERADO por contratar.mjs';
const CAMPOS = ['papel', 'nome', 'tipo', 'descricao', 'ferramentas', 'corpo', 'claude', 'codex'];
// Quebras de linha (inclusive U+0085/U+2028/U+2029) e controles: nome/descrição precisam caber numa linha
// do frontmatter; o corpo aceita \n e \t (DEL quebraria a string TOML do Codex). Todo texto também
// precisa ser UTF-16 bem formado: surrogate solto vira \ud800 no TOML, que a spec não aceita.
const CONTROLE_LINHA = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const CONTROLE_CORPO = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const dirTime = (home = nabucoHome()) => join(home, 'time');
export const arquivoModelosTime = (home = nabucoHome()) => join(dirTime(home), 'modelos.json');

// Texto hostil exibido numa mensagem: entre aspas, com escapes e curto.
const mostrar = v => JSON.stringify(typeof v === 'string' ? (v.length > 40 ? v.slice(0, 40) + '…' : v) : String(v));

export const papelValido = p => typeof p === 'string' && RE_PAPEL.test(p);
function exigirSlug(p) {
  if (!papelValido(p)) throw new Error(`papel inválido ${mostrar(p)}`);
  return p;
}
export const arquivoRegistro = (home, p) => join(dirTime(home), 'papeis', `${exigirSlug(p)}.md`);
export function destinos(p) {
  exigirSlug(p);
  return { claude: join(claudeHome(), 'agents', `nabuco-${p}.md`), codex: join(codexHome(), 'agents', `nabuco-${p}.toml`) };
}

// null se o papel pode ser contratado; senão a mensagem do motivo.
export function erroPapel(p) {
  if (!papelValido(p)) return `papel inválido ${mostrar(p)}: use de 2 a 20 letras minúsculas de a a z (sem acento, hífen, dígito ou espaço)`;
  if (PAPEIS.includes(p)) return `papel "${p}" já é um funcionário embutido do nabuco`;
  if (RESERVADOS.includes(p)) return `papel "${p}" é um nome reservado`;
  return null;
}

function erroLinha(campo, v, max) {
  if (typeof v !== 'string' || !v.trim()) return `falta "${campo}" (texto de uma linha)`;
  if (!v.isWellFormed()) return `"${campo}" tem texto mal formado (surrogate UTF-16 solto)`;
  if (CONTROLE_LINHA.test(v)) return `"${campo}" deve ter uma linha só, sem quebra de linha ou caractere de controle`;
  if (v.trim().length > max) return `"${campo}" longo demais (máximo ${max} caracteres)`;
  return null;
}

function errosFerramentas(tipo, fs) {
  if (!Array.isArray(fs) || !fs.length) {
    return ['ferramentas é obrigatória: lista com as ferramentas do Claude (sem ela o agente herdaria todas, inclusive MCP)'];
  }
  const erros = [];
  const vistas = new Set();
  for (const f of fs) {
    if (typeof f !== 'string' || !FERRAMENTAS_CLAUDE.includes(f)) { erros.push(`ferramenta desconhecida ${mostrar(f)} (use: ${FERRAMENTAS_CLAUDE.join(', ')})`); continue; }
    if (vistas.has(f)) erros.push(`ferramenta repetida "${f}"`);
    vistas.add(f);
    if (tipo === 'checador' && !FERRAMENTAS_CHECADOR.includes(f)) erros.push(`checador não pode usar "${f}" (só ${FERRAMENTAS_CHECADOR.join(', ')})`);
  }
  return erros;
}

function errosCorpo(corpo) {
  if (typeof corpo !== 'string' || !corpo.trim()) return ['falta "corpo" (as instruções do funcionário)'];
  const erros = [];
  if (corpo.length > MAX_CORPO) erros.push(`corpo grande demais (${corpo.length} caracteres; máximo ${MAX_CORPO})`);
  if (CONTROLE_CORPO.test(corpo)) erros.push('corpo tem caractere de controle');
  if (!corpo.isWellFormed()) erros.push('corpo tem texto mal formado (surrogate UTF-16 solto)');
  const entrega = /^#{1,6}[ \t]+Entrega\b/im.exec(corpo);
  if (!entrega) erros.push('corpo precisa de uma seção "## Entrega" (formato da resposta do funcionário)');
  else if (!/lições usadas/i.test(corpo.slice(entrega.index))) {
    erros.push('a seção "## Entrega" do corpo precisa do item "lições usadas" (é como o time mede as lições)');
  }
  return erros;
}

// Valida o JSON de contratação. Devolve { erros, dados } com dados normalizados (null se houver erro).
export function validarContratacao(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { erros: ['a contratação deve ser um objeto JSON'], dados: null };
  const erros = [];
  for (const k of Object.keys(d)) if (!CAMPOS.includes(k)) erros.push(`campo desconhecido ${mostrar(k)} (use: ${CAMPOS.join(', ')})`);
  const ep = erroPapel(d.papel);
  if (ep) erros.push(ep);
  for (const [campo, max] of [['nome', MAX_NOME], ['descricao', MAX_DESCRICAO]]) {
    const e = erroLinha(campo, d[campo], max);
    if (e) erros.push(e);
  }
  if (!TIPOS_CONTRATADO.includes(d.tipo)) erros.push(`tipo inválido ${mostrar(d.tipo)} (use: ${TIPOS_CONTRATADO.join(' ou ')})`);
  erros.push(...errosFerramentas(d.tipo, d.ferramentas));
  const corpo = typeof d.corpo === 'string' ? d.corpo.replace(/\r\n?/g, '\n') : d.corpo;
  erros.push(...errosCorpo(corpo));
  const chave = ep ? 'papel' : d.papel;
  const faltam = ['claude', 'codex'].filter(h => !d[h] || typeof d[h] !== 'object' || Array.isArray(d[h]));
  for (const h of faltam) erros.push(`falta "${h}": { "model": ..., "effort": ... }`);
  if (!faltam.length) {
    erros.push(...validarModelos({ claude: { [chave]: d.claude }, codex: { [chave]: d.codex } }, [chave]));
    const m = d.codex.model;
    if (typeof m === 'string' && (m.length > 100 || CONTROLE_LINHA.test(m) || !m.isWellFormed())) erros.push('codex.model deve ser um nome curto numa linha');
  }
  if (erros.length) return { erros, dados: null };
  return {
    erros,
    dados: {
      papel: d.papel, nome: d.nome.trim(), tipo: d.tipo, descricao: d.descricao.trim(), ferramentas: [...d.ferramentas],
      corpo: corpo.trim() + '\n',
      claude: { model: d.claude.model, effort: d.claude.effort }, codex: { model: d.codex.model, effort: d.codex.effort },
    },
  };
}

// Arquivo do registro (time/papeis/<p>.md); os modelos ficam em time/modelos.json.
export function registroMd(dados) {
  return ['---', `nome: ${dados.nome}`, `descricao: ${dados.descricao}`, `tipo: ${dados.tipo}`,
    `ferramentas: ${dados.ferramentas.join(', ')}`, '---', '', dados.corpo.trimEnd(), ''].join('\n');
}

// Lê time/modelos.json: { modelos } ou { erro } se ilegível. Ausente = vazio.
export function lerModelosTime(home = nabucoHome()) {
  const arq = arquivoModelosTime(home);
  if (!existsSync(arq)) return { modelos: { claude: {}, codex: {} } };
  try {
    const m = lerJson(arq);
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('não é um objeto');
    return { modelos: m };
  } catch (e) { return { erro: e.message }; }
}

// Registro inteiro. Nunca lança: registro ilegível ou inválido vira aviso (nunca some em silêncio).
// `invalidos` = papéis com nome válido cujo registro foi ignorado.
export function lerTime(home = nabucoHome()) {
  const contratados = [], avisos = [], invalidos = [];
  try {
    const dir = join(dirTime(home), 'papeis');
    let arquivos = [];
    if (existsSync(dir)) {
      try { arquivos = readdirSync(dir).filter(f => f.endsWith('.md')).sort(); }
      catch (e) { avisos.push(`não consegui ler ${dir} (${e.message}); nenhum contratado carregado`); }
    }
    if (!arquivos.length) return { contratados, avisos, invalidos };
    const lm = lerModelosTime(home);
    if (lm.erro) {
      avisos.push(`time/modelos.json ilegível (${lm.erro}); os ${arquivos.length} contratados ficam fora até corrigir`);
      return { contratados, avisos, invalidos };
    }
    for (const f of arquivos) {
      const p = f.slice(0, -3);
      const ep = erroPapel(p);
      if (ep) { avisos.push(`time/papeis/${mostrar(f)} ignorado: ${ep}`); continue; }
      let fm, corpo;
      try { ({ dados: fm, corpo } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'))); }
      catch (e) { avisos.push(`time/papeis/${f} ilegível (${e.message}); ignorado`); invalidos.push(p); continue; }
      const { erros, dados } = validarContratacao({
        papel: p, nome: fm.nome, tipo: fm.tipo, descricao: fm.descricao,
        ferramentas: fm.ferramentas ? fm.ferramentas.split(',').map(s => s.trim()).filter(Boolean) : [],
        corpo, claude: lm.modelos.claude?.[p], codex: lm.modelos.codex?.[p],
      });
      if (erros.length) { avisos.push(`time/papeis/${f} ignorado: ${erros.join('; ')}`); invalidos.push(p); continue; }
      contratados.push(dados);
    }
  } catch (e) {
    avisos.push(`falha ao ler o registro do time (${e.message})`);
  }
  return { contratados, avisos, invalidos };
}

export const contratados = (home = nabucoHome()) => lerTime(home).contratados;
export const papeis = (home = nabucoHome()) => [...PAPEIS, ...contratados(home).map(c => c.papel)];
export const papeisCerebro = (home = nabucoHome()) => [...papeis(home), 'gerente'];
export const escritores = (home = nabucoHome()) => [...ESCRITORES, ...contratados(home).filter(c => c.tipo === 'escritor').map(c => c.papel)];

// Conteúdo dos dois agentes de um contratado (dados já validados).
export function gerarArquivos(dados) {
  const fm = { descricao: dados.descricao, ferramentas: dados.ferramentas.join(', ') };
  const origem = `contratar.mjs a partir de time/papeis/${dados.papel}.md`;
  return {
    claude: gerarAgenteClaude(dados.papel, fm, dados.corpo, dados.claude,
      { nome: `nabuco-${dados.papel}`, marca: `# GERADO por ${origem} — não edite à mão.` }),
    codex: gerarAgenteCodex(dados.papel, fm, dados.corpo, dados.codex, { origem }),
  };
}

export function construirTime(home = nabucoHome()) {
  const { contratados: cs, avisos } = lerTime(home);
  return { arquivos: cs.map(c => ({ papel: c.papel, ...gerarArquivos(c) })), avisos };
}

// Lições (arquivo global) e casos deixados por um papel anterior com o mesmo nome.
export function heranca(home, p) {
  exigirSlug(p);
  let licoes = 0, casos = 0;
  try {
    const arq = join(home, 'licoes', `${p}.md`);
    if (existsSync(arq)) licoes = lerLicoes(readFileSync(arq, 'utf8')).blocos.length;
  } catch { /* ilegível: conta 0 */ }
  try {
    const dir = join(home, 'casos', p);
    if (existsSync(dir)) casos = readdirSync(dir).filter(f => f.endsWith('.md')).length;
  } catch { /* ilegível: conta 0 */ }
  return { licoes, casos };
}

// Agente (md do Claude ou toml do Codex) é nosso só se tem a marca de geração do contratar no lugar dela.
export function agenteEhNosso(arq) {
  const t = readFileSync(arq, 'utf8');
  return t.startsWith(arq.endsWith('.md') ? `---\n${MARCA}` : MARCA);
}

// Grava `conteudo` em `arq` (atômico). Devolve 'criado', 'atualizado' ou 'sem mudança'.
export function gravarAgente(arq, conteudo) {
  const existia = existsSync(arq);
  if (existia && readFileSync(arq, 'utf8') === conteudo) return 'sem mudança';
  gravarArquivo(arq, conteudo);
  return existia ? 'atualizado' : 'criado';
}

export function apagarArquivo(arq) {
  if (!existsSync(arq)) return false;
  rmSync(arq);
  return true;
}

// Agente do Claude Code de um contratado: 'instalado', 'ausente' ou 'alheio' (sem a marca do contratar).
export function estadoClaude(p) {
  const arq = destinos(p).claude;
  try {
    if (!existsSync(arq)) return 'ausente';
    return agenteEhNosso(arq) ? 'instalado' : 'alheio';
  } catch { return 'ausente'; }
}

// Instala os dois agentes de um contratado. Devolve { linha, ok }; nunca lança (problemas vão para `avisar`).
// Agente sem a marca do contratar (do usuário, mesmo com registro presente) nunca é sobrescrito.
export function instalarContratado(dados, codex, avisar = m => console.error(m)) {
  const dst = destinos(dados.papel);
  const g = gerarArquivos(dados);
  const partes = [];
  let ok = true;
  for (const [h, nome, pasta] of [['claude', 'Claude', 'do Claude'], ['codex', 'Codex', 'do Codex']]) {
    if (h === 'codex' && !codex) { partes.push('Codex pulado'); continue; }
    try {
      if (existsSync(dst[h]) && !agenteEhNosso(dst[h])) {
        ok = false; partes.push(`${nome} alheio`);
        avisar(`nabuco: ${dst[h]} não foi gerado pelo nabuco; não sobrescrevo`);
      } else partes.push(`${nome} ${gravarAgente(dst[h], g[h])}`);
    } catch (e) {
      ok = false; partes.push(`${nome} falhou`);
      avisar(`nabuco: não consegui gravar ${dst[h]} (${e.message})`);
      if (e.code === 'EPERM' || e.code === 'EACCES') avisar(`nabuco: sem permissão na pasta ${pasta} (sandbox?); rode "contratar instalar" fora do sandbox`);
    }
  }
  return { linha: `${dados.papel}: ${partes.join(', ')}`, ok };
}

// Deixa os agentes desta máquina iguais ao registro (usado depois de trazer o cérebro de outra máquina):
// instala/atualiza os contratados válidos e apaga os `nabuco-<p>` com a marca do contratar cujo registro
// (time/papeis/<p>.md) não existe mais. Agente sem a marca, embutido ou com registro presente (mesmo
// inválido) nunca é tocado. Nunca lança. Devolve { ok, linhas, avisos }.
export function reconciliarTime(home = nabucoHome(), { codex = existsSync(codexHome()) } = {}) {
  const linhas = [], avisos = [];
  let ok = true;
  try {
    const t = lerTime(home);
    avisos.push(...t.avisos);
    for (const c of t.contratados) {
      const r = instalarContratado(c, codex, m => avisos.push(m));
      ok &&= r.ok;
      linhas.push(r.linha);
    }
    for (const [pasta, ext] of [[join(claudeHome(), 'agents'), '.md'], [join(codexHome(), 'agents'), '.toml']]) {
      let nomes = [];
      try { nomes = existsSync(pasta) ? readdirSync(pasta) : []; }
      catch (e) { ok = false; avisos.push(`não consegui ler ${pasta} (${e.message})`); continue; }
      for (const n of nomes) {
        if (!n.startsWith('nabuco-') || !n.endsWith(ext)) continue;
        const p = n.slice('nabuco-'.length, -ext.length);
        if (erroPapel(p) || existsSync(arquivoRegistro(home, p))) continue;
        const arq = join(pasta, n);
        try {
          if (!agenteEhNosso(arq)) continue;
          apagarArquivo(arq);
          linhas.push(`${p}: ${n} removido (não está mais no registro)`);
        } catch (e) { ok = false; avisos.push(`não consegui apagar ${arq} (${e.message})`); }
      }
    }
  } catch (e) {
    ok = false;
    avisos.push(`falha ao reconciliar os contratados (${e.message})`);
  }
  return { ok, linhas, avisos };
}
