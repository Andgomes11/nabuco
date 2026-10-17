// Painel do nabuco: monitores ao vivo (SSE) e dossiê por funcionário. Somente leitura.
// a chave vem da URL e fica só em memória; toda requisição a leva, inclusive o import do modelo
const CHAVE = new URLSearchParams(location.search).get('k') ?? '';
// sem o modelo não há painel: avisa em vez de ficar em "carregando…"
let modelo;
try { modelo = await import(`./modelo.mjs?k=${encodeURIComponent(CHAVE)}`); } catch (erro) {
  const caixa = document.getElementById('erro-geral');
  caixa.textContent = `não consegui carregar o painel (${erro?.message ?? erro}). O servidor foi encerrado? Reabra pelo endereço impresso pelo /nabuco:painel.`;
  caixa.hidden = false;
  document.getElementById('tarefa').textContent = '—';
  document.getElementById('conexao').dataset.estado = 'desconectado';
  document.getElementById('conexao-texto').textContent = 'falha ao carregar';
  document.getElementById('grade').setAttribute('aria-busy', 'false');
  throw erro;
}
const {
  velocidadeChuva, corDoEstado, rotuloEstado, rotuloNivel, formatarAtributo, formatarIndicador,
  seta, urlAvatar, urlFontes, urlFontesLicao, resumoGate, INDICADORES, ATRIBUTOS,
} = modelo;
const comChave = caminho => `${caminho}${caminho.includes('?') ? '&' : '?'}k=${encodeURIComponent(CHAVE)}`;

const $ = id => document.getElementById(id);
const el = (tag, classe, texto) => {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texto !== undefined && texto !== null) n.textContent = String(texto);
  return n;
};

let estado = null; // último Estado recebido
const monitores = new Map(); // papel → { botao, tela, retrato, nome, nivel, situacao, f }

// ---------- chuva ----------
const GLIFOS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=<>*+';
const glifo = () => GLIFOS[Math.floor(Math.random() * GLIFOS.length)];
const TAM = 13; // px por célula
const movimentoReduzido = matchMedia('(prefers-reduced-motion: reduce)');
let cores = null;
const lerCores = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  cores = { fundo: v('--fundo'), chuva: v('--chuva'), cabeca: v('--chuva-cabeca'), espera: v('--chuva-espera') };
};

