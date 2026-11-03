---
name: design-mobile
description: Diretrizes para interfaces mobile nativas e multiplataforma (iOS/SwiftUI, Android/Jetpack Compose, React Native, Flutter) seguindo Apple HIG e Material 3, com checklist de acessibilidade e ergonomia. Use ao criar ou alterar telas e componentes mobile.
---

# design-mobile

**Regra principal:** em app nativo, a convenção da plataforma vence a ousadia estética. O usuário já sabe usar o sistema — não o obrigue a reaprender.

## 1. Identifique a plataforma e o design system
- iOS (SwiftUI/UIKit) → Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Android (Compose/Views) → Material Design 3: https://m3.material.io
- React Native / Flutter → siga a plataforma em que a tela roda (componentes adaptativos) ou o design system do produto, se existir.
- Se o projeto já tem tema/tokens, eles mandam.
- Guias mudam com frequência: confira a página oficial antes de decisões de navegação, materiais/efeitos novos ou componentes recentes.

## 2. Padrões de plataforma
- Navegação: iOS usa tab bar e navigation stack com voltar no topo/gesto de borda; Android usa navigation bar/rail e voltar do sistema.
- Tipografia: use os estilos do sistema (Dynamic Type no iOS, type scale do M3 no Android) para escalar com a preferência do usuário.
- Cores: use papéis semânticos (primary, surface, on-surface…) e suporte modo escuro desde o início.
- Componentes: prefira os nativos (pickers, sheets, menus, switches) aos customizados.
- Materiais novos (iOS 26 Liquid Glass, Android Material 3 Expressive): prefira os componentes nativos atualizados a imitar o efeito à mão. Não cite regra específica de uso que você não conferiu na página oficial.

## 3. Verificação
Percorra **checklist.md** (nesta pasta) item a item e informe o resultado na entrega.
Gere screenshots no simulador/emulador quando possível, em tamanho de fonte padrão e no maior, claro e escuro.
