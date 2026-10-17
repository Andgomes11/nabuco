import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, appendFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { iniciar } from '../scripts/painel/servidor.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let base, proj, home, srv, homeAntes;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'nabuco painel-'));
  proj = join(base, 'Meu projeto'); home = join(base, 'home vazia');
  mkdirSync(join(proj, '.git'), { recursive: true });
  // lições do dossiê vêm de nabucoHome(): nunca ler o ~/.nabuco real
  homeAntes = process.env.NABUCO_HOME;
  process.env.NABUCO_HOME = home;
  srv = await iniciar({ porta: 0, raiz: RAIZ, projeto: proj, home });
});
afterEach(async () => {
  await srv.fechar();
  if (homeAntes === undefined) delete process.env.NABUCO_HOME; else process.env.NABUCO_HOME = homeAntes;
  rmSync(base, { recursive: true, force: true });
});

// http.request cru: não normaliza o caminho e deixa mandar qualquer Host
function pedir(caminho, { metodo = 'GET', host, chave = srv.chave } = {}) {
  const sep = caminho.includes('?') ? '&' : '?';
  const path = chave === null ? caminho : `${caminho}${sep}k=${chave}`;
  return new Promise((ok, falha) => {
    const r = http.request({ host: '127.0.0.1', port: srv.porta, path, method: metodo, agent: false,
      headers: { host: host ?? `127.0.0.1:${srv.porta}` } }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
    });
    r.on('error', falha);
    r.end();
  });
}
const json = r => JSON.parse(r.corpo.toString('utf8'));

test('url e chave: 32 hex, 127.0.0.1', () => {
  assert.match(srv.chave, /^[0-9a-f]{32}$/);
  assert.equal(srv.url, `http://127.0.0.1:${srv.porta}/?k=${srv.chave}`);
});

test('sem chave e chave errada → 403; com chave → / 200 text/html', async () => {
  assert.equal((await pedir('/', { chave: null })).status, 403);
  assert.equal((await pedir('/', { chave: 'a'.repeat(32) })).status, 403);
  assert.equal((await pedir('/', { chave: 'curta' })).status, 403);
  const r = await pedir('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  for (const d of ["frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(r.headers['content-security-policy'].includes(d), d);
});

test('fetch nativo com a url impressa funciona', async () => {
  const r = await fetch(srv.url);
  assert.equal(r.status, 200);
  await r.text();
});

test('chave pelo cabeçalho x-nabuco-chave', async () => {
  const r = await fetch(`http://127.0.0.1:${srv.porta}/api/estado`, { headers: { 'x-nabuco-chave': srv.chave } });
  assert.equal(r.status, 200);
  await r.json();
});

test('POST /api/estado → 405', async () => {
  assert.equal((await pedir('/api/estado', { metodo: 'POST' })).status, 405);
});

test('Host diferente (DNS rebinding) → 403 sem dados', async () => {
  const r = await pedir('/api/estado', { host: 'evil.com' });
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.corpo.toString(), /funcionarios/);
  assert.equal((await pedir('/api/estado', { host: `evil.com:${srv.porta}` })).status, 403);
  assert.equal((await pedir('/api/estado', { host: `localhost:${srv.porta}` })).status, 200);
});

test('avatares: válido 200 image/jpeg; caminhos maliciosos 404', async () => {
  const r = await pedir('/avatares/dev-1.jpg');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.ok(r.corpo.length > 1000);
  for (const p of ['/avatares/..%2F..%2Fpackage.json', '/avatares/../x', '/avatares/dev-9.jpg', '/../package.json',
    '/avatares/%2e%2e/package.json', '/avatares/chefe-1.jpg', '/package.json', '/avatares/dev-1.jpg/', '//evil/x']) {
    assert.equal((await pedir(p)).status, 404, p);
  }
});

