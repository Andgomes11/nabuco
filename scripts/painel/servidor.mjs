#!/usr/bin/env node
// Painel do nabuco: servidor local somente leitura (127.0.0.1 + chave aleatória na URL).
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, watch } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { nabucoHome, acharProjeto, lerAtiva, dirProjeto } from '../lib/caminhos.mjs';
import { lerJson } from '../lib/json.mjs';
import { lerHistorico, calcularMetricas } from '../lib/metricas.mjs';
import { carregarModelos } from '../lib/modelos.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { montarEstado, FUNCIONARIOS } from '../lib/painel-estado.mjs';
import { montarDossie } from '../lib/dossie.mjs';

const RAIZ_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), 'publico');

const TEXTO_JS = 'text/javascript; charset=utf-8';
// lista fixa: nada fora dela é servido de publico/
const ESTATICOS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/estilo.css', ['estilo.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', TEXTO_JS]],
  ['/modelo.mjs', ['modelo.mjs', TEXTO_JS]],
]);
const RE_AVATAR = /^[a-z]+-[1-4]\.jpg$/;
const PAPEL_SET = new Set(FUNCIONARIOS);

const SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
};

const DEBOUNCE = 250;
const POLL = 1000;
const PING = 15000;
const LIMITE_FILA = 1024 * 1024; // cliente SSE que não lê: acima disso na fila, é desconectado
const RECALCULO = 30; // a cada 30 verificações sem mudança, recalcula (expiração de 30 min depende do relógio)

function nomesDe(raiz) {
  const nomes = { gerente: 'Gerente' };
  for (const papel of FUNCIONARIOS) {
    if (papel === 'gerente') continue;
    try {
      const { dados } = parseFrontmatter(readFileSync(join(raiz, 'papeis', `${papel}.md`), 'utf8'));
      if (typeof dados.nome === 'string' && dados.nome) nomes[papel] = dados.nome;
    } catch { /* sem arquivo ou frontmatter inválido: usa o papel */ }
  }
  return nomes;
}

function avataresDe(raiz) {
  try { return new Set(readdirSync(join(raiz, 'assets', 'avatares')).filter(n => RE_AVATAR.test(n))); } catch { return new Set(); }
}

function lerEventosJsonl(arq) {
  if (!existsSync(arq)) return [];
  const evs = [];
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    if (!linha.trim()) continue;
    try { const e = JSON.parse(linha); if (e && typeof e === 'object' && !Array.isArray(e)) evs.push(e); } catch { /* ignora */ }
  }
  return evs;
}

// tarefa ativa para o montarEstado. Falha de leitura (arquivo sendo regravado) mantém a última leitura boa
// da MESMA tarefa; sem leitura boa dela = sem tarefa.
function leitorTarefa(projeto) {
  let boa = null;
  return () => {
    let ativa;
    try { ativa = lerAtiva(projeto); } catch { return null; }
    if (!ativa) { boa = null; return null; }
    try {
      boa = {
        nome: ativa.nome,
        estado: lerJson(join(ativa.dir, 'estado.json')),
        // sem criterios.json ainda (tarefa no começo): gate "nenhum critério definido"
        criterios: existsSync(join(ativa.dir, 'criterios.json')) ? lerJson(join(ativa.dir, 'criterios.json')) : null,
        eventos: lerEventosJsonl(join(ativa.dir, 'eventos.jsonl')),
      };
      return boa;
    } catch { return boa?.nome === ativa.nome ? boa : null; }
  };
}

function ativaDir(projeto) {
  try { return lerAtiva(projeto)?.dir ?? null; } catch { return null; }
}

const marca = arq => { try { const s = statSync(arq); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };

export function abrirNavegador(url) {
  try {
    const [cmd, args, extra] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url], { windowsVerbatimArguments: true }]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {}];
    const filho = spawn(cmd, args, { detached: true, stdio: 'ignore', ...extra });
    filho.on('error', () => {});
    filho.unref();
  } catch { /* falha ao abrir: a URL já foi impressa */ }
}

