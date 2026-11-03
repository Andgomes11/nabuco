---
name: design-web
description: Direção de design para interfaces web com qualidade de produto - tokens antes do código, estados completos, acessibilidade e autocrítica com screenshot, evitando a aparência genérica de interface gerada por IA. Use ao criar ou alterar telas, componentes ou estilos web.
---

# design-web

## 1. Contexto primeiro
- Quem usa, para quê, em que dispositivo? Qual o tom (sóbrio, lúdico, técnico, editorial)?
- **Se o projeto já tem design system/tema/tokens, eles mandam.** Reuse componentes existentes; não crie variações paralelas.

## 2. Direção estética explícita
Escreva em 2–3 linhas a direção escolhida (referências, tipografia, paleta, densidade) antes de codar. Uma direção clara e coerente vale mais que efeitos.
Revise a direção: se ela serviria para qualquer produto parecido, refaça. Escolha um elemento memorável e deixe o resto quieto.

## 3. Tokens antes do código
Defina como variáveis (CSS custom properties ou tema do framework): cores (com pares texto/fundo), escala tipográfica, espaçamento (escala fixa, ex. 4/8), raios, sombras, durações de animação. Nada de valores soltos espalhados.
Separe tokens primitivos (a paleta crua) de semânticos (`primary`, `on-primary`, `surface`, `danger`); os componentes usam só os semânticos. Um arquivo de tokens novo usa o formato DTCG 2025.10 (`$value`, `$type`); um que já existe mantém o formato dele.

## 4. Implementação
- Estados: padrão, hover, foco visível, ativo, desabilitado, carregando, vazio, erro.
- Responsivo do menor ao maior breakpoint; sem rolagem horizontal.
- WCAG 2.2 AA: alvos ≥ 24×24 px (44 px em toque: AAA/HIG); o foco nunca fica escondido atrás de header ou rodapé fixo; todo arrastar tem alternativa por clique; o login deixa colar a senha e usar gerenciador de senhas; não peça de novo dado já informado no mesmo fluxo.
- HTML semântico (botão é `button`, link é `a`), labels em formulários, `alt` útil.
- Contraste mínimo 4.5:1 para texto normal (3:1 para texto grande e componentes de UI).
- Hierarquia por peso e cor, não só por tamanho; nada de cinza sobre fundo colorido.
- Mensagem de erro ao lado do campo, específica, com o próximo passo, sem culpar o usuário e preservando o que foi digitado. Todo estado vazio diz o que fazer e oferece a ação.
- Respeite `prefers-reduced-motion` e `prefers-color-scheme` quando houver tema escuro.

## 5. Evite a "cara de IA"
Sinais comuns: Inter/Roboto/Arial/Space Grotesk por inércia; roxo-azul em fundo branco, creme com terracota, quase-preto com um acento neon; cards iguais com o mesmo raio e sombra; fade/slide-up em toda seção e hover em todo card; eyebrow em caixa-alta espaçada; uma palavra do título colorida; "A · B · C"; seta → em todo botão; número grande + label + gradiente; emojis no lugar de ícones; ícones de bibliotecas misturadas; texto de marketing vazio.
Proibir não basta: para cada sinal que aparecer, escolha o substituto a partir da direção (§2) e escreva qual foi.

## 6. Ferramentas opcionais (use se estiverem disponíveis na sessão)
- Plugin Figma (design → código, código → design).
- `ui-ux-pro-max` (base de estilos, paletas e regras por setor).
- `chrome-devtools-mcp:a11y-debugging` e screenshots do Chrome DevTools.

## Autocrítica
Antes de entregar, gere screenshot (desktop e mobile) e confira:
1. A hierarquia visual leva o olho ao que importa primeiro?
2. Espaçamentos e alinhamentos seguem a escala de tokens?
3. Todos os estados existem e foram vistos?
4. Contraste e foco visível passam?
5. Parece com o resto do produto (ou com a direção escolhida)?
6. Dá para usar só pelo teclado (ordem, foco visível, nada preso)? axe e Lighthouse pegam só parte dos problemas.
7. Se algo que você acrescentou não faz falta, remova um elemento antes de entregar.
Corrija o que falhar e só então entregue, anexando os screenshots como evidência.