class Tela {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.linhas = 0;
    this.colunas = [];
    this.vel = 0;
    this.cor = 'apagado';
    this.temQuadro = false; // há chuva desenhada (para congelar)
  }
  ajustar() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.linhas = Math.ceil(this.h / TAM);
    const n = Math.max(1, Math.floor(this.w / TAM));
    this.colunas = Array.from({ length: n }, () => ({
      y: -Math.floor(Math.random() * this.linhas), fator: 0.7 + Math.random() * 0.6, acc: 0,
    }));
    this.temQuadro = false;
    this.redesenhar();
  }
  // estado novo vindo do servidor
  definir(f) {
    const vel = velocidadeChuva(f);
    const cor = corDoEstado(f.estado);
    const mudou = vel !== this.vel || cor !== this.cor;
    const congelar = cor === 'vermelho' && this.cor === 'verde' && this.temQuadro;
    const mesmaCor = cor === this.cor;
    this.vel = vel; this.cor = cor;
    if (!mudou) return;
    // só a velocidade mudou e a chuva está andando: a animação segue com o rastro (limpar faria piscar)
    if (mesmaCor && this.emMovimento()) return;
    if (congelar) this.tingir(cores.espera); // congela o quadro exato em que parou, em vermelho
    else this.redesenhar();
  }
  emMovimento() { return this.cor === 'verde' && this.vel > 0 && !movimentoReduzido.matches; }
  limpar() {
    this.ctx.fillStyle = cores.fundo;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }
  // quadro parado: só aparece se há dado (trabalhando com movimento reduzido, ou esperando)
  redesenhar() {
    if (!this.w) return;
    this.limpar();
    this.temQuadro = false;
    if (this.cor === 'apagado') return; // ocioso: tela apagada
    if (this.cor === 'verde' && this.emMovimento()) return; // a animação desenha
    const cor = this.cor === 'vermelho' ? cores.espera : cores.chuva;
    // rastro proporcional à velocidade: o quadro parado ainda conta quanto trabalho havia
    const rastro = this.cor === 'vermelho' ? 8 : Math.round(3 + this.vel / 2);
    const ctx = this.ctx;
    ctx.font = `${TAM}px ${fonteChuva}`;
    ctx.textBaseline = 'top';
    for (let i = 0; i < this.colunas.length; i++) {
      const cabeca = Math.floor(Math.random() * (this.linhas + rastro));
      for (let k = 0; k < rastro; k++) {
        const y = cabeca - k;
        if (y < 0 || y >= this.linhas) continue;
        ctx.globalAlpha = Math.max(0.08, 1 - k / rastro);
        ctx.fillStyle = k === 0 && this.cor === 'verde' ? cores.cabeca : cor;
        ctx.fillText(glifo(), i * TAM, y * TAM);
      }
    }
    ctx.globalAlpha = 1;
    this.temQuadro = true;
  }
  tingir(cor) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
  }
  passo(dt) {
    const ctx = this.ctx;
    this.esmaecer(dt);
    ctx.font = `${TAM}px ${fonteChuva}`;
    ctx.textBaseline = 'top';
    for (let i = 0; i < this.colunas.length; i++) {
      const c = this.colunas[i];
      c.acc += this.vel * c.fator * dt;
      while (c.acc >= 1) {
        c.acc -= 1;
        if (c.y >= 0 && c.y < this.linhas) {
          ctx.fillStyle = cores.fundo;
          ctx.fillRect(i * TAM, c.y * TAM, TAM, TAM);
          ctx.fillStyle = cores.chuva;
          ctx.fillText(glifo(), i * TAM, c.y * TAM);
        }
        c.y += 1;
        if (c.y >= this.linhas && Math.random() < 0.35) c.y = -Math.floor(Math.random() * this.linhas);
        if (c.y >= 0 && c.y < this.linhas) {
          ctx.fillStyle = cores.cabeca;
          ctx.fillText(glifo(), i * TAM, c.y * TAM);
        }
      }
    }
    this.temQuadro = true;
  }
  // rastro some em ~0,6 s, independente da taxa de quadros: mais rápido = rastro mais longo
  esmaecer(dt) {
    this.ctx.globalAlpha = 1 - Math.exp(-dt * 5);
    this.limpar();
    this.ctx.globalAlpha = 1;
  }
}

let fonteChuva = 'monospace';
let quadroAnterior = 0;
let rodando = false;
function animar(t) {
  const dt = Math.min(0.1, quadroAnterior ? (t - quadroAnterior) / 1000 : 0);
  quadroAnterior = t;
  let algum = false;
  for (const m of monitores.values()) {
    if (!m.tela.emMovimento()) continue;
    algum = true;
    if (dt > 0) m.tela.passo(dt);
  }
  if (algum) requestAnimationFrame(animar);
  else { rodando = false; quadroAnterior = 0; }
}
function talvezAnimar() {
  if (rodando) return;
  for (const m of monitores.values()) {
    if (m.tela.emMovimento()) { rodando = true; quadroAnterior = 0; requestAnimationFrame(animar); return; }
  }
}
movimentoReduzido.addEventListener('change', () => {
  for (const m of monitores.values()) m.tela.redesenhar();
  talvezAnimar();
});

const observador = new ResizeObserver(entradas => {
  for (const e of entradas) e.target.__tela?.ajustar();
  talvezAnimar();
});

