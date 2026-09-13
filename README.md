# SimpleJigsaw

Rompecabezas (jigsaw) estático pensado para un **iPad mini 1 con iOS 9.3.5**, servido desde
**GitHub Pages**. No hay backend: una herramienta local (`build.ts`) genera el catálogo de
imágenes y el frontend es HTML + CSS + JavaScript ES5 puro con Canvas 2D.

```
SimpleJigsaw/
├── images-source/        # Aquí van tus imágenes originales (jpg, png, webp, heic, ...)
├── build.ts              # Genera thumbs, imágenes optimizadas y catalog.json
├── serve.ts              # Servidor estático local para probar en el iPad por WiFi
├── package.json          # pnpm + sharp
├── docs/                 # Sitio final (lo que publica GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js            # ES5, sin frameworks ni CDN
│   ├── catalog.json      # Generado
│   ├── thumbs/           # Generado (~300px, JPEG liviano)
│   ├── images/           # Generado (alta calidad, máx. 1600px, JPEG optimizado)
│   └── apple-touch-icon.png
└── .github/workflows/
    ├── deploy-pages.yml  # Build + deploy a GitHub Pages en cada push a main
    └── ci.yml            # Verificación en pull requests
```

## Requisitos

- Node.js **>= 22.6** (usa TypeScript nativo: `node build.ts`, sin transpilar). Probado con Node 24.
- pnpm (`corepack enable pnpm` o `npm i -g pnpm`).

## Agregar imágenes nuevas al catálogo

1. Copia las imágenes en `images-source/`. El nombre del archivo se convierte en el título
   (`noche_estrellada.jpg` → "Noche estrellada").
2. Ejecuta:

   ```sh
   pnpm install
   node build.ts        # o: pnpm build
   ```

   Esto regenera por completo `docs/thumbs/`, `docs/images/` y `docs/catalog.json`.
   Se respeta la orientación EXIF y las imágenes se limitan a 1600px de lado mayor
   (suficiente para la pantalla de 1024×768 y seguro para la memoria del iPad mini 1).
3. Haz commit y push. Si usas el workflow, el build también corre en GitHub Actions, así que
   incluso basta con subir solo `images-source/`.

Para probar en el iPad antes de publicar, en la misma red WiFi:

```sh
node serve.ts          # muestra http://<ip-de-tu-mac>:8080
```

## Publicar en GitHub Pages

### Opción A: con GitHub Actions (recomendada, incluye el build)

1. Sube el repositorio a GitHub con la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
3. Cada push a `main` ejecuta `.github/workflows/deploy-pages.yml`: instala pnpm, corre
   `node build.ts` y publica `/docs`.
4. La URL queda como `https://<usuario>.github.io/<repo>/`.

### Opción B: sin Actions, sirviendo la carpeta /docs

1. Ejecuta `node build.ts` en tu máquina y haz commit de `/docs` (ya incluye `.nojekyll`).
2. **Settings → Pages → Source: "Deploy from a branch"**, rama `main`, carpeta `/docs`.

## Abrir en el iPad y agregar a la pantalla de inicio

1. En Safari del iPad abre `https://<usuario>.github.io/<repo>/`.
2. Toca el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elige **«Agregar a pantalla de inicio»** y confirma.
4. El icono "Rompecabezas" abre la app a pantalla completa (sin barra de Safari) gracias a
   las etiquetas `apple-mobile-web-app-capable`.

Nota: el iPad mini 1 no tiene certificados raíz recientes en iOS 9.3.5, pero GitHub Pages
funciona con Safari 9. Si una imagen no carga tras actualizar el catálogo, recarga la página
(el `catalog.json` se pide con un parámetro anti-caché; las imágenes se cachean por nombre).

## Cómo funciona el frontend

- **Catálogo**: `catalog.json` se pide con `XMLHttpRequest`; los thumbnails se muestran en una
  galería. Al elegir uno, la imagen en alta calidad se descarga por XHR (`blob`) y se decodifica
  con `URL.createObjectURL` (con fallback a `<img src>`).
- **Foto propia**: `<input type="file" accept="image/*">` + `FileReader`. Todo ocurre en el
  dispositivo. Se lee la orientación EXIF y se corrige el "aplastado" vertical que Safari iOS
  antiguo aplica a JPEG grandes; la foto se reduce a 1600px.
- **Piezas**: de 12 a 100. Se elige filas × columnas según el aspect ratio para que las
  piezas sean casi cuadradas.
- **Forma real de rompecabezas**: cada borde interior es una curva de 3 tramos `bezierCurveTo`
  con tab o muesca aleatoria. El borde se define una sola vez en coordenadas compartidas y la
  pieza vecina lo recorre al revés, por lo que encajan exactamente.
- **Rendimiento**: cada pieza se pre-renderiza en su propio canvas (recorte + contorno). Hay dos
  canvas apilados: el de fondo (tablero, guía y piezas) solo se redibuja al tomar o soltar una
  pieza; el superior dibuja únicamente la pieza que se arrastra en cada movimiento.
- **Interacción**: eventos táctiles (`touchstart/move/end`) y de mouse, hit-test por alpha del
  canvas de la pieza, snap cuando la pieza queda a menos del 30 % de su tamaño del destino.
- **Victoria**: al encajar todas las piezas aparece el mensaje con botones «Mezclar de nuevo» y
  «Elegir otra imagen». El botón **Guía** muestra u oculta la imagen atenuada en el tablero.

Para depurar desde la consola: `SimpleJigsaw.state()` devuelve el estado de la partida.
