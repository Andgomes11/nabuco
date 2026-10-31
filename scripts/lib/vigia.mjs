import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, basename, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirProjeto, ehPastaGlobal } from './caminhos.mjs';
import { lerJson, escreverJson } from './json.mjs';

// Vigia: regras puras ou só de leitura; caminhos de home e o git são injetáveis (testes usam fixtures).
// Nunca devolve um segredo inteiro: todo texto de achado passa por mascararTexto, e valores achados
// viram só "4 primeiros caracteres + …". Não lê ~/.codex/auth.json; de ~/.claude.json só usa mcpServers.

export const SEVERIDADES = ['alta', 'media', 'baixa', 'info'];
export const MAX_COMMITS = 1000;

// --- segredos ---
// Ordem importa: Anthropic antes de OpenAI (os dois começam com "sk-").
export const PADROES_SEGREDO = [
  { nome: 'chave privada', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { nome: 'chave AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nome: 'token GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { nome: 'chave Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { nome: 'chave OpenAI', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{32,}/g },
  { nome: 'token Slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { nome: 'chave Google', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { nome: 'chave Stripe', re: /\b[sr]k_live_[0-9A-Za-z]{20,}/g },
  // URL de webhook é a própria credencial: mostra o host e esconde o caminho.
  { nome: 'webhook Slack', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{8,}/g, mascara: m => m.replace(/\/services\/.*/, '/services/…') },
  { nome: 'webhook Discord', re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9/_-]{8,}/g, mascara: m => m.replace(/\/webhooks\/.*/, '/webhooks/…') },
];

// Valor curto demais não mostra nada (4 caracteres de uma senha de 6 seriam quase ela inteira).
export const mascarar = valor => {
  const v = String(valor ?? '');
  return v.length >= 12 ? `${v.slice(0, 4)}…` : '…';
};

// Segredos achados no texto: só o nome do padrão e o valor mascarado, sem sobreposição.
export function acharSegredos(texto) {
  const t = String(texto ?? '');
  const ocupados = [], out = [];
  for (const { nome, re, mascara = mascarar } of PADROES_SEGREDO) {
    for (const m of t.matchAll(re)) {
      const ini = m.index, fim = m.index + m[0].length;
      if (ocupados.some(([a, b]) => ini < b && fim > a)) continue;
      ocupados.push([ini, fim]);
      out.push({ nome, mascarado: mascara(m[0]) });
    }
  }
  return out;
}

// Credencial em URL (esquema://usuario:senha@host); referência ($VAR, ${VAR}) na senha não conta.
const RE_URL_CREDENCIAL = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/@:'"]+):([^\s/@'"]+)@/gi;
export function credencialEmUrl(texto) {
  for (const m of String(texto ?? '').matchAll(RE_URL_CREDENCIAL)) {
    if (!ehReferencia(m[2])) return { tipo: 'credencial na URL', mascarado: '***' };
  }
  return null;
}

// Mascara segredos conhecidos e credenciais em URL (https://usuario:senha@host) dentro de um texto livre.
export function mascararTexto(texto) {
  let t = String(texto ?? '');
  for (const { re, mascara = mascarar } of PADROES_SEGREDO) t = t.replace(re, m => mascara(m));
  return t.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

// --- TOML mínimo ---
// Cobre o que o config.toml do Codex usa: tabelas ([a."b".c] e [[a]]), chaves pontuadas, strings
// (básicas, literais e multilinha), números, booleanos, datas (como texto), arrays e tabelas inline.
// Erro sempre como "TOML inválido na linha N: motivo" (sem trecho do arquivo, que pode ter segredo).
const definir = (obj, k, v) => Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
const proprio = (obj, k) => (Object.hasOwn(obj, k) ? obj[k] : undefined);
const ehTabela = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function lerToml(texto) {
  const s = String(texto).replace(/^\uFEFF/, '');
  let i = 0;
  const linha = () => s.slice(0, i).split('\n').length;
  const erro = motivo => { throw new Error(`TOML inválido na linha ${linha()}: ${motivo}`); };
  const espacos = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
  const comentario = () => { if (s[i] === '#') while (i < s.length && s[i] !== '\n') i++; };
  const fimDeLinha = () => {
    espacos(); comentario();
    if (s[i] === '\r') i++;
    if (i < s.length && s[i] !== '\n') erro('conteúdo inesperado depois do valor');
    if (s[i] === '\n') i++;
  };
  // Em """...""""" até duas aspas a mais antes do fechamento fazem parte do valor.
  const aspasExtras = (pos, q) => { let n = 0; while (s[pos + n] === q) n++; return Math.min(Math.max(n - 3, 0), 2); };
  const brancos = () => { // espaços, comentários e quebras (dentro de arrays)
    for (;;) {
      espacos(); comentario();
      if (s[i] === '\r' || s[i] === '\n') { i++; continue; }
      return;
    }
  };

  function stringBasica(multi) {
    let out = '';
    if (multi && s[i] === '\r') i++;
    if (multi && s[i] === '\n') i++;
    for (;;) {
      if (i >= s.length) erro('string sem fim');
      if (multi ? s.startsWith('"""', i) : s[i] === '"') {
        const extras = multi ? aspasExtras(i, '"') : 0;
        i += extras + (multi ? 3 : 1);
        return out + '"'.repeat(extras);
      }
      const c = s[i];
      if (!multi && (c === '\n' || c === '\r')) erro('string sem fim');
      if (c === '\\') {
        const e = s[i + 1];
        const simples = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\', e: '\x1b' };
        if (e in simples) { out += simples[e]; i += 2; continue; }
        if (e === 'u' || e === 'U') {
          const n = e === 'u' ? 4 : 8, hex = s.slice(i + 2, i + 2 + n);
          if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== n) erro('escape unicode inválido');
          out += String.fromCodePoint(parseInt(hex, 16)); i += 2 + n; continue;
        }
        if (multi && /[ \t\r\n]/.test(e)) { // barra no fim da linha: junta com a próxima
          let j = i + 1;
          while (s[j] === ' ' || s[j] === '\t') j++;
          if (s[j] === '\r') j++;
          if (s[j] !== '\n') erro('escape inválido');
          while (/[ \t\r\n]/.test(s[j] ?? '')) j++;
          i = j; continue;
        }
        erro('escape inválido');
      }
      out += c; i++;
    }
  }
  function stringLiteral(multi) {
    if (multi && s[i] === '\r') i++;
    if (multi && s[i] === '\n') i++;
    const fecho = multi ? "'''" : "'";
    const fim = s.indexOf(fecho, i);
    if (fim < 0) erro('string sem fim');
    const f = fim + (multi ? aspasExtras(fim, "'") : 0);
    const out = s.slice(i, f);
    if (!multi && /[\r\n]/.test(out)) erro('string sem fim');
    i = f + fecho.length;
    return out;
  }
  function string() {
    if (s.startsWith('"""', i)) { i += 3; return stringBasica(true); }
    if (s.startsWith("'''", i)) { i += 3; return stringLiteral(true); }
    if (s[i] === '"') { i++; return stringBasica(false); }
    i++; return stringLiteral(false);
  }
  function chaveSimples() {
    if (s[i] === '"' || s[i] === "'") {
      if (s.startsWith('"""', i) || s.startsWith("'''", i)) erro('chave multilinha');
      return string();
    }
    const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i, i + 256));
    if (!m) erro('chave inválida');
    i += m[0].length;
    return m[0];
  }
  function chave() { // a."b".c
    const partes = [];
    for (;;) {
      espacos(); partes.push(chaveSimples()); espacos();
      if (s[i] !== '.') return partes;
      i++;
    }
  }
  function valor() {
    const c = s[i];
    if (c === '"' || c === "'") return string();
    if (c === '[') {
      i++; const arr = [];
      for (;;) {
        brancos();
        if (s[i] === ']') { i++; return arr; }
        if (i >= s.length) erro('array sem fim');
        arr.push(valor());
        brancos();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return arr; }
        erro('array sem fim');
      }
    }
    if (c === '{') {
      i++; const obj = {};
      espacos();
      if (s[i] === '}') { i++; return obj; }
      for (;;) {
        brancos();
        const k = chave();
        if (s[i] !== '=') erro('esperava "="');
        i++; espacos();
        atribuir(obj, k, valor());
        brancos();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return obj; }
        erro('tabela inline sem fim');
      }
    }
    const m = /^[^\s,\]}#]+/.exec(s.slice(i, i + 256));
    if (!m) erro('valor ausente');
    let bruto = m[0];
    i += bruto.length;
    // data e hora com espaço no meio (1979-05-27 07:32:00)
    const h = /^ \d{2}:\d{2}/.exec(s.slice(i, i + 6));
    if (/^\d{4}-\d{2}-\d{2}$/.test(bruto) && h) {
      const resto = /^ [^\s,\]}#]+/.exec(s.slice(i, i + 64))[0];
      bruto += resto; i += resto.length;
    }
    if (bruto === 'true') return true;
    if (bruto === 'false') return false;
    const num = bruto.replace(/_/g, '');
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9A-Fa-f]+|0o[0-7]+|0b[01]+|inf|nan)$/.test(num)) {
      if (/^[+-]?(inf|nan)$/.test(num)) return num.includes('nan') ? NaN : (num.startsWith('-') ? -Infinity : Infinity);
      return Number(num);
    }
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(bruto)) return bruto; // data/hora: fica como texto
    erro('valor inválido');
  }
  function atribuir(alvo, partes, v) {
    let obj = alvo;
    for (const p of partes.slice(0, -1)) {
      const atual = proprio(obj, p);
      if (atual === undefined) obj = definir(obj, p, {})[p];
      else if (ehTabela(atual)) obj = atual;
      else erro(`chave "${p}" já definida`);
    }
    const ult = partes[partes.length - 1];
    if (proprio(obj, ult) !== undefined) erro('chave duplicada');
    definir(obj, ult, v);
  }
  function tabela(partes, deArray) {
    let obj = raiz;
    partes.forEach((p, n) => {
      const ultima = n === partes.length - 1;
      let atual = proprio(obj, p);
      if (ultima && deArray) {
        if (atual === undefined) atual = definir(obj, p, [])[p];
        if (!Array.isArray(atual)) erro(`"${p}" não é array de tabelas`);
        const nova = {}; atual.push(nova); obj = nova; return;
      }
      if (atual === undefined) atual = definir(obj, p, {})[p];
      if (Array.isArray(atual)) atual = atual[atual.length - 1];
      if (!ehTabela(atual)) erro(`"${p}" não é tabela`);
      obj = atual;
    });
    return obj;
  }

  const raiz = {};
  let atual = raiz;
  for (;;) {
    brancos();
    if (i >= s.length) return raiz;
    if (s[i] === '[') {
      const deArray = s[i + 1] === '[';
      i += deArray ? 2 : 1;
      const partes = chave();
      if (deArray ? !s.startsWith(']]', i) : s[i] !== ']') erro('cabeçalho de tabela sem "]"');
      i += deArray ? 2 : 1;
      atual = tabela(partes, deArray);
      fimDeLinha();
      continue;
    }
    const k = chave();
    if (s[i] !== '=') erro('esperava "="');
    i++; espacos();
    if (i >= s.length || s[i] === '\n' || s[i] === '\r' || s[i] === '#') erro('valor ausente');
    atribuir(atual, k, valor());
    fimDeLinha();
  }
}

