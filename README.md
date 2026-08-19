# Floor Vision MVP

Visualizador de pisos para ambientes reais, preparado para deploy na Vercel.

## Implementado

### Etapa 1 — Segmentação
- Upload de JPG/PNG/WEBP
- Segmentação semântica do piso no navegador com SegFormer/ADE20K
- Máscara binária do piso
- Fallback de marcação manual

### Etapa 2 — Perspectiva
- Seleção do maior componente conectado da máscara
- Estimativa automática do quadrilátero visível do piso
- Cálculo de homografia 3×3
- Grade projetada para conferência visual
- Ajuste manual dos quatro cantos
- Visualização/cópia da matriz H

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

A saída de produção fica em `dist/`.

## Vercel

- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

O processamento das Etapas 1 e 2 acontece no navegador, evitando backend pesado na Vercel.

## Próxima etapa

Etapa 3: deformar a textura usando a homografia, recortar pela máscara e recompor preservando luminância e sombras da foto original.
