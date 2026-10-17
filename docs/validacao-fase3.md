# Validação da Fase 3 (Painel) — Claude Code

- Data: 2026-10-17
- Plugin instalado: nabuco 0.2.3 (tem `/nabuco:tarefa`, ainda sem `/nabuco:painel`); o servidor do painel foi rodado direto deste repositório (`scripts/painel/servidor.mjs --sem-abrir`), branch `fase3-painel`
- Ambiente: Windows 11, repositório de teste `smoke repo` (pasta com espaço), `NABUCO_HOME` apontando para uma cópia do cérebro de teste (`val3-home`); a `~/.nabuco` real não foi tocada. Painel aberto no Chrome via chrome-devtools MCP
- Execução: headless (`claude -p` e `claude -c -p`), tarefa real `soma` (média/bug) com o painel aberto
- Fixture: nova função `soma` com bug de valor inicial (`s = 1`) e teste `soma([1,2,3]) === 6`

| # | Passo | Resultado |
|---|---|---|
| 1 | Servidor sobe, imprime `nabuco painel: <url>`; 1440 px mostra 10 monitores; Debugger com avatar de nível e "provisório"; os outros "sem avaliação" em cinza (`validacao-fase3/01-inicial.png`) | ✅ |
| 2 | Tarefa aguardando aprovação: cabeçalho com a tarefa e fase "aguardando aprovacao", Gerente vermelho "aguardando você" (`02-aguardando-aprovacao.png`) | ✅ |
| 3 | Durante a execução: Gerente "trabalhando", Debugger "trabalhando" durante o subagente (`03-executando-debugger.png`) | ✅ |
| 4 | Fase "checando" com gate atualizado 2/2 e Gerente trabalhando (`03-checando-gate.png`) | ✅ |
| 5 | Revisor "trabalhando" durante a conferência | ❌ não capturado (ver achado A) |
| 6 | Fim: "nenhuma tarefa ativa", todos ociosos, contagem de eventos subiu (`04-final.png`) | ✅ |
| 7 | Dossiê do Debugger: atributos, indicadores, equipamento, diário com os casos, lição `debugger-0001` com votos; clicar num número abre a lista dos eventos de origem (`05-dossie-debugger.png`) | ✅ (ver achado B) |
| 8 | URL sem `?k=` (e com chave errada) responde 403 (`06-sem-chave-403.png`) | ✅ |
| 9 | 390 px (emulação mobile): grade em 2 colunas, sem rolagem horizontal (`07-mobile-390.png`); console sem erros nem avisos em toda a sessão | ✅ (ver achado C) |
| 10 | Servidor e processos de fundo encerrados | ✅ |

## Achados

- **A — revisor não visto trabalhando**: o subagente do revisor durou ~18 s (20:56:39 a 20:56:57 nos eventos, com `agente_inicio`/`agente_fim` corretos) e o intervalo entre capturas ficou parecido; as capturas pegaram o Debugger e o gate, mas nenhuma pegou o card do Revisor ativo. Não é falha comprovada do painel, é falta de captura; vale rever com uma tarefa mais longa.
- **B — diário sem o caso da tarefa**: a tarefa foi rodada "sem retrospectiva", então o diário continua com os 2 casos antigos e a amostra subiu para 4 só pelos eventos da tarefa. Comportamento esperado. Os horários no detalhe de origem aparecem no fuso local (13:01), os eventos estão em UTC.
- **C — janela do Chrome**: `resize_page` não passou de 500 px de largura (mínimo da janela); o 390 px foi validado com emulação de dispositivo (`scrollWidth` = `innerWidth` = 390).
- Nenhum código foi alterado durante a validação.

## Pendente

- Parte Codex e `/nabuco:painel` instalado via plugin (depois do push/atualização).
