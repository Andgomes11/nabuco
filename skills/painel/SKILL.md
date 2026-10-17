---
name: painel
description: Abre o painel Matrix do time nabuco no navegador - monitores ao vivo de cada funcionário, tarefa ativa, gate e dossiês. Somente leitura e local. Use com /nabuco:painel ou $painel.
---

# Painel do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. A partir da raiz do projeto, rode `node "$NABUCO/scripts/painel/servidor.mjs"` **em segundo plano** (Claude Code: Bash com `run_in_background`; Codex: comando em background do shell). Não espere o processo terminar: ele fica rodando enquanto o painel estiver aberto.
2. Leia a saída inicial: a linha `nabuco painel: <url>` traz o endereço. O navegador abre sozinho; se não abrir, o endereço basta. Se o processo terminar logo em seguida, mostre ao usuário a saída de erro (stderr) dele — por exemplo Node anterior ao 20 ou porta ocupada.
3. Mostre a URL ao usuário. Ela contém a chave de acesso: **não cole em nenhum serviço externo** (buscadores, encurtadores, chats, issues).
4. Se a porta já estiver em uso com `--porta`, rode de novo sem `--porta` (o servidor escolhe uma livre). Use `--sem-abrir` se o usuário não quiser que o navegador abra.

Diga ao usuário que o painel é somente leitura, local (só escuta em `127.0.0.1`) e que, para fechar, basta encerrar o processo em segundo plano.