// ---------- avatar ----------
const SVG = 'http://www.w3.org/2000/svg';
function silhueta() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'silhueta');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const cabeca = document.createElementNS(SVG, 'circle');
  cabeca.setAttribute('cx', '32'); cabeca.setAttribute('cy', '23'); cabeca.setAttribute('r', '12');
  const corpo = document.createElementNS(SVG, 'path');
  corpo.setAttribute('d', 'M8 62c0-14 10.7-23 24-23s24 9 24 23z');
  svg.append(cabeca, corpo);
  return svg;
}
// preenche o quadro do retrato; silhueta quando não há imagem ou ela falha
const avataresFalhos = new Set(); // URL que falhou não é pedida de novo a cada estado
function pintarRetrato(alvo, f) {
  const u = urlAvatar(f, CHAVE);
  const url = u && !avataresFalhos.has(u) ? u : null;
  alvo.classList.toggle('cinza', Boolean(f.cinza));
  const atual = alvo.firstElementChild;
  if (url && atual?.tagName === 'IMG' && atual.dataset.url === url) return;
  if (!url && atual?.classList?.contains('silhueta')) return;
  alvo.replaceChildren();
  if (!url) { alvo.append(silhueta()); return; }
  const img = el('img');
  img.alt = '';
  img.decoding = 'async';
  img.dataset.url = url;
  img.addEventListener('error', () => { avataresFalhos.add(url); if (img.isConnected) img.replaceWith(silhueta()); }, { once: true });
  img.src = url;
  alvo.append(img);
}

