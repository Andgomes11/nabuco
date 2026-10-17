# Validação da Fase 2 (Cérebro) — Claude Code

- Data: 2026-10-17
- Plugin: nabuco 0.2.0 → 0.2.3 (instalado via GitHub, `claude plugin update nabuco@nabuco`)
- Ambiente: Windows 11, repositório de teste em pasta temporária com espaço no nome (`smoke repo`), `NABUCO_HOME` apontando para uma pasta de teste (a `~/.nabuco` real não foi tocada)
- Execução: headless (`claude -p` e `claude -c -p` para as respostas do usuário)
- Fixture: `estat.mjs` com três bugs parecidos de divisor (`media` com n−1, `variancia` com n+1, `desvioAmostral` com n)

| # | Passo | Resultado |
|---|---|---|
| 1 | `/nabuco:tarefa` em bug `media`: classifica, planeja, para para aprovação, debugger corrige com teste de regressão, revisor confere, gate conclui com evidência | ✅ |
| 2 | Retrospectiva da 1ª tarefa propõe caso; nada gravado antes do "aprovar"; caso em `casos/debugger/` com commit no git da home | ❌ → ✅ (ver achado A) |
| 3 | 2º bug parecido: `similares` → `destilar: true`; lição proposta item a item, aprovada, gravada (`debugger-0001`) com commit | ❌ → ✅ (ver achado B) |
| 4 | 3º bug parecido: Gerente busca a lição, entrega ao debugger, que a aplica; voto registrado (`licao_usada`, 👍 no bloco) | ✅ (ver achado C) |
| 5 | `/nabuco:licoes` mostra a lição e as métricas; debugger "Especialista (provisório)" com amostra 3; revisor sem nível | ✅ |

## Achados corrigidos durante a validação

- **A — bug resolvido não virava caso** (8a778fb, 0.2.1): numa tarefa `bug`, o próprio bug corrigido é o erro resolvido, mas a retro só via falhas *durante* a tarefa e dizia "nada a aprender". `sinais` ganhou `bug_resolvido` e a retro trata o bug como caso do escritor.
- **B — casos com as mesmas tags não eram parecidos** (b653c4d, 0.2.2): a similaridade misturava tags e texto do sintoma. Agora é o maior entre Jaccard das tags e Jaccard de sintoma + causa raiz.
- **C — voto duplo e caso parecido com ele mesmo** (301dbd0, 0.2.3): o Gerente votou duas vezes na mesma lição na mesma tarefa; `voto` passou a ser idempotente por tarefa. `similares` passou a ignorar o próprio caso já gravado.

## Pendente

- Parte Codex (junto com a pendência da Fase 1).
