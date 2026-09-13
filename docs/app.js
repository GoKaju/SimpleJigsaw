/*
 * SimpleJigsaw - app.js
 * ES5 puro: compatible con Safari de iOS 9.3.5 (iPad mini 1).
 * Sin let/const, arrow functions, clases, template literals ni Promises.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_SRC = 1600;          // lado maximo de la imagen fuente (fotos subidas)
  var TAB = 0.1;               // tamano del tab relativo al lado de la pieza (altura = 3*TAB)
  var MARGIN_FACTOR = 0.36;    // margen alrededor de cada pieza para que quepan los tabs
  var MIN_PIECES = 12, MAX_PIECES = 100;
  var GHOST_ALPHA = 0.25;

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var catalog = [];            // entradas de catalog.json + fotos subidas
  var selected = null;         // entrada elegida
  var selectedItem = null;     // nodo DOM del thumbnail elegido
  var sourceCache = {};        // id -> Image | Canvas
  var targetPieces = 24;
  var uploadCount = 0;
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
    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
    if (raf) raf(fn); else setTimeout(fn, 16);
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

  // ------------------------------------------------------------------
  // Fotos subidas: orientacion EXIF y correccion del "squash" de iOS
  // ------------------------------------------------------------------
  function readOrientation(buffer) {
    var view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return 1;
    var length = view.byteLength, offset = 2;
    while (offset < length - 1) {
      var marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) {
        if (offset + 10 > length || view.getUint32(offset + 2, false) !== 0x45786966) return 1;
        var little = view.getUint16(offset + 8, false) === 0x4949;
        var tiff = offset + 8;
        var firstIFD = view.getUint32(tiff + 4, little);
        if (tiff + firstIFD + 2 > length) return 1;
        var tags = view.getUint16(tiff + firstIFD, little);
        for (var i = 0; i < tags; i++) {
          var entry = tiff + firstIFD + 2 + i * 12;
          if (entry + 12 > length) return 1;
          if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
        }
        return 1;
      } else if ((marker & 0xFF00) !== 0xFF00) {
        return 1;
      } else {
        if (offset + 2 > length) return 1;
        offset += view.getUint16(offset, false);
      }
    }
    return 1;
  }

  function browserAutoOrients() {
    try { return !!(window.CSS && CSS.supports && CSS.supports('image-orientation', 'from-image')); }
    catch (e) { return false; }
  }

  function readOrientationFromFile(file, isJpeg, cb) {
    if (!isJpeg || !window.DataView || !file.slice || browserAutoOrients()) { cb(1); return; }
    var reader = new FileReader();
    reader.onload = function () { var o = 1; try { o = readOrientation(reader.result); } catch (e) {} cb(o); };
    reader.onerror = function () { cb(1); };
    reader.readAsArrayBuffer(file.slice(0, 131072));
  }

  // iOS antiguo "aplasta" verticalmente los JPEG grandes al dibujarlos en canvas.
  // Detectamos la proporcion real dibujando en un canvas de 1px de ancho.
  function detectVerticalSquash(img, ih) {
    var c = document.createElement('canvas');
    c.width = 1; c.height = ih;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var data;
    try { data = ctx.getImageData(0, 0, 1, ih).data; } catch (e) { return 1; }
    var sy = 0, ey = ih, py = ih;
    while (py > sy) {
      var alpha = data[(py - 1) * 4 + 3];
      if (alpha === 0) ey = py; else sy = py;
      py = (ey + sy) >> 1;
    }
    var ratio = py / ih;
    return ratio === 0 ? 1 : ratio;
  }

  function normalizeUpload(img, orientation, isJpeg) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var ratio = isJpeg ? detectVerticalSquash(img, ih) : 1;
    var scale = Math.min(1, MAX_SRC / Math.max(iw, ih));
    var w = Math.round(iw * scale), h = Math.round(ih * scale);
    var swap = orientation >= 5;
    // Canvas a 1:1 (sin dpr) para no duplicar memoria en pantallas retina.
    var c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    var ctx = c.getContext('2d');
    switch (orientation) {
      case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
      case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
      case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
      case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
      case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -h); break;
      case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(w, -h); ctx.scale(-1, 1); break;
      case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-w, 0); break;
    }
    ctx.drawImage(img, 0, 0, iw, ih, 0, 0, w, h / ratio);
    c.logicalWidth = c.width;
    c.logicalHeight = c.height;
    return c;
  }

  function makeThumb(source, maxSide) {
    var sw = srcWidth(source), sh = srcHeight(source);
    var s = Math.min(1, maxSide / Math.max(sw, sh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.7); } catch (e) { return c.toDataURL(); }
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
      renderGallery();
      setText(el.catalogStatus, catalog.length ? '' :
        'El catálogo está vacío. Agrega imágenes en images-source/ y ejecuta node build.ts.');
    }, function (err) {
      setText(el.catalogStatus, 'No se pudo cargar el catálogo (' + err.message + '). Puedes subir una foto propia.');
    });
  }

  function renderGallery() {
    el.gallery.innerHTML = '';
    for (var i = 0; i < catalog.length; i++) addGalleryItem(catalog[i]);
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
    el.pieceRange.value = targetPieces;
    updatePieceLabel();
  }

  function onFileChosen() {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    showLoading('Procesando foto…');
    var isJpeg = /jpe?g$/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '');
    readOrientationFromFile(file, isJpeg, function (orientation) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var canvas;
          try { canvas = normalizeUpload(img, orientation, isJpeg); }
          catch (e) { hideLoading(); setText(el.catalogStatus, 'No se pudo procesar la foto.'); return; }
          uploadCount++;
          var id = 'upload-' + uploadCount;
          var entry = {
            id: id,
            name: 'Mi foto ' + uploadCount,
            thumb: makeThumb(canvas, 300),
            image: null,
            width: canvas.logicalWidth,
            height: canvas.logicalHeight,
            upload: true
          };
          sourceCache[id] = canvas;
          catalog.push(entry);
          var item = addGalleryItem(entry);
          selectEntry(entry, item);
          hideLoading();
          setText(el.catalogStatus, '');
          try { el.fileInput.value = ''; } catch (e) {}
        };
        img.onerror = function () { hideLoading(); setText(el.catalogStatus, 'No se pudo leer la imagen.'); };
        img.src = reader.result;
      };
      reader.onerror = function () { hideLoading(); setText(el.catalogStatus, 'No se pudo leer el archivo.'); };
      reader.readAsDataURL(file);
    });
  }

  function getSource(entry, ok, err) {
    if (sourceCache[entry.id]) { ok(sourceCache[entry.id]); return; }
    // Liberamos imagenes del catalogo cargadas antes (las fotos subidas se conservan).
    for (var k in sourceCache) {
      if (sourceCache.hasOwnProperty(k) && k.indexOf('upload-') !== 0) delete sourceCache[k];
    }
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
    var iw = src.logicalWidth || srcWidth(src), ih = src.logicalHeight || srcHeight(src);
    var grid = computeGrid(targetPieces, iw / ih);
    game = {
      src: src, iw: srcWidth(src), ih: srcHeight(src), logicalW: iw, logicalH: ih,
      rows: grid.rows, cols: grid.cols, entry: entry,
      hEdges: [], vEdges: [], pieces: [], loose: [],
      guide: true, drag: null, won: false
    };
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
    setText(el.gameTitle, entry.name);
    toggleClass(el.btnGuide, 'active', true);
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
    setTimeout(function () { show(el.overlay); }, 500);
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
    el.fileInput = $('file-input');
    el.pieceRange = $('piece-range');
    el.pieceLabel = $('piece-label');
    el.btnPlay = $('btn-play');
    el.presets = document.querySelectorAll('.btn-preset');
    el.playArea = $('play-area');
    el.bg = $('bg');
    el.fg = $('fg');
    el.btnBack = $('btn-back');
    el.btnGuide = $('btn-guide');
    el.btnShuffle = $('btn-shuffle');
    el.counter = $('counter');
    el.gameTitle = $('game-title');
    el.overlay = $('overlay');
    el.overlayMsg = $('overlay-msg');
    el.btnAgain = $('btn-again');
    el.btnOther = $('btn-other');
    el.loading = $('loading');
    el.loadingText = $('loading-text');
    setText($('version'), 'v' + VERSION);

    el.pieceRange.addEventListener('input', function () { setTargetPieces(el.pieceRange.value); }, false);
    el.pieceRange.addEventListener('change', function () { setTargetPieces(el.pieceRange.value); }, false);
    for (var i = 0; i < el.presets.length; i++) {
      el.presets[i].addEventListener('click', function (e) {
        setTargetPieces(e.currentTarget.getAttribute('data-n'));
      }, false);
    }
    el.btnPlay.addEventListener('click', startGame, false);
    el.fileInput.addEventListener('change', onFileChosen, false);
    el.btnBack.addEventListener('click', backToCatalog, false);
    el.btnOther.addEventListener('click', backToCatalog, false);
    el.btnShuffle.addEventListener('click', reshuffle, false);
    el.btnAgain.addEventListener('click', reshuffle, false);
    el.btnGuide.addEventListener('click', function () {
      if (!game) return;
      game.guide = !game.guide;
      toggleClass(el.btnGuide, 'active', game.guide);
      rebuildStatic();
      redrawBg(game.drag ? game.drag.piece : null);
    }, false);

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
    loadCatalog();
  }

  // Hook minimo para depuracion desde la consola de Safari/Chrome.
  window.SimpleJigsaw = { version: VERSION, state: function () { return game; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, false);
  else init();
})();
