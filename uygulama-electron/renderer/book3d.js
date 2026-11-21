// book3d.js - ERME BOOKS 3D kitap sahneleri (Three.js r158, global THREE).
// Dışarıya iki şey açar:
//   window.BookIntro.play(onDone)          -> uygulama açılış sahnesi (tıklayınca atlanır)
//   window.BookProgress.attach(canvas)     -> ilerleme kutusundaki "dolan kitap"
//       .start(), .pageStarted(avgSec), .pageDone(), .setFraction(f), .busy(on), .finish(ok), .setCover(src, title)
// Kitap tamamen prosedürel: doku dosyası yok, kapak/sayfa/çıkartmalar canvas'a çiziliyor.
(function () {
  const T = window.THREE;
  if (!T) { console.warn('three.js yüklenemedi, 3D sahneler kapalı'); return; }

  // ---------- yardımcılar ----------
  const css = (n, d) => (getComputedStyle(document.body).getPropertyValue(n).trim() || d);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));               // t'nin [a,b] aralığındaki yeri
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const bounce = (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function shade(hex, f) {   // f<0 koyulaştır, f>0 açıklaştır
    const c = new T.Color(hex);
    return f < 0 ? c.multiplyScalar(1 + f) : c.lerp(new T.Color('#ffffff'), f);
  }
  function tex(c) { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; }

  // Kenarları yuvarlatılmış kutu (BoxGeometry'nin yüz grupları/UV'leri korunur)
  function roundedBox(w, h, d, r, n = 3) {
    const k = 2 * n + 1, g = new T.BoxGeometry(1, 1, 1, k, k, k);
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, hf = [w / 2, h / 2, d / 2];
    r = Math.min(r, ...hf) * 0.999;
    const map = (c, H) => { const i = Math.round((c + 0.5) * k); return i <= n ? -H + r * (i / n) : H - r * ((k - i) / n); };
    const p = new T.Vector3(), inner = new T.Vector3(), off = new T.Vector3();
    for (let i = 0; i < pa.count; i++) {
      p.set(map(pa.getX(i), hf[0]), map(pa.getY(i), hf[1]), map(pa.getZ(i), hf[2]));
      // UV'yi yeni (düz yüze izdüşen) konumdan yeniden hesapla, yoksa kapak resmi gerilir
      const nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i), X = p.x / w, Y = p.y / h, Z = p.z / d;
      if (nx > 0.5) ua.setXY(i, 0.5 - Z, 0.5 + Y); else if (nx < -0.5) ua.setXY(i, 0.5 + Z, 0.5 + Y);
      else if (ny > 0.5) ua.setXY(i, 0.5 + X, 0.5 - Z); else if (ny < -0.5) ua.setXY(i, 0.5 + X, 0.5 + Z);
      else if (nz > 0.5) ua.setXY(i, 0.5 + X, 0.5 + Y); else ua.setXY(i, 0.5 - X, 0.5 + Y);
      inner.set(clamp(p.x, -hf[0] + r, hf[0] - r), clamp(p.y, -hf[1] + r, hf[1] - r), clamp(p.z, -hf[2] + r, hf[2] - r));
      off.subVectors(p, inner);
      if (off.lengthSq() > 1e-12) { off.normalize(); p.copy(inner).addScaledVector(off, r); na.setXYZ(i, off.x, off.y, off.z); }
      pa.setXYZ(i, p.x, p.y, p.z);
    }
    return g;
  }
  // bez cilt dokusu (kabartma haritası olarak)
  let clothCache = null;
  function clothTexture() {
    if (clothCache) return clothCache;
    const c = canvas(256, 256), x = c.getContext('2d'), r = rng(3);
    x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 2) {
      x.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; x.fillRect(0, i, 256, 1);
      x.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; x.fillRect(i, 0, 1, 256);
    }
    for (let i = 0; i < 2200; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.12})`; x.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1); }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 4);
    return (clothCache = t);
  }
  // yumuşak stüdyo ortamı: kâğıt ve kapakta gerçekçi ışık yansımaları
  const envCache = new WeakMap();
  function studioEnv(renderer) {
    if (envCache.has(renderer)) return envCache.get(renderer);
    const pm = new T.PMREMGenerator(renderer), s = new T.Scene();
    s.background = new T.Color('#2a221b');
    const panel = (w, h, col, pos, look) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: col, side: T.DoubleSide }));
      m.position.set(...pos); m.lookAt(...look); s.add(m);
    };
    panel(6, 4, '#fff1dc', [-3, 6, 4], [0, 0, 0]);     // tepe softbox
    panel(4, 6, '#ffe2bd', [6, 2, -2], [0, 0, 0]);     // sıcak yan ışık
    panel(10, 3, '#5a4636', [0, -3, 0], [0, 0, 0]);    // zemin yansıması
    panel(3, 3, '#cfd8e6', [-6, 2, -3], [0, 0, 0]);    // soğuk dolgu
    const t = pm.fromScene(s, 0.04).texture; pm.dispose();
    envCache.set(renderer, t); return t;
  }
  // kritik sönümlü yay: x hedefe salınımsız, yumuşak yaklaşır
  function spring(st, target, dt, w = 10) {
    const k = w * w, c = 2 * w;
    st.v += (k * (target - st.x) - c * st.v) * dt; st.x += st.v * dt; return st.x;
  }
  // yaprak geometrisi: hafif kıvrık badem yaprak, sapı orijinde
  function leafGeo(size = 0.12) {
    const sh = new T.Shape();
    sh.moveTo(0, 0); sh.bezierCurveTo(size * 0.42, size * 0.22, size * 0.38, size * 0.75, 0, size);
    sh.bezierCurveTo(-size * 0.38, size * 0.75, -size * 0.42, size * 0.22, 0, 0);
    const g = new T.ShapeGeometry(sh, 6), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, (x * x) * 6 - Math.sin((y / size) * Math.PI) * size * 0.06); }
    g.computeVertexNormals(); return g;
  }
  const SEASON_LEAVES = {
    ilkbahar: { cols: ['#f3b9c9', '#f8d6e0', '#fbe9ee', '#9ccc72', '#b8dc8e', '#e79bb3'], density: 0.9 },
    yaz: { cols: ['#3f7a3a', '#5c9a45', '#2e5f2e', '#79b356', '#4c8a3e'], density: 1 },
    sonbahar: { cols: ['#d9772b', '#c4452d', '#e8b33c', '#a8562a', '#8f3b22', '#e39a3b'], density: 0.8 },
    kis: { cols: ['#eef3f8', '#dfe8f2', '#f8fbff', '#c9d6e4'], density: 0.28 },
  };

  // ---------- dokular ----------
  const PAPER = '#f4ecdb', INK = '#2a211a';

  // Sayfa: f (0..1) kadarı mürekkepli satırlarla dolu. seed satır uzunluklarını belirler.
  function drawPage(ctx, w, h, f, seed, opts = {}) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(opts.left ? w : 0, 0, opts.left ? w * 0.82 : w * 0.18, 0);  // cilde doğru gölge
    g.addColorStop(0, 'rgba(90,60,30,.22)'); g.addColorStop(1, 'rgba(90,60,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = rng(seed), mx = w * 0.13, top = h * 0.11, lh = h * 0.043;
    let y = top;
    if (opts.heading) {
      ctx.fillStyle = INK; ctx.font = `600 ${h * 0.05}px Georgia, serif`; ctx.textAlign = 'center';
      ctx.fillText(opts.heading, w / 2, top + h * 0.03); y += h * 0.1; ctx.textAlign = 'left';
    }
    const total = Math.floor((h * 0.9 - y) / lh), shown = f * total;
    for (let i = 0; i < total; i++) {
      const para = r() < 0.12, len = (para ? 0.35 + r() * 0.4 : 0.86 + r() * 0.14) * (w - 2 * mx);
      const k = clamp(shown - i);   // bu satırın ne kadarı yazılmış
      if (k <= 0) break;
      ctx.fillStyle = `rgba(42,33,26,${0.55 + r() * 0.2})`;
      const ind = i === 0 || r() < 0.08 ? w * 0.05 : 0;
      // kelimeler: küçük boşluklu dikdörtgenler
      let x = mx + ind, end = mx + ind + (len - ind) * k;
      while (x < end) {
        const ww = Math.min(end - x, w * (0.03 + r() * 0.07));
        ctx.fillRect(x, y, ww, lh * 0.34);
        x += ww + w * 0.012;
      }
      y += lh;
    }
  }

  function drawCover(ctx, w, h, o) {
    const accent = o.color || '#a4592f';
    ctx.fillStyle = accent; ctx.fillRect(0, 0, w, h);
    if (o.image) {   // kitabın kendi kapağı
      const im = o.image, s = Math.max(w / im.width, h / im.height);
      ctx.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s);
    } else {
      // ERME BOOKS üç bantlı klasik kapak
      ctx.fillStyle = shade(accent, -0.25).getStyle(); ctx.fillRect(0, 0, w, h * 0.17);
      ctx.fillRect(0, h * 0.83, w, h * 0.17);
      ctx.fillStyle = '#f4ecdb'; ctx.fillRect(0, h * 0.30, w, h * 0.38);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.06, h * 0.04, w * 0.88, h * 0.92);
      ctx.fillStyle = '#2a211a'; ctx.textAlign = 'center';
      const title = (o.title || 'ERME BOOKS').toUpperCase();
      let fs = h * 0.075; ctx.font = `700 ${fs}px Georgia, serif`;
      while (ctx.measureText(title).width > w * 0.8 && fs > 14) { fs -= 2; ctx.font = `700 ${fs}px Georgia, serif`; }
      ctx.fillText(title, w / 2, h * 0.47);
      ctx.font = `italic ${h * 0.036}px Georgia, serif`; ctx.fillStyle = '#5a4a38';
      ctx.fillText(o.author || 'Kitap Stüdyosu', w / 2, h * 0.56);
      ctx.fillStyle = '#f4ecdb'; ctx.font = `600 ${h * 0.03}px Georgia, serif`;
      ctx.fillText('E R M E   B O O K S', w / 2, h * 0.915);
      ctx.beginPath(); ctx.arc(w / 2, h * 0.09, h * 0.035, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent; ctx.font = `700 ${h * 0.04}px Georgia, serif`; ctx.fillText('E', w / 2, h * 0.104);
    }
    // ışık parlaması ve kenar yıpranması
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  function edgeTexture(vertical) {   // sayfa yaprakları görünen kenar
    const L = 512, c = canvas(vertical ? 128 : L, vertical ? L : 128), x = c.getContext('2d');
    const n = vertical ? c.width : c.height;
    const g = vertical ? x.createLinearGradient(0, 0, c.width, 0) : x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#e2d5ba'); g.addColorStop(0.5, '#f3ead6'); g.addColorStop(1, '#e2d5ba');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    const r = rng(7);
    for (let i = 0; i < n; i += 1) {
      if (r() < 0.45) continue;
      x.fillStyle = `rgba(110,85,55,${0.04 + r() * 0.12})`;
      vertical ? x.fillRect(i, 0, 0.6, c.height) : x.fillRect(0, i, c.width, 0.6);
    }
    const t = tex(c); t.anisotropy = 8; return t;
  }

  // ---------- çıkartmalar (Drupe'taki bardak çıkartmalarının kitap karşılığı) ----------
  function sticker(kind, accent) {
    const s = 256, c = canvas(s, s), x = c.getContext('2d');
    x.translate(s / 2, s / 2); x.lineJoin = 'round'; x.lineCap = 'round';
    const outline = (draw) => {   // beyaz kenarlı çıkartma + hafif gölge
      x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 14; x.shadowOffsetY = 6;
      x.strokeStyle = '#fffaf0'; x.lineWidth = 26; draw(true); x.restore();
      draw(false);
    };
    const dark = '#2a211a';
    if (kind.startsWith('harf:')) {
      const ch = kind.slice(5);
      x.font = '700 170px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      outline((o) => { if (o) x.strokeText(ch, 0, 8); else { x.fillStyle = accent; x.fillText(ch, 0, 8); } });
    } else if (kind === 'damla') {
      const p = () => { x.beginPath(); x.moveTo(0, -95); x.bezierCurveTo(55, -20, 70, 25, 0, 85); x.bezierCurveTo(-70, 25, -55, -20, 0, -95); };
      outline((o) => { p(); if (o) x.stroke(); else { x.fillStyle = dark; x.fill(); x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(-18, 20, 10, 20, -0.4, 0, Math.PI * 2); x.fill(); } });
    } else if (kind === 'ayrac') {
      const p = () => { x.beginPath(); x.moveTo(-38, -105); x.lineTo(38, -105); x.lineTo(38, 100); x.lineTo(0, 66); x.lineTo(-38, 100); x.closePath(); };
      outline((o) => { p(); if (o) x.stroke(); else { x.fillStyle = accent; x.fill(); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(-38, -105, 12, 190); } });
    } else if (kind === 'fincan') {
      const p = () => { x.beginPath(); x.moveTo(-70, -30); x.lineTo(60, -30); x.lineTo(48, 60); x.quadraticCurveTo(-5, 80, -58, 60); x.closePath(); };
      outline((o) => {
        if (o) { p(); x.stroke(); x.beginPath(); x.arc(70, 10, 26, -1.2, 1.4); x.stroke(); return; }
        p(); x.fillStyle = '#f4ecdb'; x.fill(); x.lineWidth = 9; x.strokeStyle = accent; x.beginPath(); x.arc(70, 10, 26, -1.2, 1.4); x.stroke();
        x.fillStyle = '#6b4226'; x.beginPath(); x.ellipse(-5, -30, 64, 13, 0, 0, Math.PI * 2); x.fill();
        x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 6;
        for (const dx of [-25, 5, 35]) { x.beginPath(); x.moveTo(dx, -55); x.bezierCurveTo(dx - 14, -75, dx + 14, -88, dx, -108); x.stroke(); }
      });
    } else if (kind === 'yildiz') {
      const p = () => { x.beginPath(); for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, r = i % 2 ? 40 : 96; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); };
      outline((o) => { p(); if (o) x.stroke(); else { x.fillStyle = '#e8b84a'; x.fill(); } });
    } else if (kind === 'tuy') {
      const p = () => { x.beginPath(); x.moveTo(-70, 95); x.bezierCurveTo(-40, 20, 10, -60, 80, -100); x.bezierCurveTo(70, -30, 20, 40, -70, 95); };
      outline((o) => { p(); if (o) x.stroke(); else { x.fillStyle = '#f4ecdb'; x.fill(); x.strokeStyle = accent; x.lineWidth = 6; x.beginPath(); x.moveTo(-70, 95); x.quadraticCurveTo(10, 10, 78, -96); x.stroke(); } });
    } else if (kind === 'rozet') {
      outline((o) => {
        x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2);
        if (o) { x.stroke(); return; }
        x.fillStyle = accent; x.fill(); x.fillStyle = '#f4ecdb'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = '700 44px Georgia, serif'; x.fillText('OCR', 0, -8); x.font = '600 20px Georgia, serif'; x.fillText('★ ERME ★', 0, 34);
      });
    }
    const m = new T.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false });
    const sp = new T.Sprite(m); sp.scale.set(0.42, 0.42, 1);
    return sp;
  }

  // ---------- kitap ----------
  class Book {
    constructor(o = {}) {
      this.W = 1.0; this.H = 1.42; this.T = 0.2; this.cv = 0.026;  // genişlik, yükseklik, kalınlık, kapak kalınlığı
      this.accent = o.color || css('--accent', '#a4592f');
      this.group = new T.Group();
      const { W, H, T: TH, cv } = this;
      const cloth = clothTexture();
      const coverMat = (map) => new T.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.0, bumpMap: cloth, bumpScale: 0.35, envMapIntensity: 0.7 });
      const spineCol = shade(this.accent, -0.3);
      const plain = new T.MeshStandardMaterial({ color: spineCol, roughness: 0.62, bumpMap: cloth, bumpScale: 0.35, envMapIntensity: 0.7 });
      const paperMat = new T.MeshStandardMaterial({ color: PAPER, roughness: 0.95, envMapIntensity: 0.5 });
      this.plainMat = plain;

      // kapak dokusu
      this.coverCanvas = canvas(512, 728);
      this.coverTex = tex(this.coverCanvas);
      this.drawCover({ title: o.title, author: o.author });

      // arka kapak + sırt
      const back = new T.Mesh(roundedBox(W, H, cv, cv * 0.48), [plain, plain, plain, plain, paperMat, plain]);
      back.position.set(0, 0, -TH / 2 + cv / 2); back.castShadow = back.receiveShadow = true;
      // kavisli sırt: yarım silindir, hafif basık
      const spine = new T.Mesh(new T.CylinderGeometry(TH / 2, TH / 2, H, 28, 1, true, Math.PI, Math.PI), plain);
      spine.material = plain.clone(); spine.material.side = T.DoubleSide;
      spine.scale.x = 0.42; spine.position.set(-W / 2 + 0.004, 0, 0); spine.castShadow = true;

      // sayfa blokları: sağ (okunacak) ve sol (okunan) yığınlar
      const edgeV = edgeTexture(true), edgeH = edgeTexture(false);
      const edgeMatV = new T.MeshStandardMaterial({ map: edgeV, roughness: 0.95 });
      const edgeMatH = new T.MeshStandardMaterial({ map: edgeH, roughness: 0.95 });
      this.rightCanvas = canvas(512, 728); this.rightTex = tex(this.rightCanvas);
      this.leftCanvas = canvas(512, 728); this.leftTex = tex(this.leftCanvas);
      const rightFace = new T.MeshStandardMaterial({ map: this.rightTex, roughness: 0.92, envMapIntensity: 0.5 });
      const leftFace = new T.MeshStandardMaterial({ map: this.leftTex, roughness: 0.92, envMapIntensity: 0.5 });
      const PW = W - 0.05, PH = H - 0.06, PD = TH - 2 * cv;
      this.PW = PW; this.PH = PH; this.PD = PD;
      this.rightBlock = new T.Mesh(new T.BoxGeometry(PW, PH, 1), [edgeMatV, edgeMatV, edgeMatH, edgeMatH, rightFace, paperMat]);
      this.rightBlock.castShadow = this.rightBlock.receiveShadow = true;
      this.group.add(back, spine, this.rightBlock);

      // ön kapak sırttan menteşeli; açılınca sol tarafa yatar
      this.pivot = new T.Group(); this.pivot.position.set(-W / 2, 0, TH / 2 - cv / 2);
      this.front = new T.Mesh(roundedBox(W, H, cv, cv * 0.48), [plain, plain, plain, plain, coverMat(this.coverTex), paperMat]);
      this.front.position.x = W / 2; this.front.castShadow = this.front.receiveShadow = true;
      this.leftBlock = new T.Mesh(new T.BoxGeometry(PW, PH, 1), [edgeMatV, edgeMatV, edgeMatH, edgeMatH, paperMat, leftFace]);
      this.leftBlock.position.x = W / 2 + 0.015; this.leftBlock.castShadow = true;
      this.pivot.add(this.front, this.leftBlock);
      this.group.add(this.pivot);

      // çevrilen sayfalar
      this.flips = [];
      this.flipGeoBase = new T.PlaneGeometry(PW, PH, 40, 1); this.flipGeoBase.translate(PW / 2, 0, 0);
      this.flipMat = new T.MeshStandardMaterial({ map: this.makeFlipTex(), roughness: 0.9, side: T.DoubleSide });

      this.open = 0; this.leftF = 0; this.rightInk = -1; this.leftInk = -1;
      this.setStacks(0.0);
      this.setInk('right', 0); this.setInk('left', 0);
      this.setOpen(0);
    }
    drawCover(o) {
      const x = this.coverCanvas.getContext('2d');
      drawCover(x, this.coverCanvas.width, this.coverCanvas.height, { color: this.accent, ...o });
      this.coverTex.needsUpdate = true;
    }
    makeFlipTex() { const c = canvas(256, 364); drawPage(c.getContext('2d'), 256, 364, 1, 99); return tex(c); }
    // f: okunan oranı -> sol yığın kalınlığı f, sağ yığın 1-f
    setStacks(f) {
      this.leftF = f;
      const { PD, cv } = this, min = 0.004;
      const l = Math.max(min, PD * f), r = Math.max(min, PD * (1 - f));
      this.rightBlock.scale.z = r; this.rightBlock.position.set(0.012, 0, -this.T / 2 + cv + r / 2);
      this.leftBlock.scale.z = l; this.leftBlock.position.z = -cv / 2 - l / 2;
      this.rightTop = -this.T / 2 + cv + r;  // sağ sayfanın yüzeyi (çevrilen sayfalar buradan kalkar)
      this.leftTop = -this.T / 2 + cv + l;   // açık kitapta sol sayfanın yüzeyi (çevrilen sayfa buraya iner)
    }
    setInk(side, f, heading) {
      const key = side === 'right' ? 'rightInk' : 'leftInk';
      if (Math.abs(this[key] - f) < 0.004) return;
      this[key] = f;
      const c = side === 'right' ? this.rightCanvas : this.leftCanvas;
      drawPage(c.getContext('2d'), c.width, c.height, f, side === 'right' ? 11 + (this.pageNo || 0) : 23, { left: side === 'left', heading });
      (side === 'right' ? this.rightTex : this.leftTex).needsUpdate = true;
    }
    setOpen(a) {
      this.open = a;
      this.pivot.rotation.y = -Math.PI * 0.985 * a;
      // menteşe kapak açıldıkça aşağı iner: açık kitapta sol kapak masaya yatar
      const top = this.T / 2 - this.cv / 2, bottom = -this.T / 2 + this.cv / 2;
      this.pivot.position.z = lerp(top, bottom, easeInOut(clamp((a - 0.35) / 0.65)));
      this.leftBlock.visible = a > 0.02;
    }
    // sağdan sola bir sayfa çevir
    flipPage(dur = 0.7) {
      const geo = this.flipGeoBase.clone(), mesh = new T.Mesh(geo, this.flipMat);
      mesh.castShadow = true;
      const p = new T.Group(); p.position.set(-this.W / 2 + 0.01, 0, this.rightTop + 0.002); p.add(mesh);
      this.group.add(p);
      this.flips.push({ p, mesh, geo, base: geo.attributes.position.array.slice(), t: 0, dur });
    }
    update(dt) {
      for (let i = this.flips.length - 1; i >= 0; i--) {
        const fl = this.flips[i]; fl.t += dt / fl.dur;
        const tt = clamp(fl.t), t = 0.5 - 0.5 * Math.cos(Math.PI * tt), th = Math.PI * t * 0.985;
        const pos = fl.geo.attributes.position.array, b = fl.base;
        // kâğıt sırttan kalkar; uç tarafı havanın direnciyle geriden gelir ve kıvrılır
        const curl = Math.sin(Math.PI * t) * (1.05 - 0.35 * t);
        for (let k = 0; k < pos.length; k += 3) {
          const u = b[k] / this.PW, r = b[k];
          const ang = th - curl * (u * u * 0.85 + u * 0.15) * 0.95;
          const sag = Math.sin(Math.PI * t) * 0.018 * Math.sin(Math.PI * u) * (b[k + 1] / this.PH + 0.5);  // köşeler hafif sarkar
          pos[k] = Math.cos(ang) * r; pos[k + 2] = Math.sin(ang) * r * 0.98 + sag; pos[k + 1] = b[k + 1];
        }
        fl.geo.attributes.position.needsUpdate = true; fl.geo.computeVertexNormals();
        fl.p.position.z = lerp(this.rightTop + 0.002, this.leftTop + 0.002, t);
        if (fl.t >= 1) { this.group.remove(fl.p); fl.geo.dispose(); this.flips.splice(i, 1); }
      }
    }
  }

  // ---------- sahne ----------
  function makeStage(cv, { shadows = true, fov = 32 } = {}) {
    const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(window.ErmeQuality ? window.ErmeQuality.dpr(2) : Math.min(window.devicePixelRatio || 1, 2));   // 4K/Retina'da GPU'yu boğmasın
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = T.VSMShadowMap;
    const scene = new T.Scene();
    scene.environment = studioEnv(renderer);
    const cam = new T.PerspectiveCamera(fov, 1, 0.1, 60);
    scene.add(new T.HemisphereLight('#fff3e0', '#3a2a1e', 0.35));
    const key = new T.DirectionalLight('#fff1dc', 2.0); key.position.set(-2.2, 4, 2.5); key.castShadow = shadows;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -2.5;
    key.shadow.camera.right = key.shadow.camera.top = 2.5; key.shadow.radius = 9; key.shadow.blurSamples = 16; key.shadow.bias = -0.0004;
    const rim = new T.DirectionalLight(css('--accent-hi', '#bd6a3a'), 0.9); rim.position.set(3, 1.5, -2);
    scene.add(key, rim);
    const ground = new T.Mesh(new T.PlaneGeometry(12, 12), new T.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.105; ground.receiveShadow = true; scene.add(ground);
    const resize = () => {
      const w = cv.clientWidth || cv.width, h = cv.clientHeight || cv.height;
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    resize();
    return { renderer, scene, cam, resize, ground, key, rim };
  }

  // =====================================================================
  // AÇILIŞ SAHNESİ
  // =====================================================================
  window.BookIntro = {
    play(onDone) {
      const done = () => { try { onDone && onDone(); } catch (e) { console.error(e); } };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
      const wrap = document.createElement('div'); wrap.className = 'intro';
      wrap.innerHTML = `<canvas></canvas><div class="intro-cap"><div class="intro-mark">E</div><div class="intro-name">ERME BOOKS</div><div class="intro-sub">KİTAP STÜDYOSU</div></div><div class="intro-skip">geçmek için tıkla</div>`;
      document.body.appendChild(wrap);
      const cv = wrap.querySelector('canvas');
      let st;
      try { st = makeStage(cv); } catch (e) { console.warn('WebGL yok', e); wrap.remove(); return done(); }
      const { renderer, scene, cam, resize, key } = st;

      const book = new Book({ title: 'ERME BOOKS', author: 'Kitap Stüdyosu' });
      book.group.rotation.x = -Math.PI / 2;     // masada yatıyor, kapak yukarı
      const holder = new T.Group(); holder.add(book.group); scene.add(holder);
      book.setStacks(0.02);

      // kitaptan havalanan yapraklar (mevsimin renkleri) -> ana sayfadaki hayat ağacına geçiş
      const season = document.body.dataset.season || 'sonbahar';
      const pal = SEASON_LEAVES[season] || SEASON_LEAVES.sonbahar;
      const NL = 140, r = rng(11);
      const leaves = new T.InstancedMesh(leafGeo(0.11), new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 0.7, transparent: true, opacity: 1 }), NL);
      leaves.castShadow = true; leaves.frustumCulled = false;
      const L = [];
      for (let i = 0; i < NL; i++) {
        leaves.setColorAt(i, new T.Color(pal.cols[i % pal.cols.length]).multiplyScalar(0.85 + r() * 0.3));
        L.push({ x: (r() - 0.5) * 0.8, z: (r() - 0.5) * 0.9, d: r() * 0.9, sp: 0.6 + r() * 0.8, a: r() * 6.28, rad: 0.3 + r() * 1.6, h: 1.2 + r() * 2.2, rot: new T.Euler(r() * 6, r() * 6, r() * 6), rs: (r() - 0.5) * 6 });
      }
      scene.add(leaves);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), v3 = new T.Vector3(), sc = new T.Vector3();

      const D = 5.0;   // toplam süre (sn)
      const cover = { x: 0, v: 0 }, camY = { x: 4.4, v: 0 }, camZ = { x: 3.2, v: 0 };
      let t = 0, last = performance.now(), flipped = 0, ended = false, raf = 0;
      const finish = () => {
        if (ended) return; ended = true;
        wrap.classList.add('out');
        setTimeout(() => { cancelAnimationFrame(raf); renderer.dispose(); wrap.remove(); }, 750);
        done();
      };
      wrap.addEventListener('click', finish);
      window.addEventListener('keydown', function k(e) { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { window.removeEventListener('keydown', k); finish(); } });
      window.addEventListener('resize', resize);
      const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);     // smootherstep

      const frame = (now) => {
        const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000)); last = now; t += dt;
        // 0-1.3: kitap karanlıktan, hafifçe dönerek yerine oturur (zıplama yok)
        const inn = smooth(seg(t, 0, 1.4));
        holder.position.y = lerp(0.5, 0, inn);
        holder.rotation.y = lerp(0.55, 0, inn);
        book.group.rotation.z = lerp(-0.5, -0.1, inn) + Math.sin(t * 0.7) * 0.012;
        key.intensity = lerp(0.2, 2.0, smooth(seg(t, 0, 1.2)));
        // 1.1-2.1: kapak yayla açılır, 3.9-4.5 kapanır
        const coverTarget = t > 1.1 ? 1 : 0;
        book.setOpen(clamp(spring(cover, coverTarget, dt, 5.2), 0, 1.02));
        holder.position.x = cover.x * book.W * 0.5;
        // 1.8-3.6: sayfalar çevrilir, sol yığın kalınlaşır, sayfalar mürekkeple dolar
        while (flipped < 6 && t > 1.85 + flipped * 0.3) { book.flipPage(0.85); flipped++; }
        book.setStacks(lerp(0.02, 0.6, smooth(seg(t, 1.8, 3.7))));
        book.setInk('right', smooth(seg(t, 1.9, 3.5)));
        book.setInk('left', smooth(seg(t, 2.1, 3.7)), 'ERME BOOKS');
        book.update(dt);
        // 2.6-4.8: sayfalardan yapraklar sarmal çizerek havalanır
        for (let i = 0; i < NL; i++) {
          const o = L[i], k = seg(t, 2.5 + o.d, 5.6 + o.d * 0.5);
          if (k <= 0) { m4.makeScale(0, 0, 0); leaves.setMatrixAt(i, m4); continue; }
          const e = smooth(k), ang = o.a + e * o.sp * 3.2;
          v3.set(holder.position.x + o.x + Math.cos(ang) * o.rad * e, 0.12 + e * o.h, o.z + Math.sin(ang) * o.rad * e * 0.6);
          o.rot.x += o.rs * dt * 0.6; o.rot.y += o.rs * dt; q.setFromEuler(o.rot);
          const s1 = Math.min(1, k * 5) * (1 - smooth(seg(k, 0.88, 1)));
          sc.setScalar(s1); m4.compose(v3, q, sc); leaves.setMatrixAt(i, m4);
        }
        leaves.instanceMatrix.needsUpdate = true;
        // kamera: yavaş bir yaklaşma, sonunda yukarı (ağaca) bakar
        // kamera geri çekilip yükselen yapraklara (ağaca) bakar
        const up = smooth(seg(t, 3.0, D));
        cam.position.set(0, spring(camY, lerp(4.0, 1.9, up), dt, 2.6), spring(camZ, lerp(2.7, 5.8, up), dt, 2.6));
        cam.lookAt(holder.position.x * (1 - up), lerp(0, 1.25, up), lerp(0.12, 0, up));
        window.__introT = t;
        wrap.classList.toggle('cap', t > 3.9);
        renderer.render(scene, cam);
        if (t >= D + 0.3) return finish();
        if (!ended) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    },
  };

  window.Book3D = { Book, makeStage, rng, canvas, tex, shade, css, clamp, lerp, seg, spring, leafGeo, roundedBox, studioEnv, SEASON_LEAVES };

  // =====================================================================
  // VİTRİN: dik duran, fareyle döndürülebilen kitap (Kapak ve EPUB sekmeleri)
  // =====================================================================
  window.BookShowcase = {
    attach(cv) {
      let st;
      try { st = makeStage(cv, { fov: 30 }); } catch (e) { console.warn('WebGL yok', e); return null; }
      const { renderer, scene, cam, resize, ground } = st;
      cam.position.set(0, 0.15, 4.3); cam.lookAt(0, 0, 0);
      ground.position.y = -0.76;
      const book = new Book({ title: '', author: '' });
      const holder = new T.Group(); holder.add(book.group); scene.add(holder);
      book.group.position.y = 0.0;
      book.setStacks(0); book.setOpen(0);
      const s = { rotY: -0.5, rotX: 0.06, tgtY: -0.5, tgtX: 0.06, drag: null, idle: 0, pop: 0, slide: 0, slideTo: 0, visible: true, vel: 0, lastX: 0, lastT: 0 };
      const sy = { x: -0.5, v: 0 }, sx = { x: 0.06, v: 0 }, sl = { x: 0, v: 0 };
      let raf = 0, last = performance.now();
      cv.style.cursor = 'grab'; cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => { s.drag = { x: e.clientX, y: e.clientY, ry: s.tgtY, rx: s.tgtX }; s.vel = 0; s.lastX = e.clientX; s.lastT = performance.now(); cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', (e) => {
        if (!s.drag) return;
        const now = performance.now(), dtm = Math.max(1, now - s.lastT);
        s.vel = lerp(s.vel, ((e.clientX - s.lastX) * 0.012) / (dtm / 1000), 0.5); s.lastX = e.clientX; s.lastT = now;
        s.tgtY = s.drag.ry + (e.clientX - s.drag.x) * 0.012;
        s.tgtX = clamp(s.drag.rx + (e.clientY - s.drag.y) * 0.006, -0.5, 0.5);
        s.idle = 0;
      });
      const up = () => { s.drag = null; cv.style.cursor = 'grab'; };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      const io = new IntersectionObserver((e) => { s.visible = e[0].isIntersecting; if (s.visible && !raf) raf = requestAnimationFrame(loop); });
      io.observe(cv);
      const ro = new ResizeObserver(resize); ro.observe(cv);
      function loop(now) {
        raf = 0;
        const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
        s.idle += dt;
        if (!s.drag) {
          s.tgtY += s.vel * dt; s.vel *= Math.exp(-dt * 2.4);              // bırakınca savrulmaya devam eder
          if (Math.abs(s.vel) < 0.05 && s.idle > 2.5) s.tgtY += dt * 0.22;  // boşta yavaşça döner
          s.tgtX = lerp(s.tgtX, 0.06, 1 - Math.exp(-dt * 1.5));
        }
        s.rotY = spring(sy, s.tgtY, dt, 9);
        s.rotX = spring(sx, s.tgtX, dt, 9);
        s.pop = Math.max(0, s.pop - dt * 1.6);
        s.slide = spring(sl, s.slideTo, dt, 4.5);
        holder.rotation.set(s.rotX, s.rotY, 0);
        holder.position.y = Math.sin(now / 1100) * 0.04 + Math.sin(s.pop * Math.PI) * 0.12;
        holder.position.x = s.slide * 3.2;
        holder.scale.setScalar(1 + Math.sin(s.pop * Math.PI) * 0.035);
        holder.rotation.z = Math.sin(now / 1700) * 0.012;
        renderer.render(scene, cam);
        if (s.visible) raf = requestAnimationFrame(loop);
      }
      raf = requestAnimationFrame(loop);
      return {
        setCover(src, title, author) {
          s.pop = 1;
          if (!src) { book.drawCover({ title: title || 'ERME BOOKS', author: author || '' }); return; }
          const im = new Image(); im.onload = () => book.drawCover({ image: im }); im.src = src;
        },
        slideAway(on) { s.slideTo = on ? 1 : 0; },             // EPUB bitince kitap rafa doğru kayar
        dispose() { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); renderer.dispose(); },
      };
    },
  };

  // =====================================================================
  // DOLAN KİTAP (ilerleme kutusu)
  // =====================================================================
  window.BookProgress = {
    attach(cv) {
      let st;
      try { st = makeStage(cv, { fov: 30 }); } catch (e) { console.warn('WebGL yok', e); return null; }
      const { renderer, scene, cam, resize } = st;
      cam.position.set(0, 2.75, 1.75); cam.lookAt(0, 0, 0.0);
      const book = new Book({});
      book.group.rotation.x = -Math.PI / 2; book.group.rotation.z = -0.16;
      const holder = new T.Group(); holder.add(book.group); scene.add(holder);
      const spark = sticker('yildiz', book.accent); spark.material.opacity = 0; spark.position.set(0.35, 0.5, 0); scene.add(spark);

      const s = { open: 0, openTo: 0, f: 0, fTo: 0, ink: 0, inkTo: 0, inkSpeed: 0, busy: false, state: 'idle', stateT: 0, visible: true };
      let last = performance.now(), raf = 0, acc = 0;
      const io = new IntersectionObserver((e) => { s.visible = e[0].isIntersecting; if (s.visible && !raf) loop(last = performance.now()); });
      io.observe(cv);
      window.addEventListener('resize', resize);

      function loop(now) {
        raf = 0;
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now; acc += dt;
        // 30 fps yeter; GPU modele kalsın
        const moving = book.flips.length || Math.abs(s.open - s.openTo) > 0.002 || Math.abs(s.f - s.fTo) > 0.002 || ((s.state === 'done' || s.state === 'fail') && s.stateT < 2);
        if (acc >= (moving ? 1 / 60 : 1 / 30)) {
          const d = acc; acc = 0; s.stateT += d;
          s.open = lerp(s.open, s.openTo, 1 - Math.exp(-d * 5));
          s.f = lerp(s.f, s.fTo, 1 - Math.exp(-d * 4));
          if (s.inkSpeed > 0) s.inkTo = Math.min(0.94, s.inkTo + d * s.inkSpeed);   // sayfa okunurken yavaşça dolar
          s.ink = lerp(s.ink, s.inkTo, 1 - Math.exp(-d * 6));
          book.setOpen(s.open); book.setStacks(s.f); book.setInk('right', s.ink); book.update(d);
          holder.position.x = s.open * book.W * 0.5;
          book.group.position.y = Math.sin(now / 900) * 0.012;
          if (s.busy) { book.group.rotation.z = -0.16 + Math.sin(now / 1400) * 0.05; }
          // bitti: kitap kapanır, zıplar, yıldız parlar
          if (s.state === 'done') {
            const k = s.stateT;
            book.group.position.y += Math.sin(clamp((k - 0.45) / 0.5) * Math.PI) * 0.18;
            spark.material.opacity = clamp(Math.sin(clamp((k - 0.6) / 0.9) * Math.PI));
            spark.material.rotation = k * 1.5; spark.scale.setScalar(0.22 + 0.12 * Math.sin(clamp((k - 0.6) / 0.9) * Math.PI));
          } else if (s.state === 'fail') {
            book.group.position.x = Math.sin(s.stateT * 40) * 0.03 * Math.max(0, 1 - s.stateT * 2);
          }
          renderer.render(scene, cam);
        }
        if (s.visible) raf = requestAnimationFrame(loop);
      }
      loop(last);

      const api = {
        start() { Object.assign(s, { openTo: 1, fTo: 0, inkTo: 0, ink: 0, inkSpeed: 0, state: 'run', stateT: 0, busy: false }); book.pageNo = 0; book.setInk('right', 0); book.setInk('left', 1); spark.material.opacity = 0; },
        // yeni sayfa okunmaya başladı: avgSec tahmini süresinde sağ sayfa dolsun
        pageStarted(avgSec) { s.inkSpeed = avgSec > 0 ? 0.94 / avgSec : 0.08; },
        pageDone() { s.inkTo = 1; book.flipPage(0.6); setTimeout(() => { book.pageNo = (book.pageNo || 0) + 1; s.ink = s.inkTo = 0; book.rightInk = -1; }, 330); },
        setFraction(f) { s.fTo = clamp(f); },
        busy(on) { s.busy = on; if (on) s.inkSpeed = 0; },
        finish(ok) { s.state = ok ? 'done' : 'fail'; s.stateT = 0; s.inkSpeed = 0; if (ok) { s.openTo = 0; s.fTo = 1; } },
        setCover(src, title) {
          if (!src) { book.drawCover({ title, author: '' }); return; }
          const im = new Image(); im.onload = () => book.drawCover({ image: im }); im.src = src;
        },
        dispose() { cancelAnimationFrame(raf); io.disconnect(); renderer.dispose(); },
      };
      return api;
    },
  };
})();