test('/api/estado com home vazia → 10 ociosos, tarefa null', async () => {
  const r = await pedir('/api/estado');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json/);
  const e = json(r);
  assert.equal(e.tarefa, null);
  assert.equal(e.projeto, 'Meu projeto');
  assert.equal(e.funcionarios.length, 10);
  assert.ok(e.funcionarios.every(f => f.estado === 'ocioso'));
  assert.equal(e.funcionarios[0].nome, 'Gerente');
  assert.equal(e.funcionarios.find(f => f.papel === 'dev').nome, 'Dev');
  assert.equal(e.funcionarios.find(f => f.papel === 'dev').avatar, 'dev-1.jpg');
});

test('/api/estado com tarefa ativa', async () => {
  const dir = join(proj, '.nabuco', 'tarefas', 'minha tarefa');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(proj, '.nabuco', 'ativa'), 'minha tarefa\n');
  appendFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 'x', fase: 'aguardando_usuario', tamanho: 'media', tipo: 'bug' }));
  appendFileSync(join(dir, 'criterios.json'), JSON.stringify({ criterios: [] }));
  appendFileSync(join(dir, 'eventos.jsonl'), '{quebrada\n' + JSON.stringify({ ts: new Date().toISOString(), tipo: 'x', papel: null }) + '\n');
  const e = json(await pedir('/api/estado'));
  assert.equal(e.tarefa.nome, 'minha tarefa');
  assert.equal(e.funcionarios[0].estado, 'aguardando');
});

test('/api/estado: leitura falha no meio de uma regravação → mantém a última leitura boa da mesma tarefa', async () => {
  const dir = join(proj, '.nabuco', 'tarefas', 't');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(proj, '.nabuco', 'ativa'), 't\n');
  writeFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 't', fase: 'executando' }));
  // sem criterios.json ainda: a tarefa aparece, com gate vazio
  assert.deepEqual(json(await pedir('/api/estado')).tarefa.gate, { passou: 0, total: 0, pendencias: [] });
  writeFileSync(join(dir, 'criterios.json'), JSON.stringify({ criterios: [] }));
  assert.equal(json(await pedir('/api/estado')).tarefa.nome, 't');
  writeFileSync(join(dir, 'estado.json'), '{meio regravad');
  const e = json(await pedir('/api/estado'));
  assert.equal(e.tarefa?.nome, 't');
  assert.equal(e.tarefa.fase, 'executando');
});

test('/api/estado com tarefa ilegível → tarefa null, sem quebrar', async () => {
  const dir = join(proj, '.nabuco', 'tarefas', 't');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(proj, '.nabuco', 'ativa'), 't\n');
  appendFileSync(join(dir, 'estado.json'), '{quebrado');
  const r = await pedir('/api/estado');
  assert.equal(r.status, 200);
  assert.equal(json(r).tarefa, null);
});

test('/api/dossie: papel desconhecido 404; dev 200 com diario vazio', async () => {
  assert.equal((await pedir('/api/dossie/chefe')).status, 404);
  assert.equal((await pedir('/api/dossie/__proto__')).status, 404);
  const r = await pedir('/api/dossie/dev');
  assert.equal(r.status, 200);
  const d = json(r);
  assert.deepEqual(d.diario, []);
  assert.deepEqual(d.licoes, [], 'lições vêm da home temporária, não do ~/.nabuco real');
  assert.equal(d.nome, 'Dev');
  assert.equal((await pedir('/api/dossie/gerente')).status, 200);
});