// ---------- monitores ----------
function criarMonitor(f) {
  const li = el('li');
  const botao = el('button', 'monitor');
  botao.type = 'button';
  botao.setAttribute('aria-haspopup', 'dialog');
  const telaEl = el('span', 'tela');
  const canvas = el('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const retrato = el('span', 'retrato');
  telaEl.append(canvas, retrato);
  const placa = el('span', 'placa');
  const nome = el('span', 'placa-nome');
  const nivel = el('span', 'placa-nivel');
  const situacao = el('span', 'placa-estado');
  const led = el('span', 'led');
  led.setAttribute('aria-hidden', 'true');
  const situacaoTexto = el('span');
  situacao.append(led, situacaoTexto);
  placa.append(nome, nivel, situacao);
  botao.append(telaEl, placa);
  li.append(botao);
  const tela = new Tela(canvas);
  canvas.__tela = tela;
  const m = { li, botao, tela, retrato, nome, nivel, situacaoTexto, f };
  botao.addEventListener('click', () => abrirDossie(m.f.papel, botao));
  return m;
}

function atualizarMonitor(m, f) {
  m.f = f;
  m.botao.dataset.cor = corDoEstado(f.estado);
  m.botao.dataset.papel = f.papel;
  m.botao.setAttribute('aria-label', `${f.nome}, ${rotuloNivel(f)}, ${rotuloEstado(f.estado)}${f.estado === 'trabalhando' ? `, atividade ${formatarAtributo(f.atividade)}` : ''}. Abrir dossiê`);
  m.nome.textContent = f.nome;
  m.nivel.textContent = rotuloNivel(f);
  const atividade = f.estado === 'trabalhando' ? ` · atividade ${formatarAtributo(f.atividade)}` : '';
  m.situacaoTexto.textContent = rotuloEstado(f.estado) + atividade;
  pintarRetrato(m.retrato, f);
  m.tela.definir(f);
}

function renderizarMonitores(funcionarios) {
  const grade = $('grade');
  const papeis = funcionarios.map(f => f.papel).join(',');
  if ([...monitores.keys()].join(',') !== papeis) {
    for (const m of monitores.values()) observador.unobserve(m.tela.canvas);
    monitores.clear();
    grade.replaceChildren();
    for (const f of funcionarios) {
      const m = criarMonitor(f);
      grade.append(m.li);
      observador.observe(m.tela.canvas);
      monitores.set(f.papel, m);
    }
  }
  for (const f of funcionarios) atualizarMonitor(monitores.get(f.papel), f);
  grade.setAttribute('aria-busy', 'false');
  talvezAnimar();
}

// ---------- cabeçalho ----------
function renderizarCabecalho(e) {
  $('projeto').textContent = e.projeto || '—';
  const tarefa = $('tarefa');
  const gate = $('gate');
  const aviso = $('tarefa-aviso');
  const textoAviso = typeof e.tarefa?.aviso === 'string' ? e.tarefa.aviso : '';
  if (aviso.textContent !== textoAviso) aviso.textContent = textoAviso;
  aviso.hidden = !textoAviso;
  if (!e.tarefa) {
    tarefa.textContent = 'nenhuma tarefa ativa';
    tarefa.classList.add('vazio');
    gate.hidden = true;
    return;
  }
  tarefa.classList.remove('vazio');
  tarefa.textContent = `${e.tarefa.nome} · ${(e.tarefa.fase ?? 'sem fase').replaceAll('_', ' ')}`;
  const g = resumoGate(e.tarefa.gate);
  gate.hidden = false;
  $('gate-placar').textContent = g.placar;
  gate.dataset.situacao = g.situacao;
  const lista = $('gate-pendencias');
  lista.replaceChildren();
  if (g.mensagem) lista.append(el('li', g.situacao, g.mensagem));
  for (const p of g.pendencias) {
    const li = el('li');
    li.append(el('span', 'id', p.id), document.createTextNode(p.motivo ?? ''));
    lista.append(li);
  }
  gate.querySelector('summary').setAttribute('aria-label', g.total
    ? `gate: ${g.passou} de ${g.total} critérios passaram; ${g.pendencias.length} pendência(s)`
    : 'gate: nenhum critério definido');
}

// só a situação da conexão é anunciada; a contagem de eventos muda o tempo todo e fica fora da região viva
function definirConexao(situacao, texto) {
  const c = $('conexao');
  c.dataset.estado = situacao;
  const alvo = $('conexao-texto');
  if (alvo.textContent !== texto) alvo.textContent = texto;
  $('conexao-eventos').textContent = estado ? `· ${estado.versao} eventos` : '';
}
const textoAoVivo = () => 'ao vivo';

function aplicarEstado(e) {
  if (!e || !Array.isArray(e.funcionarios)) return;
  const versaoAnterior = estado?.versao;
  estado = e;
  $('erro-geral').hidden = true;
  renderizarCabecalho(e);
  renderizarMonitores(e.funcionarios);
  if ($('conexao').dataset.estado === 'ao-vivo') definirConexao('ao-vivo', textoAoVivo());
  if (dossieAberto && versaoAnterior !== undefined && e.versao !== dossieAberto.versao) $('d-aviso').hidden = false;
}

const SERVIDOR_FORA = 'o servidor foi encerrado? reabra pelo endereço impresso pelo /nabuco:painel';
function avisarServidorFora() {
  const caixa = $('erro-geral');
  caixa.textContent = SERVIDOR_FORA;
  caixa.hidden = false;
  definirConexao('desconectado', 'sem servidor');
}

async function recarregarEstado() {
  const r = await fetch(comChave('/api/estado'));
  if (r.status === 403) avisarServidorFora(); // chave de outro processo: este servidor não é mais o da página
  if (!r.ok) throw new Error(`estado: HTTP ${r.status}`);
  aplicarEstado(await r.json());
}

// ---------- SSE ----------
let fonte = null;
let falhas = 0; // erros seguidos do canal ao vivo; zera quando conecta
const MAX_FALHAS = 3;
function conectar() {
  fonte?.close();
  fonte = new EventSource(comChave('/api/eventos'));
  fonte.addEventListener('open', () => { falhas = 0; definirConexao('ao-vivo', textoAoVivo()); });
  fonte.addEventListener('estado', ev => {
    try { aplicarEstado(JSON.parse(ev.data)); } catch { /* evento malformado: espera o próximo */ }
    definirConexao('ao-vivo', textoAoVivo());
  });
  fonte.addEventListener('error', () => {
    // CONNECTING: o navegador já está tentando de novo; CLOSED: recria em 5 s
    if (++falhas >= MAX_FALHAS) avisarServidorFora();
    else definirConexao('desconectado', 'desconectado · tentando reconectar');
    if (fonte.readyState === EventSource.CLOSED) setTimeout(conectar, 5000);
  });
}

// ---------- dossiê ----------
const dialogo = $('dossie');
let dossieAberto = null; // { papel, versao, origem }

function abrirDossie(papel, origem) {
  const f = monitores.get(papel)?.f;
  if (!f) return;
  dossieAberto = { papel, versao: estado?.versao, origem };
  $('d-papel').textContent = papel;
  $('d-nome').textContent = f.nome;
  $('d-nivel').textContent = rotuloNivel(f);
  $('d-amostra').textContent = '—';
  const quadro = el('span', 'retrato');
  pintarRetrato(quadro, f);
  $('d-retrato').replaceChildren(quadro);
  $('d-aviso').hidden = true;
  if (!dialogo.open) dialogo.showModal();
  carregarDossie();
}

async function carregarDossie() {
  const alvo = dossieAberto;
  if (!alvo) return;
  const corpo = $('d-corpo');
  corpo.setAttribute('aria-busy', 'true');
  corpo.replaceChildren(el('p', 'd-estado', 'carregando dossiê…'));
  try {
    const r = await fetch(comChave(`/api/dossie/${encodeURIComponent(alvo.papel)}`));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (dossieAberto !== alvo) return; // fechou ou trocou de funcionário
    alvo.versao = Number.isInteger(d.versao) ? d.versao : estado?.versao; // as fontes usam a versão do dossiê exibido
    $('d-aviso').hidden = true;
    renderizarDossie(d);
  } catch (erro) {
    if (dossieAberto !== alvo) return;
    const caixa = el('div', 'd-estado erro');
    caixa.setAttribute('role', 'alert');
    const tentar = el('button', 'botao', 'tentar de novo');
    tentar.type = 'button';
    tentar.addEventListener('click', carregarDossie);
    caixa.append(el('p', null, `não consegui carregar o dossiê (${erro.message}).`), tentar);
    corpo.replaceChildren(caixa);
  } finally {
    if (dossieAberto === alvo) corpo.setAttribute('aria-busy', 'false');
  }
}

function secao(titulo, id) {
  const s = el('section', 'secao');
  const h = el('h3', null, titulo);
  h.id = id;
  s.setAttribute('aria-labelledby', id);
  s.append(h);
  return s;
}

// número que leva às fontes; sem fontes conhecidas (ou valor nulo) vira texto simples
function numero(texto, papel, indicadores, titulo, fontes, rotuloAcessivel) {
  const temFonte = indicadores.some(i => Array.isArray(fontes?.[i]));
  if (texto === '—' || !temFonte) return el('span', 'num-fixo', texto);
  const b = el('button', 'num', texto);
  b.type = 'button';
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-controls', 'd-fontes');
  b.setAttribute('aria-label', `${rotuloAcessivel ?? titulo}: ${texto} — ver eventos de origem`);
  const comFonte = indicadores.filter(i => Array.isArray(fontes?.[i]));
  b.addEventListener('click', () => mostrarFontes($('d-fontes'), titulo, b,
    async () => { const g = []; for (const ind of comFonte) g.push([comFonte.length > 1 ? ROTULO_IND.get(ind) ?? ind : null, await buscarFontes(papel, ind)]); return g; }));
  return b;
}

function renderizarDossie(d) {
  const corpo = $('d-corpo');
  corpo.replaceChildren();
  const papel = d.papel;

  // clearance + amostra no cabeçalho
  $('d-nivel').textContent = rotuloNivel(d);
  const amostra = $('d-amostra');
  amostra.replaceChildren(numero(formatarIndicador('amostra', d.amostra), papel, ['amostra'], 'tarefas na amostra', d.fontes, 'amostra'));
  amostra.append(document.createTextNode(d.amostra === 1 ? ' tarefa' : ' tarefas'));

  // atributos
  const sAtr = secao('atributos', 'd-h-atr');
  const lista = el('div', 'atributos');
  for (const a of ATRIBUTOS) {
    const v = d.atributos?.[a.chave] ?? null;
    const linha = el('div', 'atributo');
    const nome = el('span', 'atributo-nome');
    nome.append(el('span', null, a.rotulo), el('span', 'dica', a.dica));
    const barra = el('span', 'barra');
    barra.setAttribute('aria-hidden', 'true');
    const cheia = el('span', 'barra-cheia');
    cheia.style.width = `${Math.round(Math.max(0, Math.min(1, v ?? 0)) * 100)}%`;
    barra.append(cheia);
    const valor = el('span', 'atributo-valor');
    valor.append(numero(formatarAtributo(v), papel, a.indicadores, a.rotulo, d.fontes));
    const t = seta(d.tendencia?.[a.chave]);
    const s = el('span', 'atributo-seta', t);
    s.dataset.t = t;
    if (t) s.setAttribute('aria-label', { '↑': 'tendência: subindo', '↓': 'tendência: caindo', '→': 'tendência: estável' }[t]);
    else s.setAttribute('aria-hidden', 'true');
    linha.append(nome, barra, valor, s);
    lista.append(linha);
  }
  sAtr.append(lista);

  // indicadores da Fase 2
  const grade = el('dl', 'indicadores');
  for (const ind of INDICADORES) {
    if (ind.chave === 'amostra') continue; // já está no cabeçalho
    const item = el('div', 'indicador');
    const dt = el('dt', 'indicador-rotulo', ind.rotulo);
    const dd = el('dd');
    dd.append(numero(formatarIndicador(ind.chave, d.metricas?.[ind.chave]), papel, [ind.chave], ind.rotulo, d.fontes));
    item.append(dt, dd);
    grade.append(item);
  }
  const sub = el('h3', null, 'indicadores');
  sub.id = 'd-h-ind';
  const blocoInd = el('div');
  blocoInd.setAttribute('role', 'group');
  blocoInd.setAttribute('aria-labelledby', 'd-h-ind');
  blocoInd.className = 'secao-interna';
  blocoInd.append(sub, grade);
  sAtr.append(blocoInd);

  const fontes = el('div', 'fontes');
  fontes.id = 'd-fontes';
  fontes.hidden = true;
  sAtr.append(fontes);

  // equipamento
  const sEq = secao('equipamento', 'd-h-eq');
  const dl = el('dl', 'equip');
  for (const [rot, val] of [['Claude', d.equipamento?.claude], ['Codex', d.equipamento?.codex]]) {
    dl.append(el('dt', null, rot), el('dd', null, val ?? '—'));
  }
  sEq.append(dl);

  // diário
  const sDi = secao('diário de batalha', 'd-h-di');
  if (!d.diario?.length) sDi.append(el('p', 'vazio', 'nenhum caso registrado'));
  else {
    const ol = el('ol', 'diario');
    for (const c of d.diario) {
      const li = el('li', 'caso');
      const tempo = el('time', null, c.data ?? 'sem data');
      if (c.data) tempo.dateTime = c.data;
      li.append(tempo, el('p', null, c.sintoma ?? '(sem sintoma)'), el('p', 'causa', `causa: ${c.causa_raiz ?? '—'}`), el('p', 'arquivo', c.arquivo ?? ''));
      ol.append(li);
    }
    sDi.append(ol);
  }

  // programas carregados (lições ativas)
  const sLi = secao('programas carregados', 'd-h-li');
  if (!d.licoes?.length) sLi.append(el('p', 'vazio', 'nenhuma lição ativa'));
  else {
    const ul = el('ul', 'licoes');
    for (const l of d.licoes) {
      const li = el('li', `licao${l.ruim ? ' ruim' : ''}`);
      const titulo = el('span');
      titulo.append(el('span', 'id', `${l.id} · ${l.escopo} `), el('br'), document.createTextNode(l.titulo ?? ''));
      if (l.ruim) titulo.append(el('span', 'selo', 'ruim'));
      const votos = el('span', 'votos');
      votos.append(botaoVoto(papel, l, true), document.createTextNode(' · '), botaoVoto(papel, l, false));
      li.append(titulo, votos);
      ul.append(li);
    }
    const caixaLicoes = el('div', 'fontes');
    caixaLicoes.id = 'd-fontes-licoes';
    caixaLicoes.hidden = true;
    sLi.append(ul, caixaLicoes);
  }

  // talentos (lições promovidas)
  const sTa = secao('talentos', 'd-h-ta');
  if (!d.talentos?.length) sTa.append(el('p', 'vazio', 'nenhum talento promovido'));
  else {
    const ul = el('ul', 'licoes');
    for (const t of d.talentos) {
      const li = el('li', 'licao talento');
      li.append(el('span', null, t.titulo ?? t.id), el('span', 'id', t.id), el('span', 'regra', t.regra));
      ul.append(li);
    }
    sTa.append(ul);
  }

  corpo.append(sAtr, sEq, sDi, sLi, sTa);
}

// ---------- fontes ----------
// pede com a versão do dossiê aberto: os números clicados foram calculados sobre esses eventos
async function buscarFontes(papel, indicador) {
  const r = await fetch(urlFontes(papel, indicador, dossieAberto?.versao ?? estado?.versao ?? 0, CHAVE));
  if (r.status === 409) throw new Error('o histórico mudou; atualize o dossiê');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();
  return Array.isArray(corpo.eventos) ? corpo.eventos : [];
}

async function buscarFontesLicao(papel, id) {
  const r = await fetch(urlFontesLicao(papel, id, dossieAberto?.versao ?? estado?.versao ?? 0, CHAVE));
  if (r.status === 409) throw new Error('o histórico mudou; atualize o dossiê');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();
  return Array.isArray(corpo.eventos) ? corpo.eventos : [];
}

// 👍/👎 de uma lição: abre os eventos licao_usada daquele lado do voto
function botaoVoto(papel, l, util) {
  const n = (util ? l.positivos : l.negativos) ?? 0;
  const b = el('button', 'num voto', util ? `+${n} útil` : `−${n} não`);
  b.type = 'button';
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-controls', 'd-fontes-licoes');
  b.setAttribute('aria-label', `${l.id}: ${n} ${util ? 'votos útil' : 'votos não útil'} — ver eventos de origem`);
  const titulo = `${l.id} · ${util ? 'votos útil' : 'votos não útil'}`;
  b.addEventListener('click', () => mostrarFontes($('d-fontes-licoes'), titulo, b,
    async () => [[null, (await buscarFontesLicao(papel, l.id)).filter(e => e?.dados?.util === util)]]));
  return b;
}

const dois = n => String(n).padStart(2, '0');
const formatarTs = t => { const d = new Date(t); return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`; };
function linhaEvento(e) {
  const li = el('li', 'evento');
  const t = Date.parse(e?.ts);
  const tempo = el('time', null, Number.isNaN(t) ? String(e?.ts ?? '—') : formatarTs(t));
  if (!Number.isNaN(t)) tempo.dateTime = new Date(t).toISOString();
  const tipo = el('span', 'tipo', e?.tipo ?? '—');
  if (e?.tipo === 'licao_usada' && typeof e?.dados?.util === 'boolean') tipo.append(el('span', 'util', e.dados.util ? ' · útil' : ' · não útil'));
  li.append(tempo, tipo, el('span', 'tarefa', e?.tarefa ?? '(sem tarefa)'));
  return li;
}
const MAX_EVENTOS = 200;
const ROTULO_IND = new Map(INDICADORES.map(i => [i.chave, i.rotulo]));

// eventos de origem de um número do dossiê. `buscar` devolve grupos [rótulo | null, eventos]
async function mostrarFontes(caixa, titulo, botao, buscar) {
  for (const b of document.querySelectorAll('[aria-controls][aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
  for (const c of document.querySelectorAll('.fontes')) if (c !== caixa) c.hidden = true; // uma origem aberta por vez
  botao.setAttribute('aria-expanded', 'true');
  caixa.hidden = false;
  const cab = el('div', 'fontes-cab');
  const h = el('h4', null, `origem: ${titulo}`);
  h.tabIndex = -1;
  const fechar = el('button', 'botao', 'ocultar');
  fechar.type = 'button';
  fechar.addEventListener('click', () => { caixa.hidden = true; botao.setAttribute('aria-expanded', 'false'); botao.focus(); });
  cab.append(h, fechar);
  caixa.replaceChildren(cab, el('p', 'vazio', 'carregando eventos…'));
  caixa.setAttribute('aria-busy', 'true');
  h.focus();
  caixa.scrollIntoView({ block: 'nearest' });
  const pedido = Symbol('fontes');
  caixa.__pedido = pedido;
  try {
    const grupos = await buscar();
    if (caixa.__pedido !== pedido) return;
    const conteudo = [];
    for (const [rotulo, evs] of grupos) {
      if (rotulo) conteudo.push(el('h5', null, rotulo));
      if (!evs.length) { conteudo.push(el('p', 'vazio', 'nenhum evento')); continue; }
      const ol = el('ol', 'eventos');
      for (const e of evs.slice(-MAX_EVENTOS).reverse()) ol.append(linhaEvento(e)); // mais recentes primeiro
      conteudo.push(el('p', 'vazio', `${evs.length} evento(s)${evs.length > MAX_EVENTOS ? `, mostrando os ${MAX_EVENTOS} mais recentes` : ''}`), ol);
    }
    caixa.replaceChildren(cab, ...conteudo);
  } catch (erro) {
    if (caixa.__pedido !== pedido) return;
    const p = el('p', 'd-estado erro', `não consegui buscar os eventos (${erro.message}).`);
    p.setAttribute('role', 'alert');
    caixa.replaceChildren(cab, p);
  } finally {
    if (caixa.__pedido === pedido) caixa.setAttribute('aria-busy', 'false');
  }
}

// ---------- diálogo ----------
$('d-fechar').addEventListener('click', () => dialogo.close());
$('d-atualizar').addEventListener('click', carregarDossie);
dialogo.addEventListener('click', ev => { if (ev.target === dialogo) dialogo.close(); }); // clique no fundo
dialogo.addEventListener('close', () => {
  const origem = dossieAberto?.origem;
  dossieAberto = null;
  $('d-corpo').replaceChildren();
  origem?.focus();
});

// ---------- início ----------
async function iniciar() {
  lerCores();
  fonteChuva = getComputedStyle(document.body).fontFamily;
  if (!CHAVE) {
    const erro = $('erro-geral');
    erro.textContent = 'URL sem chave de acesso: abra o painel pelo endereço impresso pelo servidor.';
    erro.hidden = false;
    definirConexao('desconectado', 'sem chave');
    $('tarefa').textContent = '—';
    return;
  }
  try { await recarregarEstado(); } catch (erro) {
    const caixa = $('erro-geral');
    if (caixa.textContent === SERVIDOR_FORA && !caixa.hidden) { conectar(); return; }
    caixa.textContent = `não consegui ler o estado do painel (${erro.message}). Tentando pelo canal ao vivo…`;
    caixa.hidden = false;
  }
  conectar();
}
iniciar();