// --- achados ---
export const idAchado = (categoria, onde, regra) =>
  createHash('sha1').update(`${categoria}\0${onde}\0${regra}`).digest('hex').slice(0, 10);

const novo = (severidade, categoria, onde, regra, resumo, correcao) => ({ severidade, categoria, onde, regra, resumo, correcao });

// Mascara todo texto, calcula o id, tira duplicados e ordena por severidade.
function finalizar(brutos) {
  const vistos = new Set(), out = [];
  for (const b of brutos) {
    const onde = mascararTexto(b.onde);
    const id = b.id ?? idAchado(b.categoria, onde, b.regra);
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, severidade: b.severidade, categoria: b.categoria, onde, resumo: mascararTexto(b.resumo), correcao: mascararTexto(b.correcao) });
  }
  const ordem = a => SEVERIDADES.indexOf(a.severidade);
  return out.sort((a, b) => ordem(a) - ordem(b) || a.categoria.localeCompare(b.categoria) || a.onde.localeCompare(b.onde));
}

export function resumir(achados) {
  const r = Object.fromEntries(SEVERIDADES.map(s => [s, 0]));
  for (const a of achados) r[a.severidade]++;
  return r;
}
export const codigoSaida = achados => (achados.some(a => a.severidade === 'alta' || a.severidade === 'media') ? 1 : 0);

export function formatarTabela(achados) {
  if (!achados.length) return 'nenhum achado';
  const linhas = [];
  for (const sev of SEVERIDADES) {
    const doNivel = achados.filter(a => a.severidade === sev);
    if (!doNivel.length) continue;
    linhas.push(`${sev.toUpperCase()} (${doNivel.length})`);
    for (const a of doNivel) {
      linhas.push(`  [${a.id}] ${a.categoria} — ${a.onde}`, `      ${a.resumo}`);
      if (a.correcao) linhas.push(`      correção: ${a.correcao}`);
    }
    linhas.push('');
  }
  return linhas.join('\n').trimEnd();
}

// --- leitura de configs ---
// Mensagem de erro de JSON.parse pode trazer um trecho do arquivo (e um segredo): fica só a posição.
function motivoJson(e) {
  const pos = /(at position \d+(?: \(line \d+ column \d+\))?)/.exec(e.message);
  return pos ? `JSON inválido ${pos[1]}` : 'JSON inválido';
}
// Arquivo ausente é normal (null); ilegível vira achado media e também devolve null.
function lerConfig(arquivo, onde, tipo, brutos) {
  if (!existsSync(arquivo)) return null;
  try {
    const texto = readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '');
    if (tipo === 'toml') return lerToml(texto);
    try { return JSON.parse(texto); } catch (e) { throw new Error(motivoJson(e)); }
  } catch (e) {
    const motivo = e.code ? `não consegui ler (${e.code})` : e.message;
    brutos.push(novo('media', 'config', onde, 'ilegivel', `${onde} ilegível: ${motivo}; nada dele foi verificado`,
      'Corrija o arquivo (ou as permissões) para que a ferramenta e o vigia consigam lê-lo, e rode o vigia de novo.'));
    return null;
  }
}

const entradas = v => (ehTabela(v) ? Object.entries(v) : []);
const lista = v => (Array.isArray(v) ? v : []);

// --- permissões ---
const ALLOW_AMPLO = new Set(['*', 'Bash', 'Bash(*)', 'Bash(:*)', 'PowerShell', 'PowerShell(*)', 'PowerShell(:*)']);

function auditarPermissoesClaude(cfg, onde, brutos) {
  const p = cfg?.permissions;
  if (!ehTabela(p)) return;
  if (p.defaultMode === 'bypassPermissions') {
    brutos.push(novo('alta', 'permissoes', onde, 'bypassPermissions',
      'defaultMode "bypassPermissions": o Claude roda qualquer comando e edição sem pedir permissão',
      'Troque "defaultMode" para "default" (ou "acceptEdits") e libere em "allow" só os comandos de que precisa.'));
  }
  for (const r of lista(p.allow)) {
    if (typeof r !== 'string' || !ALLOW_AMPLO.has(r.trim())) continue;
    brutos.push(novo('media', 'permissoes', onde, `allow:${r.trim()}`,
      `permissions.allow libera "${r.trim()}": qualquer comando de shell roda sem pedir permissão`,
      `Troque "${r.trim()}" por regras específicas, como "Bash(npm test:*)" ou "Bash(git status)".`));
  }
}

// Raiz (com o perfil ativo de `profile = "x"` por cima) e cada [profiles.<x>] (que `--profile` pode escolher).
function auditarPermissoesCodex(cfg, onde, brutos) {
  if (!ehTabela(cfg)) return;
  const perfis = ehTabela(cfg.profiles) ? cfg.profiles : {};
  const ativo = typeof cfg.profile === 'string' && ehTabela(perfis[cfg.profile]) ? cfg.profile : null;
  const efetivo = p => ({
    approval_policy: p?.approval_policy ?? cfg.approval_policy,
    sandbox_mode: p?.sandbox_mode ?? cfg.sandbox_mode,
  });
  const candidatos = [[null, efetivo(ativo ? perfis[ativo] : null)],
    ...Object.entries(perfis).filter(([n, p]) => n !== ativo && ehTabela(p)).map(([n, p]) => [n, efetivo(p)])];
  for (const [perfil, e] of candidatos) {
    if (e.approval_policy !== 'never' || e.sandbox_mode !== 'danger-full-access') continue;
    const qual = perfil ? `perfil "${perfil}"` : ativo ? `configuração padrão (perfil ativo "${ativo}")` : 'configuração padrão';
    brutos.push(novo('alta', 'permissoes', onde, `codex-never-danger:${perfil ?? ''}`,
      `${qual}: approval_policy = "never" com sandbox_mode = "danger-full-access": o Codex roda tudo, sem sandbox e sem perguntar`,
      'Use sandbox_mode = "workspace-write" e approval_policy = "on-request" (ou "untrusted").'));
  }
}