test('/api/fontes: v maior que o histórico → 409; indicador desconhecido 404; eventos dos índices', async () => {
  mkdirSync(home, { recursive: true });
  const ts = new Date().toISOString();
  const evs = [
    { ts, tipo: 'tarefa_fechada', projeto: 'p', tarefa: 't1', papel: null, dados: {} },
    { ts, tipo: 'achado', projeto: 'p', tarefa: 't1', papel: 'revisor', dados: { severidade: 'alta' } },
  ];
  appendFileSync(join(home, 'historico.jsonl'), evs.map(e => JSON.stringify(e)).join('\n') + '\n');
  assert.equal((await pedir('/api/fontes/dev/aceitacao_1a?v=3')).status, 409);
  assert.equal((await pedir('/api/fontes/dev/inexistente?v=2')).status, 404);
  assert.equal((await pedir('/api/fontes/chefe/aceitacao_1a?v=2')).status, 404);
  assert.equal((await pedir('/api/fontes/dev/__proto__?v=2')).status, 404);
  const d = json(await pedir('/api/dossie/revisor'));
  assert.equal(d.versao, 2, 'o dossiê diz com quantos eventos do histórico foi calculado');
  const indicador = 'amostra';
  assert.ok(d.fontes[indicador].length > 0, 'revisor tem fontes de amostra');
  const r = await pedir(`/api/fontes/revisor/${indicador}?v=2`);
  assert.equal(r.status, 200);
  const { eventos } = json(r);
  assert.ok(Array.isArray(eventos));
  assert.deepEqual(eventos, d.fontes[indicador].map(i => evs[i]));
});

// lê eventos SSE até `cond` casar
function abrirSSE() {
  return new Promise((ok, falha) => {
    const r = http.get({ host: '127.0.0.1', port: srv.porta, path: `/api/eventos?k=${srv.chave}`, agent: false }, res => {
      const estados = [];
      const esperas = [];
      let buf = '';
      let fim = false;
      res.setEncoding('utf8');
      res.on('data', c => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(bloco)?.[1];
          const data = /^data: (.+)$/m.exec(bloco)?.[1];
          if (ev === 'estado') estados.push(JSON.parse(data));
        }
        for (const w of [...esperas]) if (estados.some(w.cond)) { esperas.splice(esperas.indexOf(w), 1); w.ok(); }
      });
      const terminou = new Promise(f => res.on('close', () => { fim = true; f(); }));
      ok({
        res, estados, terminou, get fim() { return fim; },
        esperar: (cond, ms) => new Promise((resolve, reject) => {
          if (estados.some(cond)) return resolve();
          const t = setTimeout(() => reject(new Error('timeout esperando estado')), ms);
          esperas.push({ cond, ok: () => { clearTimeout(t); resolve(); } });
        }),
      });
    });
    r.on('error', falha);
  });
}

test('SSE: estado inicial, atualização com linha parcial, fechar() encerra', async () => {
  const sse = await abrirSSE();
  assert.equal(sse.res.statusCode, 200);
  assert.match(sse.res.headers['content-type'], /^text\/event-stream/);
  assert.equal(sse.res.headers['cache-control'], 'no-cache');
  await sse.esperar(() => true, 2000);
  assert.ok(sse.estados[0].funcionarios.every(f => f.estado === 'ocioso'));
  mkdirSync(home, { recursive: true });
  const ev = { ts: new Date().toISOString(), tipo: 'agente_inicio', papel: 'dev', projeto: 'Meu projeto', tarefa: 't', dados: { agent_id: 'a1' } };
  appendFileSync(join(home, 'historico.jsonl'), JSON.stringify(ev) + '\n{"ts":"2026-10-17T00:00:00Z","tipo":"agen');
  await sse.esperar(e => e.funcionarios.find(f => f.papel === 'dev').estado === 'trabalhando', 2000);
  await srv.fechar();
  await sse.terminou;
  assert.ok(sse.fim);
});

test('SSE sem chave → 403', async () => {
  const r = await pedir('/api/eventos', { chave: null });
  assert.equal(r.status, 403);
});

test('SSE: cliente novo durante o debounce não impede o antigo de receber a mudança', async () => {
  mkdirSync(home, { recursive: true });
  const a = await abrirSSE();
  await a.esperar(() => true, 2000);
  const ev = { ts: new Date().toISOString(), tipo: 'agente_inicio', papel: 'dev', projeto: 'Meu projeto', tarefa: 't', dados: { agent_id: 'a1' } };
  appendFileSync(join(home, 'historico.jsonl'), JSON.stringify(ev) + '\n');
  const b = await abrirSSE(); // conecta antes do debounce disparar e já vê o estado novo
  const trabalhando = e => e.funcionarios.find(f => f.papel === 'dev').estado === 'trabalhando';
  await b.esperar(trabalhando, 2000);
  await a.esperar(trabalhando, 2500);
  assert.equal(b.estados.filter(trabalhando).length, 1, 'B não recebe o mesmo estado duas vezes');
});

