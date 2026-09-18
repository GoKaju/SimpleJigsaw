# SimpleJigsaw

Rompecabezas (jigsaw) estático pensado para un **iPad mini 1 con iOS 9.3.5**, servido desde
**GitHub Pages**. No hay backend: una herramienta local (`build.ts`) genera el catálogo de
imágenes y el frontend es HTML + CSS + JavaScript ES5 puro con Canvas 2D.

```
SimpleJigsaw/
├── images-source/        # Aquí van tus imágenes originales (jpg, png, webp, heic, ...)
│   ├── Dinosaurios/      # Cada subcarpeta es una categoría en la galería
│   └── ...               # Las imágenes sueltas en la raíz caen en «Otras»
├── build.ts              # Genera thumbs, imágenes optimizadas y catalog.json
├── serve.ts              # Servidor estático local para probar en el iPad por WiFi
├── package.json          # pnpm + sharp
├── docs/                 # Sitio final (lo que publica GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js            # ES5, sin frameworks ni CDN
│   ├── catalog.json      # Generado (imágenes + categorías)
│   ├── thumbs/           # Generado (~300px, JPEG liviano), una carpeta por categoría
│   ├── images/           # Generado (alta calidad, máx. 1600px), una carpeta por categoría
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

   **Categorías**: cada subcarpeta de `images-source/` es una categoría, y el nombre de la
   carpeta es el que se muestra en la galería (acentos y espacios incluidos). Las imágenes
   sueltas en la raíz quedan en la categoría «Otras».

   ```
   images-source/
   ├── Dinosaurios/       → categoría "Dinosaurios"
   ├── Animales del mar/  → categoría "Animales del mar"
   └── suelta.jpg         → categoría "Otras"
   ```

   Con dos o más categorías, la galería muestra botones para filtrar («Todas» + una por
   carpeta, con el número de imágenes). Con una sola categoría no hay nada que filtrar y
   solo se muestra su nombre.
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
  galería agrupada por categorías. Al elegir uno, la imagen en alta calidad se descarga por XHR
  (`blob`) y se decodifica con `URL.createObjectURL` (con fallback a `<img src>`).
- **Categorías**: salen de las subcarpetas de `images-source/`. El build las escribe en
  `catalog.json` con su nombre y su conteo, y replica la estructura en `docs/thumbs/` y
  `docs/images/`.
- **Piezas**: 12, 24, 48, 72 o 100 (botones grandes, pensados para un niño pequeño). Se elige
  filas × columnas según el aspect ratio para que las piezas sean casi cuadradas.
- **Guía**: opción «Con guía» (imagen atenuada en el tablero) o «Sin guía» (el tablero muestra
  una textura de colores). Se elige antes de jugar y no se puede cambiar durante la partida.
- **Pantalla de juego sin distracciones**: el tablero ocupa toda la pantalla. Solo hay un contador
  discreto en una esquina y un punto gris en la otra. Salir o mezclar exige **mantener pulsado**
  ese punto casi un segundo, para que un niño pequeño no interrumpa la partida sin querer.
- **Forma real de rompecabezas**: cada borde interior es una curva de 3 tramos `bezierCurveTo`
  con tab o muesca aleatoria. El borde se define una sola vez en coordenadas compartidas y la
  pieza vecina lo recorre al revés, por lo que encajan exactamente.
- **Rendimiento**: cada pieza se pre-renderiza en su propio canvas (recorte + contorno). Hay dos
  canvas apilados: el de fondo (tablero, guía y piezas) solo se redibuja al tomar o soltar una
  pieza; el superior dibuja solo la pieza que se arrastra y el destello de las recién encajadas.
- **Interacción**: eventos táctiles (`touchstart/move/end`) y de mouse, hit-test por alpha del
  canvas de la pieza, snap cuando la pieza queda a menos del 30 % de su tamaño del destino.
- **Al encajar una pieza**: suena un clic corto generado con Web Audio (sin archivos que
  descargar) y la pieza da un pequeño rebote con un destello que se apaga en 280 ms. No hay
  vibración porque iOS no expone la API y el iPad no tiene motor háptico; si el iPad está en
  silencio, el destello sigue confirmando el acierto.
- **Victoria**: al encajar todas las piezas cae una lluvia de confeti y estrellas sobre el canvas
  y aparece un mensaje colorido con botones «Mezclar de nuevo» y «Elegir otra imagen».

Para depurar desde la consola: `SimpleJigsaw.state()` devuelve el estado de la partida.