// --- hooks ---
const SUDO = String.raw`(sudo(\s+-[\w-]+)*\s+)?`;
const SHELLS = 'sh|bash|zsh|dash|ksh';
const RISCOS_HOOK = [
  ['baixa um script da internet e executa direto', new RegExp(String.raw`\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|;&]*\|\s*${SUDO}(${SHELLS}|iex|Invoke-Expression|pwsh|powershell|python3?|node|perl|ruby)\b`, 'i')],
  ['executa a saída de um download como script', new RegExp(String.raw`\b(${SHELLS}|eval|source)\b[^|;&]*?(-c\s*)?["']?\$\(\s*(curl|wget)\b|\b(${SHELLS}|source|\.)\s+<\(\s*(curl|wget)\b`, 'i')],
  ['executa texto com Invoke-Expression (iex)', /(^|[^\w-])(iex|Invoke-Expression)\b/i],
  ['decodifica base64 e executa', new RegExp(String.raw`base64\s+(-d|--decode|-D)\b[^|]*\|\s*${SUDO}(${SHELLS})\b|\beval\b[\s\S]*base64\s+(-d|--decode|-D)\b|FromBase64String[\s\S]*\b(iex|Invoke-Expression)\b|\b(powershell|pwsh)(\.exe)?\b[^|;&]*\s-(e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{8,}`, 'i')],
];
const curto = (t, n = 160) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function auditarHooks(cfg, onde, brutos) {
  for (const [evento, grupos] of entradas(cfg?.hooks)) {
    lista(grupos).forEach((g, gi) => {
      lista(g?.hooks).forEach((h, hi) => {
        const cmd = typeof h?.command === 'string' ? h.command : null;
        if (!cmd) return;
        const quando = `${evento}${g.matcher ? ` (${g.matcher})` : ''}`;
        const texto = curto(mascararTexto(mascararComando(cmd)).replace(/\s+/g, ' '));
        const regra = `${evento}:${gi}:${hi}:${cmd}`;
        brutos.push(novo('info', 'hooks', onde, `inventario:${regra}`, `hook ${quando} roda: ${texto}`,
          'Só inventário: confira se você reconhece este hook.'));
        const riscos = RISCOS_HOOK.filter(([, re]) => re.test(cmd)).map(([motivo]) => motivo);
        if (riscos.length) {
          brutos.push(novo('alta', 'hooks', onde, `perigoso:${regra}`, `hook ${quando} ${riscos.join('; ')}: ${texto}`,
            'Remova o hook ou troque por um script local versionado e revisado; nunca execute código baixado ou decodificado na hora.'));
        }
      });
    });
  }
}

// --- MCPs ---
const NOME_SECRETO = /token|key|secret|passw|pwd|credential|auth/i;
const FLAG_SECRETA = /^--?[\w-]*(token|key|secret|passw|pwd|credential)[\w-]*$/i;

// ${VAR}, $VAR, %VAR% (com "Bearer " opcional na frente) contam como referência, não como valor.
const ehReferencia = v => v.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%/g, '')
  .replace(/^\s*(bearer|basic|token)\s*/i, '').trim() === '';