test('404 e 405 também levam CSP e nosniff', async () => {
  for (const r of [await pedir('/nada'), await pedir('/api/estado', { metodo: 'DELETE' })]) {
    assert.ok([404, 405].includes(r.status));
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  }
});

test('requisição HTTP malformada → 400 com cabeçalhos de segurança', async () => {
  const { connect } = await import('node:net');
  const resposta = await new Promise((ok, falha) => {
    const s = connect(srv.porta, '127.0.0.1', () => s.write('GET / HTTP/1.1\r\nHost: x\r\nQuebrado sem dois pontos\r\n\r\n'));
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', c => { buf += c; });
    s.on('close', () => ok(buf));
    s.on('error', falha);
  });
  assert.match(resposta, /^HTTP\/1\.1 400/);
  assert.match(resposta, /x-content-type-options: nosniff/i);
  assert.match(resposta, /content-security-policy: default-src 'self'.*frame-ancestors 'none'/i);
});

test('index.html sai com a chave nos recursos estáticos (toda requisição exige a chave)', async () => {
  const html = (await pedir('/')).corpo.toString('utf8');
  assert.ok(!html.includes('__CHAVE__'));
  assert.ok(html.includes(`estilo.css?k=${srv.chave}`));
  assert.ok(html.includes(`app.js?k=${srv.chave}`));
  for (const rec of ['/estilo.css', '/app.js', '/modelo.mjs']) assert.equal((await pedir(rec)).status, 200, rec);
});

test('/api/fontes com v menor que o histórico: fontes calculadas só sobre os v primeiros eventos', async () => {
  mkdirSync(home, { recursive: true });
  const ts = new Date().toISOString();
  const tarefaDev = t => [
    { ts, tipo: 'agente_inicio', projeto: 'p', tarefa: t, papel: 'dev', dados: {} },
    { ts, tipo: 'tarefa_fechada', projeto: 'p', tarefa: t, papel: null, dados: {} },
  ];
  const evs = [...tarefaDev('t1'), ...tarefaDev('t2')];
  appendFileSync(join(home, 'historico.jsonl'), evs.map(e => JSON.stringify(e)).join('\n') + '\n');
  assert.deepEqual(json(await pedir('/api/fontes/dev/amostra?v=2')).eventos, [evs[0]]);
  assert.deepEqual(json(await pedir('/api/fontes/dev/amostra?v=4')).eventos, [evs[0], evs[2]]);
  assert.deepEqual(json(await pedir('/api/fontes/dev/amostra?v=0')).eventos, []);
});

test('SSE: troca de tarefa — ativa criada aparece; ativa removida (tarefa concluída) volta a "nenhuma tarefa"', async () => {
  const sse = await abrirSSE();
  await sse.esperar(e => e.tarefa === null, 2000);
  const dir = join(proj, '.nabuco', 'tarefas', 'nova tarefa');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 'nova', fase: 'executando' }));
  writeFileSync(join(proj, '.nabuco', 'ativa'), 'nova tarefa\n');
  await sse.esperar(e => e.tarefa?.nome === 'nova tarefa', 3000);
  const n = sse.estados.length;
  // como o "tarefa concluir": fase concluida e ativa removida
  writeFileSync(join(dir, 'estado.json'), JSON.stringify({ slug: 'nova', fase: 'concluida' }));
  unlinkSync(join(proj, '.nabuco', 'ativa'));
  await sse.esperar(e => sse.estados.indexOf(e) >= n && e.tarefa === null, 3000);
});