export function iniciar({ porta = 0, raiz = RAIZ_PLUGIN, projeto, home = nabucoHome(), abrir = false } = {}) {
  projeto = resolve(projeto ?? acharProjeto(process.cwd()));
  const chave = randomBytes(16).toString('hex');
  const chaveBuf = Buffer.from(chave, 'utf8');
  const nomes = nomesDe(raiz);
  const avatares = avataresDe(raiz);
  const nomeProjeto = basename(projeto);
  const arqHistorico = join(home, 'historico.jsonl');
  const lerTarefa = leitorTarefa(projeto);

  const estadoAtual = () => montarEstado({
    eventos: lerHistorico(home), tarefa: lerTarefa(), projeto: nomeProjeto, nomes, avatares, agora: Date.now(),
  });

  let portaReal = 0;
  const clientes = new Map(); // resposta SSE aberta → último estado (JSON) enviado a ela
  let timer = null; // debounce

  const chaveOk = k => {
    if (typeof k !== 'string') return false;
    const b = Buffer.from(k, 'utf8');
    return b.length === chaveBuf.length && timingSafeEqual(b, chaveBuf);
  };

  function responder(res, status, tipo, corpo, extra = {}) {
    res.writeHead(status, { ...SEGURANCA, 'cache-control': 'no-store', 'content-type': tipo, ...extra });
    res.end(corpo);
  }
  const texto = (res, status, msg) => responder(res, status, 'text/plain; charset=utf-8', msg);
  const jsonRes = (res, dados) => responder(res, 200, 'application/json; charset=utf-8', JSON.stringify(dados));

  function rota(req, res) {
    const hostOk = req.headers.host === `127.0.0.1:${portaReal}` || req.headers.host === `localhost:${portaReal}`;
    if (!hostOk) return texto(res, 403, 'proibido');
    if (typeof req.url !== 'string' || !req.url.startsWith('/')) return texto(res, 403, 'proibido');
    let url;
    try { url = new URL(`http://127.0.0.1${req.url}`); } catch { return texto(res, 403, 'proibido'); }
    const k = url.searchParams.get('k') ?? req.headers['x-nabuco-chave'];
    if (!chaveOk(k)) return texto(res, 403, 'proibido');
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return texto(res, 405, 'método não permitido'); }

    const caminho = url.pathname;
    const estatico = ESTATICOS.get(caminho);
    if (estatico) {
      let corpo;
      try { corpo = readFileSync(join(PUBLICO, estatico[0])); } catch { return texto(res, 404, 'não encontrado'); }
      // a CSP proíbe script inline: a página só alcança estilo.css/app.js (que também exigem a chave) com ela na URL
      if (caminho === '/') corpo = corpo.toString('utf8').replaceAll('__CHAVE__', chave);
      return responder(res, 200, estatico[1], corpo);
    }

    const partes = caminho.split('/').slice(1); // caminho começa com '/'
    if (partes[0] === 'avatares' && partes.length === 2) {
      const nome = partes[1];
      if (!RE_AVATAR.test(nome) || !avatares.has(nome)) return texto(res, 404, 'não encontrado');
      let corpo;
      try { corpo = readFileSync(join(raiz, 'assets', 'avatares', nome)); } catch { return texto(res, 404, 'não encontrado'); }
      return responder(res, 200, 'image/jpeg', corpo, { 'cache-control': 'private, max-age=3600' });
    }

    if (partes[0] !== 'api') return texto(res, 404, 'não encontrado');

    if (caminho === '/api/estado') return jsonRes(res, estadoAtual());

    if (partes[1] === 'dossie' && partes.length === 3) {
      const papel = partes[2];
      if (!PAPEL_SET.has(papel)) return texto(res, 404, 'não encontrado');
      const eventos = lerHistorico(home);
      // versao = eventos usados: o front pede as fontes com ela, e os índices batem com o dossiê exibido
      return jsonRes(res, {
        ...montarDossie({ papel, eventos, home, projeto, modelos: carregarModelos(raiz), nome: nomes[papel] }),
        versao: eventos.length,
      });
    }

    if (partes[1] === 'fontes' && partes.length === 4) {
      const [, , papel, indicador] = partes;
      if (!PAPEL_SET.has(papel)) return texto(res, 404, 'não encontrado');
      const v = url.searchParams.get('v');
      if (v === null || !/^\d{1,15}$/.test(v)) return texto(res, 400, 'versão inválida');
      const versao = Number(v);
      const eventos = lerHistorico(home);
      if (versao > eventos.length) return texto(res, 409, 'histórico mudou; recarregue');
      // calcula sobre o que o cliente viu: os índices batem com o estado exibido
      const vistos = eventos.slice(0, versao);
      const fontes = calcularMetricas(vistos, { fontes: true })[papel]?.fontes;
      if (!fontes || !Object.hasOwn(fontes, indicador)) return texto(res, 404, 'não encontrado');
      return jsonRes(res, { eventos: fontes[indicador].map(i => vistos[i]).filter(Boolean) });
    }

    if (caminho === '/api/eventos') {
      res.writeHead(200, { ...SEGURANCA, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clientes.set(res, null);
      req.on('close', () => clientes.delete(res));
      try { enviarEstado(res, JSON.stringify(estadoAtual())); } catch { /* estado indisponível agora: virá na próxima mudança */ }
      return;
    }

    return texto(res, 404, 'não encontrado');
  }

  const servidor = http.createServer((req, res) => {
    try { rota(req, res); } catch {
      if (!res.headersSent) texto(res, 500, 'erro interno'); else res.end();
    }
  });

  // requisição malformada: 400 com os mesmos cabeçalhos de segurança, e fecha o socket
  servidor.on('clientError', (_erro, socket) => {
    if (!socket.writable) return socket.destroy();
    const corpo = 'requisição inválida';
    const cab = { ...SEGURANCA, 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(corpo), connection: 'close' };
    const linhas = Object.entries(cab).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    socket.end(`HTTP/1.1 400 Bad Request\r\n${linhas}\r\n\r\n${corpo}`, () => socket.destroy()); // destrói após enviar
  });

  // --- atualização ao vivo ---
  // escreve no cliente SSE; se ele não lê e a fila passou do limite, derruba a conexão
  function escrever(c, dados) {
    if (c.write(dados) || c.writableLength <= LIMITE_FILA) return;
    clientes.delete(c);
    c.destroy();
  }
  // cada cliente guarda o último estado que recebeu: um cliente novo não "consome" a mudança dos outros
  function enviarEstado(c, js) {
    if (clientes.get(c) === js) return;
    clientes.set(c, js);
    escrever(c, `event: estado\ndata: ${js}\n\n`);
  }
  function enviar() {
    timer = null;
    if (clientes.size === 0) return;
    let js;
    // a assinatura passa a ser a dos arquivos lidos agora: uma mudança entre a verificação e a leitura
    // (ex.: ativa criada e removida em menos de 1 s) ainda dispara um novo envio na próxima verificação
    ultimaAssinatura = assinatura().sig;
    // falhou agora: esquece a assinatura para a próxima verificação tentar de novo
    try { js = JSON.stringify(estadoAtual()); } catch { ultimaAssinatura = null; return; }
    for (const c of [...clientes.keys()]) enviarEstado(c, js);
  }
  function agendar() { if (!timer) timer = setTimeout(enviar, DEBOUNCE); }

  const observadores = new Map(); // pasta → FSWatcher
  function observar(pastas) {
    for (const [p, w] of observadores) if (!pastas.includes(p)) { w.close(); observadores.delete(p); }
    for (const p of pastas) {
      if (!p || observadores.has(p) || !existsSync(p)) continue;
      try {
        const w = watch(p, () => agendar());
        w.on('error', () => { w.close(); observadores.delete(p); });
        observadores.set(p, w);
      } catch { /* fs.watch indisponível: a verificação periódica cobre */ }
    }
  }

  const assinatura = () => {
    const dir = ativaDir(projeto);
    const arqs = [arqHistorico, join(dirProjeto(projeto), 'ativa')];
    if (dir) arqs.push(join(dir, 'estado.json'), join(dir, 'criterios.json'), join(dir, 'eventos.jsonl'));
    return { sig: arqs.map(marca).join('|') + `|${dir}`, dir };
  };
  let ultimaAssinatura = null;
  let semMudanca = 0;
  function verificar() {
    const { sig, dir } = assinatura();
    observar([home, dir].filter(Boolean));
    if (sig !== ultimaAssinatura) { ultimaAssinatura = sig; semMudanca = 0; agendar(); }
    else if (++semMudanca >= RECALCULO) { semMudanca = 0; agendar(); }
  }
  const intervaloPoll = setInterval(verificar, POLL);
  const intervaloPing = setInterval(() => { for (const c of [...clientes.keys()]) escrever(c, ': ping\n\n'); }, PING);
  intervaloPoll.unref(); intervaloPing.unref();

  let fechando = null;
  function fechar() {
    if (fechando) return fechando;
    clearInterval(intervaloPoll); clearInterval(intervaloPing);
    if (timer) { clearTimeout(timer); timer = null; }
    for (const w of observadores.values()) { try { w.close(); } catch { /* já fechado */ } }
    observadores.clear();
    for (const c of clientes.keys()) c.end();
    clientes.clear();
    fechando = new Promise(ok => {
      servidor.close(() => ok());
      servidor.closeAllConnections?.();
    });
    return fechando;
  }

  return new Promise((ok, falha) => {
    servidor.once('error', e => { fechar(); falha(e); });
    servidor.listen(porta, '127.0.0.1', () => {
      portaReal = servidor.address().port;
      verificar();
      const url = `http://127.0.0.1:${portaReal}/?k=${chave}`;
      if (abrir) abrirNavegador(url);
      ok({ url, porta: portaReal, chave, fechar });
    });
  });
}

// --- CLI ---
function lerArgs(argv) {
  const op = { porta: 0, abrir: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sem-abrir') op.abrir = false;
    else if (a === '--porta') {
      const v = argv[++i];
      if (!/^\d{1,5}$/.test(v ?? '') || Number(v) > 65535) throw new Error(`--porta inválida: ${v ?? '(vazia)'}`);
      op.porta = Number(v);
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  return op;
}

const executadoDireto = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executadoDireto) {
  let op;
  try { op = lerArgs(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`nabuco painel: ${e.message}\nuso: node servidor.mjs [--porta N] [--sem-abrir]\n`);
    process.exit(2);
  }
  try {
    const srv = await iniciar({ porta: op.porta, projeto: acharProjeto(process.cwd()), home: nabucoHome(), abrir: op.abrir });
    process.stdout.write(`nabuco painel: ${srv.url}\n`);
    const sair = () => { srv.fechar().then(() => process.exit(0), () => process.exit(0)); };
    process.once('SIGINT', sair);
    process.once('SIGTERM', sair);
  } catch (e) {
    process.stderr.write(`nabuco painel: não consegui iniciar o servidor: ${e.message}\n`);
    process.exit(1);
  }
}
