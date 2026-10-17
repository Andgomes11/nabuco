---
name: docs-atuais
description: Consulta a documentação da versão INSTALADA de uma lib, framework ou ferramenta antes de usá-la. Use antes de escrever código que dependa de APIs de terceiros, ao migrar versões ou quando um erro sugerir mudança de API.
---

# docs-atuais — documentação da versão instalada

`NABUCO` = a pasta dois níveis acima do diretório desta skill (raiz do plugin nabuco).

## Passos
1. Liste os pacotes que a tarefa vai usar de forma não trivial.
2. Na raiz do projeto, rode:
   `node "$NABUCO/scripts/versoes.mjs" <pacote> [pacote...]`
   - `versao` exata vinda de lockfile → use essa versão.
   - `fonte: "package.json (faixa)"` → a versão real pode ser qualquer uma da faixa; diga isso.
   - `versao: null` → não está instalado; não presuma a versão — pergunte ou proponha no plano.
3. Busque a documentação **dessa versão**, nesta ordem de preferência:
   1. Um exemplo vivo no próprio repositório usando a mesma API.
   2. Documentação oficial versionada (URL com a versão, seletor de versão do site, docs no repositório na tag da versão).
   3. Ferramenta de docs disponível na sessão (ex.: MCP Context7), informando a versão.
   4. CHANGELOG / guia de migração entre a versão instalada e a que o seu conhecimento assume.
4. Se a API que você lembra mudou nessa versão, siga a documentação, não a memória.

## Entrega
Resuma em até 10 linhas: pacote@versão, APIs relevantes e como usá-las, armadilhas da versão, e os links consultados.
Nunca afirme que algo existe numa versão sem ter visto na fonte.