// Comando de shell (hooks): esconde o valor de VAR=valor (também "VAR = valor", "$env:VAR=", "?var=" de
// query string, @{Nome="..."} e @{'Nome'='...'} do PowerShell), --flag valor, --flag=valor, -p valor e
// -psenha, a senha de -u/--user usuario:senha e -uusuario:senha, e "Nome: valor" (cabeçalho ou JSON
// "nome":"valor") quando o nome é sensível; depois aplica mascararTexto (padrões, URL com credencial,
// webhooks). Referências ($VAR, ${VAR}, %VAR%) ficam; "Bearer "/"Basic " na frente do valor também.
const NOME_SENSIVEL = /token|key|secret|pass|pwd|auth|credential/i;
const VALOR_CMD = `("[^"]*"|'[^']*'|(?:\\$\\{[^}\\s]*\\}|[^\\s;&|"'}])+)`; // ${VAR} fica inteiro
const RE_ATRIBUICAO = new RegExp(`(^|[\\s;&|:(?{,"'])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\\2(\\s*=\\s*)${VALOR_CMD}`, 'g');
const RE_FLAG = new RegExp(`(^|\\s)(--?[A-Za-z][\\w-]*)(=|\\s+)${VALOR_CMD}`, 'g');
const RE_CABECALHO = /\b([\w-]*(?:token|key|secret|auth|pass)[\w-]*)(["']?\s*:\s*["']?)((?:bearer|basic|token)\s+)?((?:\$\{[^}\s]*\}|[^\s"';&|,}])+)/gi;
const RE_U_COLADO = /(^|\s)-u([^\s;&|"':-][^\s;&|"':]*):([^\s;&|"']+)/g;
const RE_P_COLADO = /(^|\s)-p([^\s;&|"'-][^\s;&|"']*)/g;
const tirarAspas = v => (/^["']/.test(v) ? [v[0], v.slice(1, -1)] : ['', v]);
const semEsquema = v => v.replace(/^\s*(bearer|basic|token)\s+/i, '').trim();
function taparValor(v) {
  const [q, nu] = tirarAspas(v);
  if (nu === '' || ehReferencia(nu)) return v;
  const e = /^(\s*(?:bearer|basic|token)\s+)(.+)$/i.exec(nu);
  return e ? `${q}${e[1]}${mascarar(e[2])}${q}` : `${q}${mascarar(nu)}${q}`;
}
function taparUsuarioSenha(v) {
  const [q, nu] = tirarAspas(v);
  const i = nu.indexOf(':');
  const senha = i < 0 ? '' : nu.slice(i + 1);
  return !senha || ehReferencia(senha) ? v : `${q}${nu.slice(0, i)}:${mascarar(senha)}${q}`;
}
export function mascararComando(cmd) {
  return mascararTexto(String(cmd ?? '')
    .replace(RE_ATRIBUICAO, (m, pre, q, nome, sep, v) => (NOME_SENSIVEL.test(nome) ? `${pre}${q}${nome}${q}${sep}${taparValor(v)}` : m))
    .replace(RE_U_COLADO, (m, pre, usuario, senha) => (ehReferencia(senha) ? m : `${pre}-u${usuario}:${mascarar(senha)}`))
    .replace(RE_P_COLADO, (m, pre, v) => (ehReferencia(v) ? m : `${pre}-p${mascarar(v)}`))
    .replace(RE_FLAG, (m, pre, flag, sep, v) => {
      if (sep !== '=' && v.startsWith('-')) return m;
      if (flag === '-u' || flag === '--user') return `${pre}${flag}${sep}${taparUsuarioSenha(v)}`;
      const sensivel = flag === '-p' || NOME_SENSIVEL.test(flag.replace(/^-+/, ''));
      return sensivel ? `${pre}${flag}${sep}${taparValor(v)}` : m;
    })
    .replace(RE_CABECALHO, (m, nome, sep, esquema = '', v) => (ehReferencia(v) ? m : `${nome}${sep}${esquema}${mascarar(v)}`)));
}

const pareceNaoSegredo = v => /^(true|false|yes|no|on|off|null|\d+(\.\d+)?)$/i.test(v)
  || /^(~|\.{1,2})?[\\/]/.test(v) || /^[A-Za-z]:[\\/]/.test(v) || /^https?:\/\/[^@\s]*$/i.test(v);

const literalSensivel = (nome, v) => Boolean(nome) && NOME_SECRETO.test(nome) && v.length >= 6 && !ehReferencia(v) && !pareceNaoSegredo(v);

// Parâmetro de query com nome sensível (?api_key=...) numa URL.
function parametroSensivel(valor) {
  const v = valor.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S*\?/i.test(v)) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  for (const [k, p] of u.searchParams) if (literalSensivel(k, p)) return { tipo: `parâmetro "${k}" na URL`, mascarado: mascarar(p) };
  return null;
}

// Motivo se o valor parece segredo literal (padrão conhecido, URL com credencial ou parâmetro sensível,
// ou valor de um nome sensível); nunca devolve o valor.
function segredoEmValor(nome, valor) {
  if (typeof valor !== 'string') return null;
  const s = acharSegredos(valor);
  if (s.length) return { tipo: s[0].nome, mascarado: s[0].mascarado };
  const u = credencialEmUrl(valor) ?? parametroSensivel(valor);
  if (u) return u;
  const v = valor.trim();
  return literalSensivel(nome, v) ? { tipo: 'valor literal', mascarado: mascarar(semEsquema(v)) } : null;
}

const ehLocal = host => /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|::1)$/i.test(host) || /\.localhost$/i.test(host);
const versaoFixa = pkg => /^(@[^/@]+\/)?[^@/]+@v?\d+\.\d+\.\d+/.test(pkg);

function auditarServidorMcp(nome, srv, onde, brutos) {
  if (!ehTabela(srv)) return;
  const local = `${onde} (mcp ${nome})`;
  const correcaoSegredo = campo => `Mova o valor para uma variável de ambiente e referencie com "\${NOME}" em ${campo}; rotacione a credencial, ela ficou gravada em arquivo.`;
  for (const campo of ['env', 'headers', 'http_headers']) {
    for (const [k, v] of entradas(srv[campo])) {
      const s = segredoEmValor(k, v);
      if (s) brutos.push(novo('alta', 'mcp', local, `segredo:${campo}.${k}`, `MCP "${nome}": ${s.tipo} em ${campo}.${k} (${s.mascarado})`, correcaoSegredo(`${campo}.${k}`)));
    }
  }
  if (typeof srv.bearer_token === 'string' && srv.bearer_token.trim() && !ehReferencia(srv.bearer_token)) {
    brutos.push(novo('alta', 'mcp', local, 'segredo:bearer_token', `MCP "${nome}": token literal em bearer_token (${mascarar(srv.bearer_token)})`,
      'Use bearer_token_env_var com o nome de uma variável de ambiente; rotacione o token.'));
  }
  const args = lista(srv.args).map(a => (typeof a === 'string' ? a : String(a)));
  args.forEach((a, n) => {
    const eq = /^(--?[\w-]+)=(.*)$/s.exec(a);
    const atrib = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(a); // docker -e DB_PASSWORD=...
    const cab = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/s.exec(a); // --header "Authorization: Bearer ..."
    const anterior = n > 0 && FLAG_SECRETA.test(args[n - 1]) && !a.startsWith('-') ? args[n - 1] : null;
    const s = segredoEmValor(null, a)
      ?? (eq && FLAG_SECRETA.test(eq[1]) ? segredoEmValor(eq[1], eq[2]) : null)
      ?? (eq ? segredoEmValor(null, eq[2]) : null) // --url=https://...?token=
      ?? (atrib ? segredoEmValor(atrib[1], atrib[2]) : null)
      ?? (cab ? segredoEmValor(cab[1], cab[2]) : null)
      ?? (anterior ? segredoEmValor(anterior, a) : null);
    if (s) brutos.push(novo('alta', 'mcp', local, `segredo:args[${n}]`, `MCP "${nome}": ${s.tipo} em args[${n}] (${s.mascarado})`, correcaoSegredo(`args[${n}]`)));
  });
  if (typeof srv.url === 'string') {
    const s = segredoEmValor(null, srv.url);
    if (s) brutos.push(novo('alta', 'mcp', local, 'segredo:url', `MCP "${nome}": ${s.tipo} na url (${s.mascarado})`, correcaoSegredo('headers')));
    let u = null;
    try { u = new URL(srv.url); } catch { /* url inválida: a própria ferramenta reclama */ }
    if (u?.protocol === 'http:' && !ehLocal(u.hostname)) {
      brutos.push(novo('media', 'mcp', local, 'http-remoto', `MCP "${nome}" usa http:// sem TLS para ${u.hostname}`,
        'Use https:// (ou um túnel local); por http:// o tráfego e os tokens passam em texto puro.'));
    }
  }
  const cmd = typeof srv.command === 'string' ? basename(srv.command).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase() : '';
  const linha = [cmd, ...args];
  const npx = linha.findIndex(x => /^npx(\.cmd)?$/i.test(x));
  if (npx >= 0) {
    const resto = linha.slice(npx + 1);
    const pkg = resto.find(x => !x.startsWith('-'));
    if (resto.some(x => x === '-y' || x === '--yes') && pkg && !versaoFixa(pkg)) {
      brutos.push(novo('baixa', 'mcp', local, 'npx-sem-versao', `MCP "${nome}" roda "npx -y ${pkg}" sem versão fixa: cada início pode baixar uma versão nova`,
        `Fixe a versão, por exemplo "${pkg.replace(/@[^@/]*$/, '')}@<versão>".`));
    }
  }
}

const servidoresDe = (cfg, chave) => entradas(cfg?.[chave]);

// projects do ~/.claude.json usa "C:/x/y" no Windows; compara com barras normalizadas (e sem caixa no Windows).
const chaveDeProjeto = p => {
  const n = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
};

// --- plugins e marketplaces ---
const OFICIAIS = new Set(['claude-plugins-official']);
function fonteMarketplace(src) {
  if (!ehTabela(src)) return { texto: 'fonte desconhecida', github: false };
  const tipo = src.source ?? '?';
  const alvo = src.repo ?? src.url ?? src.path ?? '';
  const github = tipo === 'github' || (/^(git|url)$/.test(tipo) && /^(https:\/\/|git@)(www\.)?github\.com[/:]/i.test(String(src.url ?? '')));
  return { texto: `${tipo} ${alvo}`.trim(), github };
}

function auditarPlugins(instalados, ondeI, conhecidos, ondeM, brutos) {
  for (const [nome, inst] of entradas(instalados?.plugins ?? instalados)) {
    if (nome === 'version') continue;
    const itens = Array.isArray(inst) ? inst : [inst];
    const desc = itens.filter(ehTabela).map(x => `${x.version ?? '?'} (${x.scope ?? '?'})`).join(', ');
    brutos.push(novo('info', 'plugins', ondeI, `plugin:${nome}`, `plugin "${nome}" instalado: ${desc || 'sem detalhes'}`,
      'Só inventário: desinstale o que você não usa ou não reconhece.'));
  }
  for (const [nome, m] of entradas(conhecidos)) {
    const f = fonteMarketplace(m?.source);
    brutos.push(novo('info', 'plugins', ondeM, `marketplace:${nome}`, `marketplace "${nome}": ${f.texto}`,
      'Só inventário: remova marketplaces que você não reconhece.'));
    if (!f.github && !OFICIAIS.has(nome)) {
      brutos.push(novo('baixa', 'plugins', ondeM, `marketplace-fonte:${nome}`, `marketplace "${nome}" vem de fora do GitHub (${f.texto})`,
        'Confirme que você confia nessa fonte; plugins dela rodam hooks e comandos na sua máquina.'));
    }
  }
}

// --- git: .env versionado e segredos no histórico ---
// Executáveis nunca são procurados na pasta do projeto: o cwd do processo é a raiz do nabuco (o repo
// vai por -C) e, no Windows, NoDefaultCurrentDirectoryInExePath tira a pasta atual da busca.
export const RAIZ_NABUCO = fileURLToPath(new URL('../..', import.meta.url));
export const envSeguro = () => ({ ...process.env, NoDefaultCurrentDirectoryInExePath: '1' });
export const opcoesGit = () => ({ cwd: RAIZ_NABUCO, env: envSeguro(), encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
// Só nomes com estes caracteres viram comando pronto (entre aspas simples, sem escape, valem em POSIX e
// PowerShell); qualquer outro (aspas, inclusive tipográficas, ;, $, espaço...) é "nome de arquivo suspeito".
export const caminhoSeguro = s => /^[A-Za-z0-9._/@+-]+$/.test(String(s));

// A config do repositório não executa nada: sem fsmonitor e sem verificação de assinatura (gpg.program).
export const argsGit = (projeto, args) => ['-C', projeto, '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args];

export const gitPadrao = projeto => args => {
  const r = spawnSync('git', argsGit(projeto, args), opcoesGit());
  const erro = r.error ? r.error.message : r.status !== 0 ? (r.stderr || '').trim() || `git saiu com ${r.status}` : null;
  return { status: r.status, stdout: r.stdout ?? '', erro, codigo: r.error?.code ?? null };
};

const ENV_EXEMPLO = /\.(example|sample|template)$/i;

function auditarGit(git, maxCommits, brutos) {
  const repo = git(['rev-parse', '--is-inside-work-tree']);
  if (repo.erro) {
    if (/not a git repository/i.test(repo.erro)) {
      brutos.push(novo('info', 'git', '.', 'sem-git', 'o projeto não é um repositório git: .env versionado e segredos no histórico não foram verificados', ''));
    } else {
      brutos.push(novo('media', 'git', '.', 'git-falhou', `git falhou (${curto(repo.erro, 200)}): .env versionado e histórico não verificados`,
        'Confira se o git está instalado e se o repositório abre (ex.: safe.directory), e rode o vigia de novo.'));
    }
    return;
  }

  const ls = git(['ls-files', '-z']);
  if (ls.erro) {
    brutos.push(novo('media', 'env-versionado', '.', 'git-falhou', `.env versionado não verificado: git ls-files falhou (${curto(ls.erro, 200)})`, 'Rode o vigia de novo.'));
  } else {
    for (const arq of ls.stdout.split('\0').filter(Boolean)) {
      const nome = basename(arq);
      if (!/^\.env/i.test(nome) || ENV_EXEMPLO.test(nome)) continue;
      const rotacione = 'adicione-o ao .gitignore e rotacione os segredos que estiveram nele (continuam no histórico).';
      brutos.push(caminhoSeguro(arq)
        ? novo('alta', 'env-versionado', arq, 'env-versionado', `${arq} está versionado no git (arquivo .env costuma ter segredos)`,
          `Tire do índice com git rm --cached -- '${arq}', ${rotacione}`)
        : novo('alta', 'env-versionado', arq, 'env-versionado', `${JSON.stringify(arq)} está versionado no git (arquivo .env costuma ter segredos); nome de arquivo suspeito: não monte comando com ele`,
          `Não cole o nome no shell: grave o caminho exato (de "git ls-files -z") num arquivo com a ferramenta de escrita, não pelo shell, e rode git rm --cached --pathspec-from-file=<arquivo> --pathspec-file-nul; depois ${rotacione}`));
    }
  }

  // --cc inclui os merges (diff combinado: só o que o merge trouxe de novo, como resolução de conflito).
  const log = git(['log', '-p', '--cc', '--all', `--max-count=${maxCommits}`, '--format=%x00%h', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0']);
  if (log.erro) {
    const grande = log.codigo === 'ENOBUFS' || /ENOBUFS|maxBuffer/i.test(log.erro);
    brutos.push(novo('media', 'segredo-historico', '.', 'git-falhou',
      grande ? 'segredos no histórico não verificados: a saída do git log passou do limite' : `segredos no histórico não verificados: git log falhou (${curto(log.erro, 200)})`,
      grande ? 'Rode de novo com --max-commits menor.' : 'Confira o repositório e rode o vigia de novo.'));
    return;
  }
  // Diff comum: 1 coluna de prefixo (+/-/espaço) e "@@"; combinado (merge): uma coluna por pai e "@@@".
  let commit = null, arquivo = null, cabecalho = false, n = 0, commits = 0, colunas = 1;
  for (const bruta of log.stdout.split('\n')) {
    const l = bruta.endsWith('\r') ? bruta.slice(0, -1) : bruta;
    if (l.startsWith('\0')) { commit = l.slice(1).trim(); arquivo = null; cabecalho = false; commits++; continue; }
    if (/^diff (--git|--cc|--combined) /.test(l)) { arquivo = null; cabecalho = true; continue; }
    const hunk = /^(@{2,}) .*? \+(\d+)(?:,\d+)? \1/.exec(l);
    if (cabecalho) {
      if (l.startsWith('+++ ')) {
        let p = l.slice(4).replace(/\t$/, ''); // git põe TAB no fim de caminho com espaço
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        arquivo = p === '/dev/null' ? null : p.replace(/^b\//, '');
      } else if (hunk) cabecalho = false;
      if (cabecalho) continue;
    }
    if (hunk) { colunas = hunk[1].length - 1; n = Number(hunk[2]); continue; }
    if (!arquivo) continue;
    const prefixo = l.slice(0, colunas);
    if (prefixo.includes('-')) continue; // linha só do lado antigo
    if (prefixo.includes('+')) {
      for (const s of acharSegredos(l.slice(colunas))) {
        brutos.push(novo('alta', 'segredo-historico', `${arquivo}:${n} (commit ${commit})`, s.nome, `${s.nome} adicionada no histórico do git: ${s.mascarado}`,
          'Rotacione a credencial no provedor (revogue e gere outra): apagar o arquivo não basta, o valor continua no histórico. Não reescreva o histórico sem combinar com o time.'));
      }
      n++;
    } else if (prefixo.length === colunas && /^ +$/.test(prefixo)) n++;
  }
  if (commits >= maxCommits) {
    brutos.push(novo('info', 'segredo-historico', '.', 'limite-commits', `histórico verificado só nos ${maxCommits} commits mais recentes`,
      'Para ver mais, rode com --max-commits maior.'));
  }
}

// --- ponto de entrada ---
// `homeClaude`: pasta de config do Claude (~/.claude); `claudeJson`: ~/.claude.json; `homeCodex`: ~/.codex.
// `homeUsuario` só serve para abreviar caminhos como "~/..." nos achados.
export function auditarAmbiente({ projeto, homeClaude, claudeJson, homeCodex, git, maxCommits = MAX_COMMITS, homeUsuario = null }) {
  const brutos = [];
  const proj = resolve(projeto);
  const rotulo = arq => {
    const a = resolve(arq);
    const rp = relative(proj, a);
    if (rp && !rp.startsWith('..') && !isAbsolute(rp)) return rp.replace(/\\/g, '/');
    if (homeUsuario) {
      const rh = relative(resolve(homeUsuario), a);
      if (rh && !rh.startsWith('..') && !isAbsolute(rh)) return `~/${rh.replace(/\\/g, '/')}`;
    }
    return a;
  };
  const ler = (arq, tipo = 'json') => ({ cfg: lerConfig(arq, rotulo(arq), tipo, brutos), onde: rotulo(arq) });

  // Claude: settings global e do projeto (sem repetir quando o projeto é a própria home).
  const settings = [join(homeClaude, 'settings.json')];
  const dirClaudeProj = join(proj, '.claude');
  if (existsSync(dirClaudeProj)) {
    for (const f of readdirSync(dirClaudeProj).filter(f => /^settings.*\.json$/.test(f)).sort()) settings.push(join(dirClaudeProj, f));
  }
  for (const arq of [...new Set(settings.map(s => resolve(s)))]) {
    const { cfg, onde } = ler(arq);
    auditarPermissoesClaude(cfg, onde, brutos);
    auditarHooks(cfg, onde, brutos);
  }

  // MCPs: .mcp.json do projeto, ~/.claude.json (global e deste projeto) e Codex.
  const mcp = ler(join(proj, '.mcp.json'));
  for (const [nome, srv] of servidoresDe(mcp.cfg, 'mcpServers')) auditarServidorMcp(nome, srv, mcp.onde, brutos);
  if (claudeJson) {
    const cj = ler(claudeJson);
    for (const [nome, srv] of servidoresDe(cj.cfg, 'mcpServers')) auditarServidorMcp(nome, srv, cj.onde, brutos);
    const doProjeto = entradas(cj.cfg?.projects).find(([k]) => chaveDeProjeto(k) === chaveDeProjeto(proj))?.[1];
    for (const [nome, srv] of servidoresDe(doProjeto, 'mcpServers')) auditarServidorMcp(nome, srv, `${cj.onde} › projects`, brutos);
  }
  if (homeCodex) {
    const cx = ler(join(homeCodex, 'config.toml'), 'toml');
    auditarPermissoesCodex(cx.cfg, cx.onde, brutos);
    for (const [nome, srv] of servidoresDe(cx.cfg, 'mcp_servers')) auditarServidorMcp(nome, srv, cx.onde, brutos);
  }

  // Plugins e marketplaces do Claude.
  const ip = ler(join(homeClaude, 'plugins', 'installed_plugins.json'));
  const km = ler(join(homeClaude, 'plugins', 'known_marketplaces.json'));
  auditarPlugins(ip.cfg, ip.onde, km.cfg, km.onde, brutos);

  auditarGit(git ?? gitPadrao(proj), maxCommits, brutos);
  return { achados: finalizar(brutos) };
}

// --- deps: vulnerabilidades conhecidas nas dependências ---
// npm via "npm audit --json" (com package-lock.json/npm-shrinkwrap.json); o resto via OSV querybatch.
// Rede, comando, JSON ou dependência que não dá para conferir viram "nao_verificado" (media), nunca
// "sem vulnerabilidades".
export const OSV = 'https://api.osv.dev/v1';
const LOTE_OSV = 1000;
const DIA = 24 * 3600 * 1000;
const SEV_DEPS = { critical: 'alta', high: 'alta', moderate: 'media', medium: 'media', low: 'baixa', info: 'info' };
const sevDeps = s => SEV_DEPS[String(s ?? '').toLowerCase()] ?? 'media';
const normPy = s => s.toLowerCase().replace(/[-_.]+/g, '-');
const dentroDe = (pai, filho) => {
  const r = relative(resolve(pai), resolve(filho));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

export const fetchPadrao = (url, opcoes = {}) => fetch(url, { ...opcoes, signal: AbortSignal.timeout(15000) });

// npm-cli.js fora da pasta do projeto: o que acompanha o Node (Windows: <node>/node_modules/npm; Unix:
// <prefixo>/lib/node_modules/npm) ou, em diretórios absolutos do PATH fora do projeto, o mesmo layout.
// Roda com o próprio Node, sem shell: um npm/npm.cmd plantado no projeto nunca é executado.
export function acharNpmCli({ projeto, execPath = process.execPath, caminhos = process.env.PATH ?? '', separador = process.platform === 'win32' ? ';' : ':' } = {}) {
  const rel = ['node_modules', 'npm', 'bin', 'npm-cli.js'];
  const dirs = [dirname(execPath), ...caminhos.split(separador).filter(d => d && isAbsolute(d))];
  for (const d of dirs) {
    for (const c of [join(d, ...rel), join(d, '..', 'lib', ...rel)]) {
      const r = resolve(c);
      if (projeto && (dentroDe(projeto, d) || dentroDe(projeto, r))) continue;
      if (existsSync(r)) return r;
    }
  }
  return null;
}

export const runnerPadrao = (cmd, args, { cwd }) => {
  const vazio = { status: null, stdout: '', stderr: '' };
  if (cmd !== 'npm') return { ...vazio, erro: `comando não suportado: ${cmd}` };
  const cli = acharNpmCli({ projeto: cwd });
  if (!cli) return { ...vazio, erro: 'npm não encontrado fora da pasta do projeto (npm-cli.js junto do Node ou no PATH); npm.cmd não é usado porque exigiria shell' };
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: envSeguro(), encoding: 'utf8', timeout: 180000, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', erro: r.error ? r.error.message : null };
};

const naoVerificado = (arquivo, motivo) => ({
  ...novo('media', 'nao_verificado', arquivo, mascararTexto(motivo),
    `${arquivo}: dependências não verificadas (${curto(mascararTexto(motivo), 200)})`,
    'Rode o vigia de novo com rede e com as ferramentas disponíveis (e fixe as versões com ==); até lá, trate essas dependências como não verificadas.'),
  arquivos: [arquivo],
});
const vulnerabilidade = ({ adv, nome, versoes, arquivos, sev, titulo, correcao }) => ({
  ...novo(sevDeps(sev), 'vulnerabilidade', `${nome}@${[...versoes].join(', ') || '?'} (${[...arquivos].join(', ')})`, adv,
    `${adv} em ${nome}: ${curto(String(titulo || 'vulnerabilidade conhecida').split('\n')[0], 140)}`, correcao || `verifique o advisory ${adv}`),
  id: `${adv}:${nome}`,
  arquivos: [...arquivos],
});

// --- leitura dos lockfiles ---
// Cada parser devolve { pacotes: [{ nome, versao }], ignoradas, entradas }: `ignoradas` são dependências
// que o vigia não consegue conferir (sem versão fixa, git, URL, -r); `entradas` conta tudo que reconheceu
// (inclusive pacotes locais, que não são dependência de terceiros).
function pacotesRequirements(t) {
  const out = { pacotes: [], ignoradas: 0, entradas: 0 };
  for (const bruta of t.replace(/\\\n/g, ' ').split('\n')) {
    const l = bruta.replace(/(^|\s)#.*$/, '').trim();
    if (!l) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==(?!=)\s*([^\s;,\\]+)\s*(;.*)?(\s--hash\S*)*\s*$/.exec(l);
    if (m && !m[2].includes('*')) { out.pacotes.push({ nome: m[1], versao: m[2] }); out.entradas++; continue; }
    if (/^-(c|-constraint|i|-index-url|-extra-index-url|f|-find-links|-trusted-host|-no-binary|-only-binary|-prefer-binary|-pre|-require-hashes|-use-feature)\b/.test(l)) continue;
    out.ignoradas++; out.entradas++; // >=, ~=, sem versão, -r, -e, URL, caminho
  }
  return out;
}
function pacotesToml(t, ehLocal, ehRegistro) {
  const out = { pacotes: [], ignoradas: 0, entradas: 0 };
  for (const p of lista(lerToml(t).package)) {
    if (!ehTabela(p) || !p.name) continue;
    out.entradas++;
    if (ehLocal(p)) continue;
    if (ehRegistro(p) && p.version) out.pacotes.push({ nome: p.name, versao: String(p.version) });
    else out.ignoradas++;
  }
  return out;
}
const pacotesPoetry = t => pacotesToml(t, p => ['directory', 'file'].includes(p.source?.type), p => !['git', 'url'].includes(p.source?.type));
const pacotesCargo = t => pacotesToml(t, p => !p.source, p => /^(registry|sparse)\+/.test(p.source));
function pacotesGoMod(t) {
  const out = { pacotes: [], ignoradas: 0, entradas: 0 };
  const add = s => {
    const [nome, ver] = s.trim().split(/\s+/);
    if (!nome) return;
    out.entradas++;
    if (/^v\d/.test(ver ?? '')) out.pacotes.push({ nome, versao: ver.replace(/^v/, '').replace(/\+incompatible$/, '') });
    else out.ignoradas++;
  };
  let bloco = null;
  for (const bruta of t.split('\n')) {
    const l = bruta.replace(/\/\/.*$/, '').trim();
    if (!l) continue;
    if (bloco) {
      if (l === ')') bloco = null;
      else if (bloco === 'require') add(l);
      continue;
    }
    const b = /^(require|replace|exclude|retract|tool|godebug)\s*\($/.exec(l);
    if (b) { bloco = b[1]; continue; }
    const r = /^require\s+(.+)$/.exec(l);
    if (r) add(r[1]);
  }
  return out;
}
// pnpm: chaves de "packages:" nos formatos v5 (/nome/1.0.0_peer), v6 (/nome@1.0.0(peer)) e v9 (nome@1.0.0).
function pacotesPnpm(t) {
  const out = { pacotes: [], ignoradas: 0, entradas: 0 };
  let dentro = false;
  for (const l of t.split('\n')) {
    if (/^\S/.test(l)) { dentro = /^packages:\s*$/.test(l); continue; }
    if (!dentro) continue;
    const m = /^ {2}(\S.*?):(\s|$)/.exec(l);
    if (!m) continue;
    out.entradas++;
    const k = m[1].replace(/^['"]|['"]$/g, '').replace(/^\//, '').replace(/\(.*$/, '');
    let nome, versao;
    const v5 = /^((?:@[^/]+\/)?[^/@]+)\/(\d[^_/]*)/.exec(k);
    if (v5) [, nome, versao] = v5;
    else {
      const at = k.lastIndexOf('@');
      if (at > 0) { nome = k.slice(0, at); versao = k.slice(at + 1); }
    }
    if (nome && /^\d/.test(versao)) out.pacotes.push({ nome, versao });
    else if (!/@(link|file|workspace):/.test(k)) out.ignoradas++;
  }
  return out;
}
// yarn: v1 (version "1.0.0") e berry (version: 1.0.0); workspaces e links (locais) ficam de fora.
function pacotesYarn(t) {
  const out = { pacotes: [], ignoradas: 0, entradas: 0 };
  let nome = null, pendente = false;
  const fechar = () => { if (pendente) out.ignoradas++; pendente = false; };
  for (const l of t.split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue;
    if (!/^\s/.test(l)) {
      fechar();
      nome = null;
      const spec = l.replace(/:\s*$/, '').split(',')[0].trim().replace(/^"|"$/g, '');
      if (spec === '__metadata') continue;
      out.entradas++;
      if (/@(workspace|link|file|portal):/.test(spec)) continue;
      const at = spec.indexOf('@', 1);
      if (at > 0) { nome = spec.slice(0, at); pendente = true; } else out.ignoradas++;
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(l);
    if (v && nome) {
      if (/^\d/.test(v[1]) && !/use\.local/.test(v[1])) out.pacotes.push({ nome, versao: v[1] });
      else out.ignoradas++;
      nome = null; pendente = false;
    }
  }
  fechar();
  return out;
}

const FONTES_OSV = [
  ['requirements.txt', 'PyPI', pacotesRequirements],
  ['poetry.lock', 'PyPI', pacotesPoetry],
  ['Cargo.lock', 'crates.io', pacotesCargo],
  ['go.mod', 'Go', pacotesGoMod],
  ['pnpm-lock.yaml', 'npm', pacotesPnpm],
  ['yarn.lock', 'npm', pacotesYarn],
];
const LOCKS_NPM = ['package-lock.json', 'npm-shrinkwrap.json'];
const temConteudo = t => t.split('\n').some(l => l.trim() && !/^\s*#/.test(l));

// Fontes para o OSV, o lockfile do npm audit (se houver), todos os lockfiles achados (`arquivos`, até os
// ilegíveis) e achados de leitura (ilegível, versão não fixada, nada reconhecido → nao_verificado).
export function listarPacotes(projeto) {
  const brutos = [], fontes = [], arquivos = [];
  const npmAudit = LOCKS_NPM.find(f => existsSync(join(projeto, f))) ?? null;
  if (npmAudit) arquivos.push(npmAudit);
  for (const [arquivo, ecossistema, extrair] of FONTES_OSV) {
    if (npmAudit && ecossistema === 'npm') continue; // o npm audit já cobre o npm
    const f = join(projeto, arquivo);
    if (!existsSync(f)) continue;
    arquivos.push(arquivo);
    let texto, lido;
    try {
      texto = readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
      lido = extrair(texto);
    } catch (e) {
      brutos.push(naoVerificado(arquivo, e.code ? `não consegui ler (${e.code})` : /^TOML inválido/.test(e.message) ? e.message : 'arquivo ilegível'));
      continue;
    }
    const vistos = new Set();
    const pacotes = lido.pacotes.filter(p => !vistos.has(`${p.nome}@${p.versao}`) && vistos.add(`${p.nome}@${p.versao}`));
    fontes.push({ arquivo, ecossistema, pacotes });
    if (lido.ignoradas) {
      brutos.push(naoVerificado(arquivo, `${lido.ignoradas} dependência(s) sem versão fixa, de git/URL ou de outro arquivo (-r) ficaram de fora; o vigia só confere versões exatas`));
    } else if (!lido.entradas && temConteudo(texto)) {
      brutos.push(naoVerificado(arquivo, 'nenhuma dependência reconhecida no arquivo'));
    }
  }
  const temLockNpm = npmAudit || fontes.some(f => f.ecossistema === 'npm');
  const pj = join(projeto, 'package.json');
  if (!temLockNpm && existsSync(pj)) {
    try {
      const j = lerJson(pj);
      const n = ['dependencies', 'devDependencies', 'optionalDependencies'].reduce((s, k) => s + Object.keys(ehTabela(j?.[k]) ? j[k] : {}).length, 0);
      if (n) {
        brutos.push(novo('info', 'deps', 'package.json', 'sem-lockfile', `package.json tem ${n} dependência(s) e está sem lockfile: dependências npm não verificadas`,
          'Gere e versione um lockfile (npm install cria o package-lock.json) para o vigia conseguir checar.'));
      }
    } catch { brutos.push(naoVerificado('package.json', 'package.json ilegível')); }
  }
  return { fontes, brutos, npmAudit, arquivos };
}

// npm audit sai 1 quando acha vulnerabilidade: vale o JSON, não o código de saída.
export function auditarNpm(projeto, runner = runnerPadrao) {
  const arquivo = LOCKS_NPM.find(f => existsSync(join(projeto, f))) ?? 'package-lock.json';
  const falha = motivo => [naoVerificado(arquivo, `npm audit: ${motivo}`)];
  let r;
  try { r = runner('npm', ['audit', '--json'], { cwd: projeto }); } catch (e) { return falha(e.message); }
  if (r.erro) return falha(r.erro);
  let j;
  try { j = JSON.parse(r.stdout); } catch { return falha(`saída sem JSON válido (código ${r.status})`); }
  if (j?.error) return falha(`${j.error.code ?? 'erro'}: ${j.error.summary ?? ''}`.trim());
  let lock = {};
  try { lock = lerJson(join(projeto, arquivo)); } catch { /* sem versões: aparecem como "?" */ }
  const out = [];
  if (ehTabela(j?.vulnerabilities)) { // npm 7+
    for (const [nome, v] of entradas(j.vulnerabilities)) {
      const versoes = [...new Set(lista(v.nodes).map(n => lock?.packages?.[n]?.version).filter(Boolean))];
      const fa = v.fixAvailable;
      const correcao = ehTabela(fa) ? `atualize ${fa.name} para ${fa.version}${fa.isSemVerMajor ? ' (versão major: pode quebrar compatibilidade)' : ''}`
        : fa === true ? 'rode "npm audit fix" (há versão corrigida compatível)' : null;
      for (const via of lista(v.via)) {
        if (!ehTabela(via)) continue; // string = vem de outro pacote, que tem o próprio achado
        const adv = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? `npm-${via.source ?? '?'}`;
        out.push(vulnerabilidade({ adv, nome: via.name ?? nome, versoes, arquivos: [arquivo], sev: via.severity, titulo: via.title, correcao }));
      }
    }
    return out;
  }
  if (ehTabela(j?.advisories)) { // npm 6
    for (const a of Object.values(j.advisories)) {
      const adv = a.github_advisory_id ?? /GHSA-[\w-]+/.exec(a.url ?? '')?.[0] ?? `npm-${a.id}`;
      const corrigida = a.patched_versions && a.patched_versions !== '<0.0.0' ? `atualize ${a.module_name} para ${a.patched_versions}` : null;
      out.push(vulnerabilidade({ adv, nome: a.module_name, versoes: [...new Set(lista(a.findings).map(f => f.version))], arquivos: [arquivo], sev: a.severity, titulo: a.title, correcao: corrigida }));
    }
    return out;
  }
  return falha('JSON sem "vulnerabilities" nem "advisories"');
}

async function emParalelo(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) await fn(itens[i++]); }));
}
// GHSA primeiro: entre aliases da mesma falha, o id reportado é sempre o mesmo.
const ordemAdvisory = (a, b) => (b.startsWith('GHSA-') - a.startsWith('GHSA-')) || a.localeCompare(b);

function detalheDoPacote(d, nome, eco) {
  const norm = s => (eco === 'PyPI' ? normPy(String(s)) : String(s));
  const af = lista(d.affected).filter(a => a?.package?.ecosystem === eco && norm(a.package.name) === norm(nome));
  const sev = d.database_specific?.severity ?? af.map(a => a.ecosystem_specific?.severity ?? a.database_specific?.severity).find(Boolean);
  const fixed = [...new Set((af.length ? af : lista(d.affected)).flatMap(a => lista(a?.ranges).flatMap(r => lista(r?.events).map(e => e?.fixed).filter(Boolean))))];
  return { sev, fixed, titulo: d.summary || String(d.details ?? '').trim() };
}

// Um achado por advisory e pacote: versões e arquivos do mesmo pacote se juntam no `onde`, e um id
// que é alias de outro já reportado (em qualquer sentido) não vira achado novo.
export async function auditarOsv(fontes, fetchar = fetchPadrao) {
  const brutos = [];
  const consultas = fontes.flatMap(f => f.pacotes.map(p => ({ fonte: f, p })));
  if (!consultas.length) return brutos;
  const pedir = async (url, opcoes) => {
    const r = await fetchar(url, opcoes);
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    try { return JSON.parse(texto); } catch { throw new Error('resposta sem JSON válido'); }
  };
  const falhaTodas = motivo => {
    for (const f of fontes) if (f.pacotes.length) brutos.push(naoVerificado(f.arquivo, `OSV: ${motivo}`));
    return brutos;
  };

  const resultados = [];
  for (let i = 0; i < consultas.length; i += LOTE_OSV) {
    const lote = consultas.slice(i, i + LOTE_OSV);
    let j;
    try {
      j = await pedir(`${OSV}/querybatch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries: lote.map(c => ({ package: { name: c.p.nome, ecosystem: c.fonte.ecossistema }, version: c.p.versao })) }),
      });
    } catch (e) { return falhaTodas(e.message); }
    if (!Array.isArray(j?.results) || j.results.length !== lote.length) return falhaTodas('resposta incompleta');
    lote.forEach((c, n) => {
      const res = ehTabela(j.results[n]) ? j.results[n] : {};
      if (res.next_page_token) brutos.push(naoVerificado(c.fonte.arquivo, `OSV: lista de ${c.p.nome} veio paginada e ficou incompleta`));
      resultados.push({ ...c, ids: lista(res.vulns).map(v => v?.id).filter(x => typeof x === 'string').sort(ordemAdvisory) });
    });
  }

  const detalhes = new Map();
  await emParalelo([...new Set(resultados.flatMap(r => r.ids))], 8, async id => {
    try { detalhes.set(id, await pedir(`${OSV}/vulns/${encodeURIComponent(id)}`)); } catch { /* fica sem detalhe: tratado abaixo */ }
  });
  const pacotes = new Map(); // ecossistema|nome → { dono: id/alias → item, itens: [] }
  for (const { fonte, p, ids } of resultados) {
    const chave = `${fonte.ecossistema}|${fonte.ecossistema === 'PyPI' ? normPy(p.nome) : p.nome}`;
    if (!pacotes.has(chave)) pacotes.set(chave, { dono: new Map(), itens: [] });
    const g = pacotes.get(chave);
    for (const id of ids) {
      const d = detalhes.get(id);
      const nomes = [id, ...lista(d?.aliases).filter(a => typeof a === 'string')];
      let item = nomes.map(x => g.dono.get(x)).find(Boolean);
      if (!item) {
        if (!d) brutos.push(naoVerificado(fonte.arquivo, `OSV: detalhes de ${id} não carregaram`));
        const det = d ? detalheDoPacote(d, p.nome, fonte.ecossistema) : { sev: null, fixed: [], titulo: 'detalhes indisponíveis no OSV' };
        item = { adv: id, nome: p.nome, versoes: new Set(), arquivos: new Set(), ...det };
        g.itens.push(item);
      }
      item.versoes.add(p.versao);
      item.arquivos.add(fonte.arquivo);
      for (const x of nomes) if (!g.dono.has(x)) g.dono.set(x, item);
    }
  }
  for (const g of pacotes.values()) {
    for (const it of g.itens) {
      const correcao = it.fixed.length ? `atualize ${it.nome} para ${it.fixed.slice(0, 3).join(' ou ')} (ou mais nova)` : null;
      brutos.push(vulnerabilidade({ adv: it.adv, nome: it.nome, versoes: it.versoes, arquivos: it.arquivos, sev: it.sev, titulo: it.titulo, correcao }));
    }
  }
  return brutos;
}

// --- cache (.nabuco/vigia/deps.json): datas, hashes dos lockfiles e ids; nada sensível ---
// { verificado_em, ids: [...todas], fontes: { <lockfile>: { hash, verificado_em, ids } } }
export const arquivoCacheDeps = projeto => join(dirProjeto(projeto), 'vigia', 'deps.json');
export function hashArquivo(caminho) {
  try { return createHash('sha256').update(readFileSync(caminho)).digest('hex').slice(0, 16); } catch { return null; }
}

export function lerCacheDeps(projeto) {
  const f = arquivoCacheDeps(projeto);
  if (!existsSync(f)) return { cache: null, erro: null };
  try {
    const c = lerJson(f);
    if (typeof c?.verificado_em !== 'string' || Number.isNaN(Date.parse(c.verificado_em)) || !Array.isArray(c.ids)) throw new Error('formato');
    if (!ehTabela(c.fontes)) c.fontes = {};
    return { cache: c, erro: null };
  } catch {
    return { cache: null, erro: 'cache .nabuco/vigia/deps.json ilegível; mostrando todos os achados' };
  }
}

export function gravarCacheDeps(projeto, cache) {
  if (ehPastaGlobal(dirProjeto(projeto))) throw new Error('esta pasta é a pasta global do nabuco; cache não gravado');
  mkdirSync(join(dirProjeto(projeto), 'vigia'), { recursive: true });
  escreverJson(arquivoCacheDeps(projeto), cache);
}

// `novos`: lockfile com o mesmo hash verificado há menos de 24h não é checado de novo (todos assim →
// `recente`, nada roda); do resto mostra só vulnerabilidades fora do cache, e nao_verificado sempre.
// O cache grava, por lockfile, só os que foram verificados por completo (sem nao_verificado).
export async function verificarDeps({ projeto, novos = false, agora = new Date(), runner = runnerPadrao, fetch: fetchar = fetchPadrao }) {
  const { cache, erro: avisoCache } = lerCacheDeps(projeto);
  const lido = listarPacotes(projeto);
  if (!lido.arquivos.length) {
    const achados = finalizar(lido.brutos);
    return { semFontes: true, achados, total: achados.length, fontes: [], pulados: [], cacheGravado: false, avisoCache };
  }
  const hashes = Object.fromEntries(lido.arquivos.map(a => [a, hashArquivo(join(projeto, a))]));
  const fresco = arq => {
    const c = novos ? cache?.fontes?.[arq] : null;
    const idade = c ? agora - Date.parse(c.verificado_em) : NaN;
    return Boolean(c && hashes[arq] && c.hash === hashes[arq] && idade >= 0 && idade < DIA);
  };
  const pulados = lido.arquivos.filter(fresco);
  if (pulados.length === lido.arquivos.length) {
    const maisAntigo = pulados.map(a => cache.fontes[a].verificado_em).sort()[0];
    return { recente: true, verificado_em: maisAntigo, idade: agora - Date.parse(maisAntigo), achados: [], pulados, avisoCache };
  }

  const brutos = lido.brutos.filter(b => !b.arquivos?.some(fresco));
  const fontesOsv = lido.fontes.filter(f => !fresco(f.arquivo));
  const rodarNpm = lido.npmAudit && !fresco(lido.npmAudit);
  if (rodarNpm) brutos.push(...auditarNpm(projeto, runner));
  brutos.push(...await auditarOsv(fontesOsv, fetchar));
  const resumoFontes = [
    ...(rodarNpm ? [{ arquivo: lido.npmAudit, ecossistema: 'npm', via: 'npm audit' }] : []),
    ...fontesOsv.map(f => ({ arquivo: f.arquivo, ecossistema: f.ecossistema, via: 'OSV', pacotes: f.pacotes.length })),
  ];

  // Cache por lockfile: grava os verificados por completo; tira os que sumiram; o resto fica como estava.
  const checados = lido.arquivos.filter(a => !fresco(a));
  const comFalha = new Set(brutos.filter(b => b.categoria === 'nao_verificado').flatMap(b => b.arquivos));
  const ok = checados.filter(a => !comFalha.has(a) && hashes[a]);
  const novasFontes = Object.fromEntries(Object.entries(cache?.fontes ?? {}).filter(([a]) => lido.arquivos.includes(a)));
  for (const a of ok) {
    const ids = brutos.filter(b => b.categoria === 'vulnerabilidade' && b.arquivos.includes(a)).map(b => b.id);
    novasFontes[a] = { hash: hashes[a], verificado_em: agora.toISOString(), ids: [...new Set(ids)].sort() };
  }
  let cacheGravado = false, avisoGravar = null;
  if (ok.length) {
    try {
      const ids = [...new Set(Object.values(novasFontes).flatMap(f => lista(f.ids)))].sort();
      gravarCacheDeps(projeto, { verificado_em: agora.toISOString(), ids, fontes: novasFontes });
      cacheGravado = true;
    } catch (e) { avisoGravar = `cache não gravado (${e.message})`; }
  }

  const todos = finalizar(brutos);
  const conhecidos = novos && cache ? new Set(cache.ids) : null;
  const achados = conhecidos ? todos.filter(a => a.categoria !== 'vulnerabilidade' || !conhecidos.has(a.id)) : todos;
  const pacotesVerificados = fontesOsv.filter(f => !comFalha.has(f.arquivo)).reduce((s, f) => s + f.pacotes.length, 0);
  return {
    achados, total: todos.length, fontes: resumoFontes, pulados, cacheGravado, avisoCache: avisoCache ?? avisoGravar,
    algoVerificado: pacotesVerificados > 0 || Boolean(rodarNpm && !comFalha.has(lido.npmAudit)),
  };
}
