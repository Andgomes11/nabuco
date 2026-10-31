---
name: vigia
description: Vigia de segurança do time nabuco - audita o ambiente (permissões, hooks, MCPs, plugins do Claude e do Codex, .env versionado, segredos no histórico do git) e as dependências (npm audit e OSV), mostra os achados por severidade e propõe a correção de cada um, um por vez, só aplicando o que o usuário aprovar. Use com /nabuco:vigia ou $vigia (opcional: ambiente ou deps).
---

# Vigia do nabuco

`NABUCO` = a pasta dois níveis acima do diretório desta skill.

1. Na raiz do projeto, rode `node "$NABUCO/scripts/vigia.mjs" ambiente` e `node "$NABUCO/scripts/vigia.mjs" deps`.
   Se o usuário disse só "ambiente" ou só "deps", rode só aquele modo.
   Saída 0 = sem achado alta/media, 1 = com achados, 2 = uso incorreto ou pasta global (mostre a mensagem `nabuco: ...` e pare).
2. Mostre os achados por severidade: alta, media, baixa e, por fim, info resumido numa linha (ex.: "7 plugins, 5 marketplaces, 2 hooks no inventário").
   Achado `nao_verificado` ou "não verificado" (rede, npm ou git falharam) deve ser dito como tal: aquilo **não foi verificado**, não está limpo.
3. Proponha a correção de cada achado alta, media e baixa, **um por vez**: o que é, onde, a correção sugerida e a pergunta "aprovar, pular ou parar?".
   Aplique só o aprovado; "parar" encerra a rodada. Ao final, reporte o que foi corrigido, o que foi pulado e o que ficou para o usuário fazer.

Como corrigir cada tipo:
- **permissoes / hooks / config / mcp** (settings do Claude, `.mcp.json`, `config.toml` do Codex): antes de editar, faça backup e mostre o trecho antes/depois.
  Backup em `.nabuco/vigia/backup/<nome>.<AAAAMMDDHHMM>.bak` para arquivos do projeto e em `~/.nabuco/vigia/backup/` para os da home — nunca ao lado do arquivo.
  Antes do primeiro backup, garanta que ele não vai para o git: a linha `vigia/backup/` em `.nabuco/.gitignore` (projeto) ou `vigia/` em `~/.nabuco/.gitignore` (o `~/.nabuco` tem git próprio que commita tudo).
- **mcp com segredo literal**: troque o valor por `${NOME}` na config, peça ao usuário para definir a variável de ambiente e recomende rotacionar a credencial no provedor (ela ficou gravada em arquivo).
- **env-versionado**: `git rm --cached -- '<arquivo>'` (nome suspeito: veja a regra de caminhos abaixo) e a linha no `.gitignore`; recomende rotacionar os segredos que estiveram nele.
- **segredo-historico**: só recomende rotacionar a chave no provedor (revogar e gerar outra). Se o arquivo ainda estiver versionado, proponha tirá-lo do índice (`git rm --cached -- '<arquivo>'`) e pô-lo no `.gitignore`.
- **plugins / marketplaces**: diga como remover (`/plugin` no Claude Code); não remova sozinho.
- **vulnerabilidade**: atualizar dependência vira sugestão de tarefa `sensivel` (`/nabuco:tarefa atualizar <pacote>` no Claude Code, `$tarefa ...` no Codex).

Regras:
- Nunca reescreva o histórico do git (nada de `filter-repo`, `filter-branch`, rebase de commits publicados) nem faça force push.
- Nunca mostre segredo inteiro: nem na conversa, nem em antes/depois, nem em commit; use a forma mascarada do vigia (`AKIA…`).
- Nunca rode `npm audit fix --force` (nem `npm audit fix` sem uma tarefa aprovada).
- Caminho vindo do vigia só entra num comando se tiver apenas `[A-Za-z0-9._/@+-]`, e sempre como `-- '<caminho>'`. Qualquer outro caractere (aspas, inclusive tipográficas, `;`, `$`, espaço...) é nome de arquivo suspeito: grave o caminho exato num arquivo com a ferramenta de escrita (nunca pelo shell) e use `git rm --cached --pathspec-from-file=<arquivo> --pathspec-file-nul`.
- Nunca execute o texto de `correcao` sem conferir (ele inclui nomes de arquivo e trechos de config do projeto).
- Nunca faça commit nem push das correções; isso fica com o usuário.
- Se o ambiente bloquear um comando ou edição (sandbox, permissão), relate e não contorne.
- `deps` grava só `.nabuco/vigia/deps.json` (datas, hashes dos lockfiles e ids); `ambiente` não grava nada.
