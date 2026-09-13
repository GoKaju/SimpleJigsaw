/*
 * SimpleJigsaw - app.js
 * ES5 puro: compatible con Safari de iOS 9.3.5 (iPad mini 1).
 * Sin let/const, arrow functions, clases, template literals ni Promises.
 */
(function () {
  'use strict';

  var VERSION = '1.3.0';
  var MAX_SRC = 1600;          // lado maximo de la imagen fuente (fotos subidas)
  var TAB = 0.1;               // tamano del tab relativo al lado de la pieza (altura = 3*TAB)
  var MARGIN_FACTOR = 0.36;    // margen alrededor de cada pieza para que quepan los tabs
  var MIN_PIECES = 12, MAX_PIECES = 100;
  var GHOST_ALPHA = 0.25;
  var MENU_HOLD_MS = 900;      // pulsacion larga para abrir el menu de adultos
  var COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#ff8c42', '#ffffff'];

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var catalog = [];            // entradas de catalog.json
  var categories = [];         // categorias del catalogo (carpetas de images-source)
  var activeCategory = '';     // '' = todas
  var selected = null;         // entrada elegida
  var selectedItem = null;     // nodo DOM del thumbnail elegido
  var sourceCache = {};        // id -> Image
  var guideDefault = true;     // opcion elegida en el catalogo
  var confetti = null;         // animacion de victoria
  var targetPieces = 24;
  var game = null;
  var el = {};
  var staticLayer = null;      // canvas fuera de pantalla: tablero + piezas encajadas
  var frameRequested = false;
  var resizeTimer = null;

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function setText(node, text) { node.textContent = text; }
  function show(node) { node.className = node.className.replace(/\s*\bhidden\b/g, ''); }
  function hide(node) { if (!/\bhidden\b/.test(node.className)) node.className += ' hidden'; }
  function toggleClass(node, cls, on) {
    var re = new RegExp('\\s*\\b' + cls + '\\b', 'g');
    node.className = node.className.replace(re, '');
    if (on) node.className += ' ' + cls;
  }
  function createCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function sizeCanvas(c, w, h) {
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function requestFrame(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else if (window.webkitRequestAnimationFrame) window.webkitRequestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  function xhrGet(url, responseType, onOk, onErr, onProgress) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    if (responseType) { try { xhr.responseType = responseType; } catch (e) { /* no soportado */ } }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && (xhr.response || xhr.responseText));
      if (ok) onOk(xhr); else onErr(new Error('HTTP ' + xhr.status + ' al pedir ' + url));
    };
    if (onProgress) {
      xhr.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onerror = function () { onErr(new Error('Error de red al pedir ' + url)); };
    xhr.send(null);
  }

  function loadImageTag(url, onOk, onErr) {
    var img = new Image();
    img.onload = function () { onOk(img); };
    img.onerror = function () { onErr(new Error('No se pudo cargar ' + url)); };
    img.src = url;
  }

  // Descarga la imagen por XHR (mismo origen, con progreso) y la decodifica via Blob URL.
  // Si algo no esta disponible, cae a <img src>.
  function loadImageXHR(url, onOk, onErr, onProgress) {
    var URLObj = window.URL || window.webkitURL;
    if (!URLObj || !URLObj.createObjectURL || !window.Blob) { loadImageTag(url, onOk, onErr); return; }
    xhrGet(url, 'blob', function (xhr) {
      var blob = xhr.response;
      if (!blob || typeof blob === 'string') { loadImageTag(url, onOk, onErr); return; }
      var objUrl;
      try { objUrl = URLObj.createObjectURL(blob); } catch (e) { loadImageTag(url, onOk, onErr); return; }
      var img = new Image();
      img.onload = function () { try { URLObj.revokeObjectURL(objUrl); } catch (e) {} onOk(img); };
      img.onerror = function () { try { URLObj.revokeObjectURL(objUrl); } catch (e) {} loadImageTag(url, onOk, onErr); };
      img.src = objUrl;
    }, function () { loadImageTag(url, onOk, onErr); }, onProgress);
  }

  // Tamano en pixeles reales del bitmap (lo que drawImage usa como sistema fuente).
  function srcWidth(src) { return src.naturalWidth || src.width; }
  function srcHeight(src) { return src.naturalHeight || src.height; }

  // ------------------------------------------------------------------
  // Catalogo
  // ------------------------------------------------------------------
  function loadCatalog() {
    setText(el.catalogStatus, 'Cargando catálogo…');
    xhrGet('catalog.json?v=' + new Date().getTime(), '', function (xhr) {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) {
        setText(el.catalogStatus, 'catalog.json no es válido.');
        return;
      }
      catalog = data.images || [];
      categories = data.categories || [];
      activeCategory = '';
      renderCategories();
      renderGallery();
      setText(el.catalogStatus, catalog.length ? '' :
        'El catálogo está vacío. Agrega imágenes en images-source/ y ejecuta node build.ts.');
    }, function (err) {
      setText(el.catalogStatus, 'No se pudo cargar el catálogo (' + err.message + '). Puedes subir una foto propia.');
    });
  }

  // Una carpeta de images-source es una categoria. Con una sola categoria no hay
  // nada que filtrar, asi que se muestra solo su nombre.
  function renderCategories() {
    el.categories.innerHTML = '';
    if (categories.length < 1) { hide(el.categories); return; }
    show(el.categories);

    if (categories.length === 1) {
      var label = document.createElement('span');
      label.className = 'cat-label';
      label.appendChild(document.createTextNode(categories[0].name));
      el.categories.appendChild(label);
      return;
    }

    addCategoryButton({ id: '', name: 'Todas', count: catalog.length });
    for (var i = 0; i < categories.length; i++) addCategoryButton(categories[i]);
  }

  function addCategoryButton(cat) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-cat' + (cat.id === activeCategory ? ' active' : '');
    btn.appendChild(document.createTextNode(cat.name));
    var count = document.createElement('span');
    count.className = 'cat-count';
    count.appendChild(document.createTextNode(String(cat.count)));
    btn.appendChild(count);
    btn.onclick = function () { selectCategory(cat.id); };
    el.categories.appendChild(btn);
  }

  function selectCategory(id) {
    if (activeCategory === id) return;
    activeCategory = id;
    var btns = el.categories.getElementsByTagName('button');
    for (var i = 0; i < btns.length; i++) toggleClass(btns[i], 'active', false);
    renderCategories();
    renderGallery();
  }

  function renderGallery() {
    el.gallery.innerHTML = '';
    selectedItem = null;
    var shown = 0;
    for (var i = 0; i < catalog.length; i++) {
      var entry = catalog[i];
      if (activeCategory && entry.category !== activeCategory) continue;
      var item = addGalleryItem(entry);
      shown++;
      // Conserva la seleccion si la imagen elegida sigue visible.
      if (selected && selected.id === entry.id) { selectedItem = item; toggleClass(item, 'selected', true); }
    }
    if (shown === 0 && catalog.length > 0) show(el.galleryEmpty); else hide(el.galleryEmpty);
  }

  function addGalleryItem(entry) {
    var item = document.createElement('div');
    item.className = 'thumb';
    var img = document.createElement('img');
    img.src = entry.thumb;
    img.alt = entry.name;
    var cap = document.createElement('div');
    cap.className = 'thumb-name';
    cap.appendChild(document.createTextNode(entry.name));
    item.appendChild(img);
    item.appendChild(cap);
    item.onclick = function () { selectEntry(entry, item); };
    el.gallery.appendChild(item);
    return item;
  }

  function selectEntry(entry, item) {
    selected = entry;
    if (selectedItem) toggleClass(selectedItem, 'selected', false);
    selectedItem = item;
    toggleClass(item, 'selected', true);
    el.btnPlay.disabled = false;
    updatePieceLabel();
  }

  function updatePieceLabel() {
    var text = targetPieces + ' piezas';
    if (selected) {
      var g = computeGrid(targetPieces, selected.width / selected.height);
      text = (g.rows * g.cols) + ' piezas  (' + g.rows + ' × ' + g.cols + ')';
    }
    setText(el.pieceLabel, text);
    for (var i = 0; i < el.presets.length; i++) {
      toggleClass(el.presets[i], 'active', parseInt(el.presets[i].getAttribute('data-n'), 10) === targetPieces);
    }
  }

  function setTargetPieces(n) {
    targetPieces = clamp(parseInt(n, 10) || MIN_PIECES, MIN_PIECES, MAX_PIECES);
    updatePieceLabel();
  }

  function setGuideDefault(on) {
    guideDefault = !!on;
    toggleClass(el.optGuideOn, 'active', guideDefault);
    toggleClass(el.optGuideOff, 'active', !guideDefault);
  }

  function getSource(entry, ok, err) {
    if (sourceCache[entry.id]) { ok(sourceCache[entry.id]); return; }
    // Liberamos la imagen cargada antes para no acumular memoria.
    sourceCache = {};
    loadImageXHR(entry.image, function (img) {
      sourceCache[entry.id] = img;
      ok(img);
    }, err, function (p) {
      setLoadingText('Cargando imagen… ' + Math.round(p * 100) + '%');
    });
  }

  // ------------------------------------------------------------------
  // Geometria del rompecabezas
  // ------------------------------------------------------------------
  // Elige filas x columnas cercano a n manteniendo piezas casi cuadradas.
  function computeGrid(n, aspect) {
    var best = null;
    for (var cols = 2; cols <= 25; cols++) {
      for (var rows = 2; rows <= 25; rows++) {
        var count = rows * cols;
        if (count < MIN_PIECES || count > MAX_PIECES) continue;
        var pieceAspect = (aspect / cols) * rows;
        var score = Math.abs(count - n) + Math.abs(Math.log(pieceAspect)) * 6;
        if (!best || score < best.score) best = { rows: rows, cols: cols, score: score };
      }
    }
    return best;
  }

  // Un borde en espacio unitario: 10 puntos [l, w]; l a lo largo del borde,
  // w perpendicular (positivo = hacia abajo/derecha). flip decide hacia donde sale el tab.
  function makeEdge(flip) {
    var t = TAB;
    var a = rnd(-0.03, 0.03), b = rnd(-0.03, 0.03), c = rnd(-0.03, 0.03), d = rnd(-0.03, 0.03), e = rnd(-0.03, 0.03);
    var pts = [
      [0, 0],
      [0.2, a],
      [0.5 + b + d, -t + c],
      [0.5 - t + b, t + c],
      [0.5 - 2 * t + b - d, 3 * t + c],
      [0.5 + 2 * t + b - d, 3 * t + c],
      [0.5 + t + b, t + c],
      [0.5 + b + d, -t + c],
      [0.8, e],
      [1, 0]
    ];
    for (var i = 0; i < pts.length; i++) pts[i][1] *= flip;
    return pts;
  }

  function edgeForward(ctx, pts, map) {
    for (var i = 1; i < 10; i += 3) {
      var p1 = map(pts[i]), p2 = map(pts[i + 1]), p3 = map(pts[i + 2]);
      ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    }
  }
  function edgeReverse(ctx, pts, map) {
    for (var i = 8; i >= 2; i -= 3) {
      var p1 = map(pts[i]), p2 = map(pts[i - 1]), p3 = map(pts[i - 2]);
      ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    }
  }

  // Traza el contorno de la pieza (r, c). ox/oy: donde cae la esquina (0,0) del tablero.
  function tracePiece(ctx, r, c, ox, oy) {
    var pw = game.pw, ph = game.ph, rows = game.rows, cols = game.cols;
    var x0 = ox + c * pw, y0 = oy + r * ph, x1 = x0 + pw, y1 = y0 + ph;

    function hMap(R, C) { return function (p) { return [ox + (C + p[0]) * pw, oy + R * ph + p[1] * ph]; }; }
    function vMap(R, C) { return function (p) { return [ox + C * pw + p[1] * pw, oy + (R + p[0]) * ph]; }; }

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    if (r === 0) ctx.lineTo(x1, y0); else edgeForward(ctx, game.hEdges[r][c], hMap(r, c));
    if (c === cols - 1) ctx.lineTo(x1, y1); else edgeForward(ctx, game.vEdges[r][c + 1], vMap(r, c + 1));
    if (r === rows - 1) ctx.lineTo(x0, y1); else edgeReverse(ctx, game.hEdges[r + 1][c], hMap(r + 1, c));
    if (c === 0) ctx.lineTo(x0, y0); else edgeReverse(ctx, game.vEdges[r][c], vMap(r, c));
    ctx.closePath();
  }

  // Pre-renderiza cada pieza en su propio canvas (recorte + contorno).
  function renderPieces() {
    var m = game.margin, pw = game.pw, ph = game.ph;
    var sx = game.iw / game.bw, sy = game.ih / game.bh;   // px de imagen por px de tablero
    var w = Math.ceil(pw + 2 * m), h = Math.ceil(ph + 2 * m);
    for (var i = 0; i < game.pieces.length; i++) {
      var p = game.pieces[i];
      p.canvas = null;
      var canvas = createCanvas(w, h);
      var ctx = canvas.getContext('2d');
      var ox = m - p.c * pw, oy = m - p.r * ph;
      ctx.save();
      tracePiece(ctx, p.r, p.c, ox, oy);
      ctx.clip();
      // Region del tablero cubierta por este canvas, recortada a la imagen.
      var bx0 = p.c * pw - m, by0 = p.r * ph - m, bx1 = bx0 + w, by1 = by0 + h;
      var cx0 = Math.max(0, bx0), cy0 = Math.max(0, by0);
      var cx1 = Math.min(game.bw, bx1), cy1 = Math.min(game.bh, by1);
      ctx.drawImage(game.src,
        cx0 * sx, cy0 * sy, (cx1 - cx0) * sx, (cy1 - cy0) * sy,
        cx0 - bx0, cy0 - by0, cx1 - cx0, cy1 - cy0);
      ctx.restore();
      // Contorno: sombra oscura fina + brillo interior sutil.
      tracePiece(ctx, p.r, p.c, ox, oy);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke();
      p.canvas = canvas;
      p.ctx = ctx;
      p.w = w;
      p.h = h;
    }
  }

  // ------------------------------------------------------------------
  // Partida
  // ------------------------------------------------------------------
  function newGame(src, entry) {
    var iw = srcWidth(src), ih = srcHeight(src);
    var grid = computeGrid(targetPieces, iw / ih);
    game = {
      src: src, iw: srcWidth(src), ih: srcHeight(src), logicalW: iw, logicalH: ih,
      rows: grid.rows, cols: grid.cols, entry: entry,
      hEdges: [], vEdges: [], pieces: [], loose: [],
      guide: guideDefault, drag: null, won: false
    };
    stopConfetti();
    var r, c;
    for (r = 1; r < game.rows; r++) {
      game.hEdges[r] = [];
      for (c = 0; c < game.cols; c++) game.hEdges[r][c] = makeEdge(Math.random() < 0.5 ? 1 : -1);
    }
    for (r = 0; r < game.rows; r++) {
      game.vEdges[r] = [];
      for (c = 1; c < game.cols; c++) game.vEdges[r][c] = makeEdge(Math.random() < 0.5 ? 1 : -1);
    }
    for (r = 0; r < game.rows; r++) {
      for (c = 0; c < game.cols; c++) {
        game.pieces.push({ r: r, c: c, locked: false, x: 0, y: 0, nx: Math.random(), ny: Math.random() });
      }
    }
    hide(el.overlay);
    layoutGame(false);
    scatter();
    rebuildStatic();
    redrawBg(null);
    updateCounter();
  }

  // Calcula tamano del tablero y de las piezas segun el area de juego.
  // keepPositions: conservar posiciones (normalizadas) de las piezas sueltas.
  function layoutGame(keepPositions) {
    var rect = el.playArea.getBoundingClientRect();
    var W = Math.max(200, Math.floor(rect.width)), H = Math.max(200, Math.floor(rect.height));
    game.W = W; game.H = H;
    sizeCanvas(el.bg, W, H);
    sizeCanvas(el.fg, W, H);
    staticLayer = createCanvas(W, H);

    var maxW = W * 0.66, maxH = H * 0.84;
    var s = Math.min(maxW / game.logicalW, maxH / game.logicalH);
    // Piezas de tamano entero para evitar costuras entre vecinas.
    game.pw = Math.max(8, Math.floor(game.logicalW * s / game.cols));
    game.ph = Math.max(8, Math.floor(game.logicalH * s / game.rows));
    game.bw = game.pw * game.cols;
    game.bh = game.ph * game.rows;
    game.bx = Math.round((W - game.bw) / 2);
    game.by = Math.round((H - game.bh) / 2);
    game.margin = Math.ceil(Math.max(game.pw, game.ph) * MARGIN_FACTOR);
    game.snap = Math.max(14, Math.min(game.pw, game.ph) * 0.3);

    renderPieces();

    for (var i = 0; i < game.pieces.length; i++) {
      var p = game.pieces[i];
      p.tx = game.bx + p.c * game.pw - game.margin;
      p.ty = game.by + p.r * game.ph - game.margin;
      if (p.locked) { p.x = p.tx; p.y = p.ty; }
      else if (keepPositions) {
        p.x = p.nx * Math.max(0, W - p.w);
        p.y = p.ny * Math.max(0, H - p.h);
      }
    }
  }

  // Reparte las piezas sueltas: en las franjas libres alrededor del tablero si hay
  // espacio suficiente; si no, por toda el area de juego.
  function scatter() {
    var W = game.W, H = game.H, m = game.margin;
    var pieceW = game.pw + 2 * m, pieceH = game.ph + 2 * m;
    var bx = game.bx - m, by = game.by - m, bw = game.bw + 2 * m, bh = game.bh + 2 * m;
    var bands = [], total = 0;
    function addBand(x, y, w, h) {
      if (w >= pieceW && h >= pieceH) { bands.push({ x: x, y: y, w: w, h: h, area: w * h }); total += w * h; }
    }
    addBand(0, 0, bx, H);
    addBand(bx + bw, 0, W - (bx + bw), H);
    addBand(bx, 0, bw, by);
    addBand(bx, by + bh, bw, H - (by + bh));

    game.loose = [];
    for (var i = 0; i < game.pieces.length; i++) {
      var p = game.pieces[i];
      if (p.locked) continue;
      var x, y;
      var need = game.pieces.length * game.pw * game.ph;
      if (total >= need * 0.8) {
        var pick = Math.random() * total, acc = 0, band = bands[0];
        for (var j = 0; j < bands.length; j++) { acc += bands[j].area; if (pick <= acc) { band = bands[j]; break; } }
        x = band.x + rnd(0, band.w - pieceW);
        y = band.y + rnd(0, band.h - pieceH);
      } else {
        x = rnd(0, Math.max(0, W - pieceW));
        y = rnd(0, Math.max(0, H - pieceH));
      }
      p.x = Math.round(x); p.y = Math.round(y);
      storeNormalized(p);
      game.loose.push(p);
    }
    // Orden z aleatorio
    for (var k = game.loose.length - 1; k > 0; k--) {
      var q = Math.floor(Math.random() * (k + 1));
      var tmp = game.loose[k]; game.loose[k] = game.loose[q]; game.loose[q] = tmp;
    }
  }

  function storeNormalized(p) {
    p.nx = (game.W - p.w) > 0 ? p.x / (game.W - p.w) : 0;
    p.ny = (game.H - p.h) > 0 ? p.y / (game.H - p.h) : 0;
  }

  function reshuffle() {
    if (!game) return;
    for (var i = 0; i < game.pieces.length; i++) game.pieces[i].locked = false;
    game.won = false;
    game.drag = null;
    stopConfetti();
    closeMenu();
    hide(el.overlay);
    scatter();
    rebuildStatic();
    clearFg();
    redrawBg(null);
    updateCounter();
  }

  // ------------------------------------------------------------------
  // Dibujo
  // ------------------------------------------------------------------
  // Textura para el tablero sin guia: fondo claro con rayas diagonales y lunares de colores.
  var textureTile = null;
  function getTexture(ctx) {
    if (!textureTile) {
      var size = 64;
      var tile = document.createElement('canvas');
      tile.width = size; tile.height = size;
      var t = tile.getContext('2d');
      t.fillStyle = '#e9edf6';
      t.fillRect(0, 0, size, size);
      t.strokeStyle = 'rgba(120, 140, 190, 0.18)';
      t.lineWidth = 6;
      for (var i = -size; i < size * 2; i += 16) {
        t.beginPath(); t.moveTo(i, 0); t.lineTo(i + size, size); t.stroke();
      }
      var dots = [[16, 16, '#ffd166'], [48, 16, '#06d6a0'], [16, 48, '#118ab2'], [48, 48, '#ef476f']];
      t.globalAlpha = 0.35;
      for (var j = 0; j < dots.length; j++) {
        t.fillStyle = dots[j][2];
        t.beginPath(); t.arc(dots[j][0], dots[j][1], 5, 0, Math.PI * 2); t.fill();
      }
      t.globalAlpha = 1;
      textureTile = tile;
    }
    return ctx.createPattern(textureTile, 'repeat');
  }

  // Capa estatica: fondo del tablero (+ imagen guia) + piezas ya encajadas.
  function rebuildStatic() {
    var ctx = staticLayer.getContext('2d');
    ctx.clearRect(0, 0, game.W, game.H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(game.bx, game.by, game.bw, game.bh);
    if (game.guide) {
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.drawImage(game.src, 0, 0, game.iw, game.ih, game.bx, game.by, game.bw, game.bh);
      ctx.globalAlpha = 1;
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(game.bx, game.by, game.bw, game.bh);
      ctx.clip();
      ctx.fillStyle = getTexture(ctx);
      ctx.fillRect(game.bx, game.by, game.bw, game.bh);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(game.bx - 1, game.by - 1, game.bw + 2, game.bh + 2);
    for (var i = 0; i < game.pieces.length; i++) {
      var p = game.pieces[i];
      if (p.locked) ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
    }
  }

  function drawOnStatic(p) {
    staticLayer.getContext('2d').drawImage(p.canvas, p.x, p.y, p.w, p.h);
  }

  // Capa de fondo: capa estatica + piezas sueltas (menos la que se arrastra).
  function redrawBg(exclude) {
    var ctx = el.bg.getContext('2d');
    ctx.clearRect(0, 0, game.W, game.H);
    ctx.drawImage(staticLayer, 0, 0, game.W, game.H);
    for (var i = 0; i < game.loose.length; i++) {
      var p = game.loose[i];
      if (p !== exclude) ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
    }
  }

  // Capa superior: solo la pieza arrastrada (barata de redibujar en cada movimiento).
  function drawFg() {
    frameRequested = false;
    if (!game || !game.drag) return;
    var p = game.drag.piece;
    var ctx = el.fg.getContext('2d');
    ctx.clearRect(0, 0, game.W, game.H);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
    ctx.restore();
  }

  function clearFg() {
    el.fg.getContext('2d').clearRect(0, 0, game.W, game.H);
  }

  function updateCounter() {
    var lockedCount = game.pieces.length - game.loose.length;
    setText(el.counter, lockedCount + ' / ' + game.pieces.length);
  }

  // ------------------------------------------------------------------
  // Interaccion (tactil y mouse)
  // ------------------------------------------------------------------
  function hitTest(x, y) {
    for (var i = game.loose.length - 1; i >= 0; i--) {
      var p = game.loose[i];
      if (x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h) continue;
      var px = Math.floor((x - p.x) * dpr), py = Math.floor((y - p.y) * dpr);
      try {
        var alpha = p.ctx.getImageData(px, py, 1, 1).data[3];
        if (alpha > 16) return p;
      } catch (e) {
        return p; // si getImageData falla, aceptamos el rectangulo
      }
    }
    return null;
  }

  function localPoint(clientX, clientY) {
    var rect = el.fg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function beginDrag(clientX, clientY, touchId) {
    if (!game || game.won || game.drag) return false;
    var pt = localPoint(clientX, clientY);
    var piece = hitTest(pt.x, pt.y);
    if (!piece) return false;
    game.loose.splice(game.loose.indexOf(piece), 1);
    game.loose.push(piece);
    game.drag = { piece: piece, dx: pt.x - piece.x, dy: pt.y - piece.y, id: touchId };
    redrawBg(piece);
    drawFg();
    return true;
  }

  function moveDrag(clientX, clientY) {
    var d = game.drag, p = d.piece;
    var pt = localPoint(clientX, clientY);
    // La pieza puede salir un poco del area, pero nunca perderse del todo.
    p.x = clamp(pt.x - d.dx, -p.w * 0.6, game.W - p.w * 0.4);
    p.y = clamp(pt.y - d.dy, -p.h * 0.6, game.H - p.h * 0.4);
    if (!frameRequested) { frameRequested = true; requestFrame(drawFg); }
  }

  function endDrag() {
    if (!game || !game.drag) return;
    var p = game.drag.piece;
    game.drag = null;
    var dx = p.x - p.tx, dy = p.y - p.ty;
    if (dx * dx + dy * dy <= game.snap * game.snap) {
      p.x = p.tx; p.y = p.ty; p.locked = true;
      game.loose.splice(game.loose.indexOf(p), 1);
      drawOnStatic(p);
      updateCounter();
    } else {
      storeNormalized(p);
    }
    clearFg();
    redrawBg(null);
    if (game.loose.length === 0) win();
  }

  function win() {
    game.won = true;
    setText(el.overlayMsg, game.pieces.length + ' piezas · ' + game.entry.name);
    startConfetti();
    setTimeout(function () { if (game && game.won) show(el.overlay); }, 700);
  }

  // Confeti y estrellas sobre la capa superior; sigue hasta que se pulse un boton.
  function startConfetti() {
    var W = game.W, H = game.H, parts = [];
    var count = Math.min(110, Math.max(60, Math.round(W * H / 7000)));
    for (var i = 0; i < count; i++) parts.push(makeParticle(W, H, true));
    confetti = { parts: parts, start: new Date().getTime(), lastTime: 0, W: W, H: H };
    requestFrame(confettiFrame);
  }
  function makeParticle(W, H, initial) {
    var star = Math.random() < 0.3;
    return {
      x: rnd(0, W), y: initial ? rnd(-H * 0.6, H * 0.7) : rnd(-40, -10),
      vx: rnd(-40, 40), vy: rnd(90, 220),
      rot: rnd(0, Math.PI * 2), vr: rnd(-4, 4),
      size: star ? rnd(10, 20) : rnd(9, 16),
      star: star, color: COLORS[Math.floor(Math.random() * COLORS.length)]
    };
  }
  function resetParticle(p, W, H) {
    var np = makeParticle(W, H, false);
    for (var k in np) if (np.hasOwnProperty(k)) p[k] = np[k];
  }
  function drawStar(ctx, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = (i % 2 === 0) ? r : r * 0.45;
      var a = i * Math.PI / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  function confettiFrame() {
    if (!confetti || !game) return;
    var now = new Date().getTime();
    var dt = confetti.lastTime ? Math.min(0.05, (now - confetti.lastTime) / 1000) : 0.016;
    confetti.lastTime = now;
    var ctx = el.fg.getContext('2d');
    ctx.clearRect(0, 0, confetti.W, confetti.H);
    for (var i = 0; i < confetti.parts.length; i++) {
      var p = confetti.parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.vx += Math.sin(now / 300 + i) * 30 * dt;
      if (p.y > confetti.H + 20) resetParticle(p, confetti.W, confetti.H);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.star) drawStar(ctx, p.size);
      else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    requestFrame(confettiFrame);
  }
  function stopConfetti() {
    if (!confetti) return;
    confetti = null;
    if (el.fg) el.fg.getContext('2d').clearRect(0, 0, el.fg.width, el.fg.height);
  }

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    var t = e.changedTouches[0];
    if (beginDrag(t.clientX, t.clientY, t.identifier)) e.preventDefault();
  }
  function onTouchMove(e) {
    e.preventDefault();  // evita el scroll/rebote de la pagina
    if (!game || !game.drag) return;
    var t = findTouch(e.touches, game.drag.id);
    if (t) moveDrag(t.clientX, t.clientY);
  }
  function onTouchEnd(e) {
    if (!game || !game.drag) return;
    if (findTouch(e.changedTouches, game.drag.id)) { e.preventDefault(); endDrag(); }
  }
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (beginDrag(e.clientX, e.clientY, null)) e.preventDefault();
  }
  function onMouseMove(e) {
    if (!game || !game.drag) return;
    moveDrag(e.clientX, e.clientY);
  }
  function onMouseUp() { endDrag(); }

  // ------------------------------------------------------------------
  // Pantallas
  // ------------------------------------------------------------------
  // Menu de adultos: exige mantener pulsado para que el nino no salga sin querer.
  var holdTimer = null;

  function onMenuHoldStart(e) {
    if (e.preventDefault) e.preventDefault();
    if (holdTimer) return;
    toggleClass(el.btnMenu, 'holding', true);
    show(el.menuHint);
    holdTimer = setTimeout(function () {
      holdTimer = null;
      toggleClass(el.btnMenu, 'holding', false);
      hide(el.menuHint);
      openMenu();
    }, MENU_HOLD_MS);
  }

  function onMenuHoldEnd(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    toggleClass(el.btnMenu, 'holding', false);
    hide(el.menuHint);
  }

  function openMenu() {
    if (!game || game.won) return;
    if (game.drag) { game.drag = null; clearFg(); redrawBg(null); }
    show(el.menu);
  }

  function closeMenu() { hide(el.menu); }

  function showScreen(name) {
    if (name === 'game') { hide(el.screenCatalog); show(el.screenGame); }
    else { hide(el.screenGame); show(el.screenCatalog); }
  }
  function showLoading(text) { setLoadingText(text); show(el.loading); }
  function setLoadingText(text) { setText(el.loadingText, text); }
  function hideLoading() { hide(el.loading); }

  function startGame() {
    if (!selected) return;
    showLoading('Cargando imagen…');
    getSource(selected, function (src) {
      showScreen('game');
      // Dejamos que el layout se aplique antes de medir el area de juego.
      setTimeout(function () {
        try { newGame(src, selected); }
        catch (e) { showScreen('catalog'); setText(el.catalogStatus, 'Error al crear el rompecabezas: ' + e.message); }
        hideLoading();
      }, 30);
    }, function (err) {
      hideLoading();
      setText(el.catalogStatus, err.message);
    });
  }

  function backToCatalog() {
    stopConfetti();
    closeMenu();
    game = null;
    staticLayer = null;
    hide(el.overlay);
    showScreen('catalog');
  }

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      if (!game || /\bhidden\b/.test(el.screenGame.className)) return;
      game.drag = null;
      stopConfetti();
      layoutGame(true);
      rebuildStatic();
      clearFg();
      redrawBg(null);
    }, 150);
  }

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  function init() {
    el.screenCatalog = $('screen-catalog');
    el.screenGame = $('screen-game');
    el.gallery = $('gallery');
    el.catalogStatus = $('catalog-status');
    el.categories = $('categories');
    el.galleryEmpty = $('gallery-empty');
    el.optGuideOn = $('opt-guide-on');
    el.optGuideOff = $('opt-guide-off');
    el.pieceLabel = $('piece-label');
    el.btnPlay = $('btn-play');
    el.presets = document.querySelectorAll('#piece-presets .btn-preset');
    el.playArea = $('play-area');
    el.bg = $('bg');
    el.fg = $('fg');
    el.btnBack = $('btn-back');
    el.btnMenu = $('btn-menu');
    el.menu = $('menu');
    el.menuHint = $('menu-hint');
    el.btnResume = $('btn-resume');
    el.btnShuffle = $('btn-shuffle');
    el.counter = $('counter');
    el.overlay = $('overlay');
    el.overlayMsg = $('overlay-msg');
    el.btnAgain = $('btn-again');
    el.btnOther = $('btn-other');
    el.loading = $('loading');
    el.loadingText = $('loading-text');
    setText($('version'), 'v' + VERSION);

    el.optGuideOn.addEventListener('click', function () { setGuideDefault(true); }, false);
    el.optGuideOff.addEventListener('click', function () { setGuideDefault(false); }, false);
    for (var i = 0; i < el.presets.length; i++) {
      el.presets[i].addEventListener('click', function (e) {
        setTargetPieces(e.currentTarget.getAttribute('data-n'));
      }, false);
    }
    el.btnPlay.addEventListener('click', startGame, false);
    el.btnBack.addEventListener('click', backToCatalog, false);
    el.btnOther.addEventListener('click', backToCatalog, false);
    el.btnShuffle.addEventListener('click', reshuffle, false);
    el.btnAgain.addEventListener('click', reshuffle, false);
    el.btnResume.addEventListener('click', closeMenu, false);
    el.btnMenu.addEventListener('touchstart', onMenuHoldStart, false);
    el.btnMenu.addEventListener('touchend', onMenuHoldEnd, false);
    el.btnMenu.addEventListener('touchcancel', onMenuHoldEnd, false);
    el.btnMenu.addEventListener('mousedown', onMenuHoldStart, false);
    el.btnMenu.addEventListener('mouseup', onMenuHoldEnd, false);
    el.btnMenu.addEventListener('mouseleave', onMenuHoldEnd, false);

    el.fg.addEventListener('touchstart', onTouchStart, false);
    el.fg.addEventListener('touchmove', onTouchMove, false);
    el.fg.addEventListener('touchend', onTouchEnd, false);
    el.fg.addEventListener('touchcancel', onTouchEnd, false);
    el.fg.addEventListener('mousedown', onMouseDown, false);
    window.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('mouseup', onMouseUp, false);
    // Bloquea el scroll/rebote elastico fuera del area de juego en iOS.
    document.addEventListener('touchmove', function (e) {
      if (game && !/\bhidden\b/.test(el.screenGame.className)) e.preventDefault();
    }, false);
    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);

    setTargetPieces(targetPieces);
    setGuideDefault(true);
    loadCatalog();
  }

  // Hook minimo para depuracion desde la consola de Safari/Chrome.
  window.SimpleJigsaw = { version: VERSION, state: function () { return game; }, confetti: function () { return confetti; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, false);
  else init();
})();
