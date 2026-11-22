// fauna2d.js - Hayat Ağacı'nın hayvanları: 2.5D masalsı kitap illüstrasyonu.
// Her hayvan Canvas'ta Bezier eğrileriyle çizilen katmanlardan oluşur (gövde, baş+boyun, kulak, kuyruk,
// bacakların üst ve alt parçaları). Katmanlar eklem noktalarından döner; sahnede kameraya dönük durur,
// gittiği yöne göre aynalanır. Boyama: sıcak ışık / serin gölge geçişi, katman katman tüy darbeleri,
// gölge tarafında gravür taraması, üstten vuran ışık kenarı.
//   window.Fauna = { TINT, quad(kind), hopper(kind), bird(kind), Mover }
(function () {
  const TINT = new THREE.Color(1, 1, 1);   // gece/fırtına karartması (sahneyle paylaşılır)
  const T = window.THREE;
  if (!T) return;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (x) => x * x * (3 - 2 * x);
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const V = (x, y, z) => new T.Vector3(x, y, z);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const PX = 380;   // birim başına piksel

  // ---------- yol yardımcıları ----------
  function smoothPath(pts, closed = true) {   // noktalardan yumuşak (ikinci derece Bezier) kapalı eğri
    const p = new Path2D(), n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!closed) { p.moveTo(...pts[0]); for (let i = 1; i < n - 1; i++) p.quadraticCurveTo(...pts[i], ...mid(pts[i], pts[i + 1])); p.lineTo(...pts[n - 1]); return p; }
    p.moveTo(...mid(pts[n - 1], pts[0]));
    for (let i = 0; i < n; i++) p.quadraticCurveTo(...pts[i], ...mid(pts[i], pts[(i + 1) % n]));
    p.closePath(); return p;
  }
  // kalınlığı değişen uzuv: [x, y, genişlik] düğümlerinden yuvarlak uçlu dış hat
  function limbPts(nodes) {
    const L = [], R = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)], [x, y, w] = nodes[i];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      L.push([x - dy * w / 2, y + dx * w / 2]); R.push([x + dy * w / 2, y - dx * w / 2]);
    }
    const f = nodes[0], e = nodes[nodes.length - 1];
    const cap = (n, other, w) => { const dx = n[0] - other[0], dy = n[1] - other[1], l = Math.hypot(dx, dy) || 1; return [n[0] + dx / l * w * 0.45, n[1] + dy / l * w * 0.45]; };
    return [...L, cap(e, nodes[nodes.length - 2], e[2]), ...R.reverse(), cap(f, nodes[1], f[2])];
  }
  function bounds(pts, pad = 0.03) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  const C = (hex) => new T.Color(hex);
  const css = (c, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  const shadeHex = (hex, l) => { const c = C(hex); c.offsetHSL(0, 0, l); return c; };

  // ---------- boyama: bir şekli illüstrasyon gibi boya ----------
  // pal: { base, light, shadow, belly?, line }, o: { bellyY, furDir (radyan), fur (yoğunluk), sock {y, col}, tip {test, col}, spots }
  function paintPart(ctx, path, B, pal, o = {}) {
    const base = C(pal.base), light = C(pal.light || shadeHex(pal.base, 0.12).getHexString().padStart(7, '#')), shadow = C(pal.shadow || shadeHex(pal.base, -0.15).getHexString().padStart(7, '#'));
    const g = ctx.createLinearGradient(0, B.y1, 0, B.y0);
    g.addColorStop(0, css(light)); g.addColorStop(0.45, css(base)); g.addColorStop(1, css(shadow));
    ctx.fillStyle = g; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    // karın / açık bölge
    if (pal.belly && o.bellyY !== undefined) {
      const bg = ctx.createLinearGradient(0, o.bellyY + 0.06, 0, o.bellyY - 0.04);
      bg.addColorStop(0, css(C(pal.belly), 0)); bg.addColorStop(1, css(C(pal.belly), 0.95));
      ctx.fillStyle = bg; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, o.bellyY + 0.06 - B.y0);
    }
    if (o.sock) { const sg = ctx.createLinearGradient(0, o.sock.y + 0.05, 0, o.sock.y - 0.03); sg.addColorStop(0, css(C(o.sock.col), 0)); sg.addColorStop(1, css(C(o.sock.col), 1)); ctx.fillStyle = sg; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, o.sock.y + 0.05 - B.y0); }
    if (o.tip) { ctx.fillStyle = o.tip.grad(ctx); ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0); }
    // benekler (yavru geyik)
    if (o.spots) { ctx.fillStyle = o.spots.col || 'rgba(250,240,225,.85)'; for (let i = 0; i < o.spots.n; i++) { const x = lerp(o.spots.x0, o.spots.x1, rnd()), y = lerp(o.spots.y0, o.spots.y1, rnd()); ctx.beginPath(); ctx.ellipse(x, y, 0.012 + rnd() * 0.01, 0.009 + rnd() * 0.006, rnd(), 0, 6.283); ctx.fill(); } }
    // tüy darbeleri: açık ve koyu, eğim yönünde, katman katman
    const area = (B.x1 - B.x0) * (B.y1 - B.y0), n = Math.floor(area * PX * PX * 0.012 * (o.fur ?? 1));
    const dir = o.furDir ?? -0.35, lw = 1.6 / PX;
    const m = ctx.getTransform();
    for (let i = 0; i < n; i++) {
      const x = lerp(B.x0, B.x1, rnd()), y = lerp(B.y0, B.y1, rnd());
      const dp = m.transformPoint({ x, y }); if (!ctx.isPointInPath(path, dp.x, dp.y)) continue;
      const up = (y - B.y0) / (B.y1 - B.y0), len = (0.012 + rnd() * 0.022) * (o.furLen ?? 1), a = dir + (rnd() - 0.5) * 0.6;
      const lightStroke = rnd() < 0.35 + up * 0.35;
      ctx.strokeStyle = lightStroke ? css(light.clone().lerp(C('#fff6e6'), 0.35), 0.28) : css(shadow.clone().multiplyScalar(0.8), 0.26);
      ctx.lineWidth = lw * (0.7 + rnd()); ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + 0.004, y + Math.sin(a) * len * 0.5 + 0.004, x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    // gravür taraması: alt (gölge) kısımda ince çapraz çizgiler
    const hy = lerp(B.y0, B.y1, 0.42);
    const hg = ctx.createLinearGradient(0, hy, 0, B.y0); hg.addColorStop(0, css(shadow, 0)); hg.addColorStop(1, css(shadow.clone().multiplyScalar(0.55), 0.32));
    ctx.strokeStyle = hg; ctx.lineWidth = 1.1 / PX;
    for (let x = B.x0 - (B.y1 - B.y0); x < B.x1; x += 5.5 / PX) { ctx.beginPath(); ctx.moveTo(x, B.y0); ctx.lineTo(x + (hy - B.y0) * 0.6, hy); ctx.stroke(); }
    // üstten vuran sıcak ışık kenarı
    const rg = ctx.createLinearGradient(0, B.y1, 0, lerp(B.y0, B.y1, 0.55)); rg.addColorStop(0, 'rgba(255,236,200,.75)'); rg.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.strokeStyle = rg; ctx.lineWidth = 9 / PX; ctx.stroke(path);
    ctx.restore();
    // ince, kendi renginde mürekkep çizgisi
    ctx.strokeStyle = css(o.softLine ? base : C(pal.line || '#2e2016'), o.softLine ? 0.25 : 0.55); ctx.lineWidth = 2 / PX; ctx.stroke(path);
  }

  // bir katman: noktalar (yerel birim) + boyama -> pivottan dönen düzlem
  function makeLayer(spec, pivot, z) {
    const pts = spec.pts, B = bounds(pts, 0.035 + (spec.pad || 0));
    const W = Math.ceil((B.x1 - B.x0) * PX), H = Math.ceil((B.y1 - B.y0) * PX);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.setTransform(PX, 0, 0, -PX, -B.x0 * PX, B.y1 * PX);
    const path = smoothPath(pts);
    paintPart(ctx, path, B, spec.pal, spec.o || {});
    if (spec.extra) spec.extra(ctx, B);
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new T.PlaneGeometry(B.x1 - B.x0, B.y1 - B.y0); geo.translate((B.x0 + B.x1) / 2 - pivot[0], (B.y0 + B.y1) / 2 - pivot[1], 0);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, fog: true, side: T.DoubleSide, toneMapped: false })); mesh.material.color = TINT;   // mevsim ışığıyla birlikte kararır
    const g = new T.Group(); g.position.set(pivot[0], pivot[1], z); g.add(mesh);
    return g;
  }
  // göz: koyu parlak bebek, sıcak halka, beyaz parıltı
  const eyeDraw = (x, y, r, iris) => (ctx) => {
    ctx.fillStyle = iris || '#2a1a10'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.15, r, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#0c0806'; ctx.beginPath(); ctx.ellipse(x + r * 0.1, y, r * (iris ? 0.55 : 0.85), r * (iris ? 0.6 : 0.8), 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.35, r * 0.3, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,200,.5)'; ctx.lineWidth = 1.5 / PX; ctx.beginPath(); ctx.ellipse(x, y, r * 1.35, r * 1.2, 0, 0.3, 2.6); ctx.stroke();
  };
  const dot = (x, y, r, col) => (ctx) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, r * 1.2, r, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.35, r * 0.3, 0, 6.283); ctx.fill(); };
  const both = (...fs) => (ctx, B) => fs.forEach((f) => f && f(ctx, B));

  // =====================================================================
  // DÖRT AYAKLI: parametrelerden siluet üret
  // =====================================================================
  const QUAD = {
    deer: { L: 0.95, H: 0.32, legH: 0.62, nk: 0.36, na: 1.05, hr: 0.085, sl: 0.13, sh: 0.07, sd: -0.55, ear: [0.14, 0.055], tail: [[0, 0, 0.05], [-0.06, -0.03, 0.055], [-0.09, -0.1, 0.025]], legW: 0.05, pal: { base: '#b27c4e', light: '#e2b27e', shadow: '#6a4630', belly: '#f2e4cf', line: '#3a2618' }, earIn: '#efcbb3', sock: '#4a3020', tailWhite: true, size: 0.55 },
    fawn: { L: 0.62, H: 0.24, legH: 0.48, nk: 0.24, na: 1.0, hr: 0.07, sl: 0.09, sh: 0.055, sd: -0.5, ear: [0.12, 0.05], tail: [[0, 0, 0.035], [-0.05, -0.03, 0.035], [-0.06, -0.07, 0.015]], legW: 0.035, pal: { base: '#bc8350', light: '#e8b886', shadow: '#704a2e', belly: '#f4e7d4', line: '#3a2618' }, earIn: '#f0cdb6', spots: true, sock: '#4a3020', tailWhite: true, size: 0.5 },
    stag: { L: 1.08, H: 0.36, legH: 0.68, nk: 0.4, na: 0.98, hr: 0.095, sl: 0.14, sh: 0.075, sd: -0.55, ear: [0.13, 0.055], tail: [[0, 0, 0.05], [-0.06, -0.03, 0.055], [-0.09, -0.1, 0.025]], legW: 0.055, pal: { base: '#8c5a38', light: '#c48a5a', shadow: '#4e3220', belly: '#e6d4bc', line: '#2e1e12' }, earIn: '#e2bea4', antler: true, sock: '#3a2618', tailWhite: true, size: 0.6 },
    fox: { L: 0.62, H: 0.2, legH: 0.26, nk: 0.14, na: 0.55, hr: 0.075, sl: 0.13, sh: 0.05, sd: -0.25, ear: [0.1, 0.06], tail: [[0, 0, 0.07], [-0.2, -0.04, 0.13], [-0.4, -0.06, 0.12], [-0.52, 0.0, 0.05]], legW: 0.035, pal: { base: '#d0632a', light: '#f0975a', shadow: '#8a3a18', belly: '#f7eee2', line: '#4a1e0c' }, earIn: '#2e2018', sock: '#2a1e18', tailTip: '#f8f2e8', chestWhite: true, size: 0.5 },
    wolf: { L: 1.0, H: 0.3, legH: 0.33, nk: 0.17, na: 0.3, hr: 0.1, sl: 0.16, sh: 0.068, sd: -0.15, ear: [0.1, 0.065], tail: [[0, 0, 0.08], [-0.14, -0.1, 0.13], [-0.27, -0.22, 0.13], [-0.34, -0.3, 0.05]], legW: 0.055, furLen: 1.3, pal: { base: '#6e7076', light: '#b8b8b8', shadow: '#45474c', belly: '#e2ded6', line: '#2a2a2e' }, earIn: '#4a4a4e', sock: '#d8d2c8', size: 0.6 },
    bear: { L: 1.15, H: 0.48, legH: 0.32, nk: 0.14, na: 0.2, hr: 0.14, sl: 0.13, sh: 0.1, sd: -0.25, ear: [0.07, 0.07], earRound: true, hump: 0.07, tail: [[0, 0, 0.06], [-0.04, -0.02, 0.06]], legW: 0.12, pal: { base: '#5c3c24', light: '#8c6440', shadow: '#2e1c10', belly: '#6e4a2e', line: '#1e120a' }, earIn: '#3a2416', furLen: 1.6, size: 0.6 },
  };
  function makeQuad(kind, extra = {}) {
    seed = 11 + kind.length * 31 + Math.floor(Math.random() * 1000);
    const o = Object.assign({}, QUAD[kind], extra);
    if (extra.coat) o.pal = Object.assign({}, o.pal, { base: extra.coat.back, belly: extra.coat.belly, light: shadeHex(extra.coat.back, 0.18).getStyle(), shadow: shadeHex(extra.coat.back, -0.2).getStyle() });
    const { L, H, legH: Lh, legW: lw } = o, hump = o.hump || 0;
    const root = new T.Group(), face = new T.Group(); root.add(face);
    const rig = new T.Group(); face.add(rig); rig.scale.setScalar(o.size);
    const body = new T.Group(); rig.add(body);
    const pal = o.pal, farPal = { base: shadeHex(pal.base, -0.1).getStyle(), light: shadeHex(pal.base, -0.02).getStyle(), shadow: shadeHex(pal.base, -0.22).getStyle(), line: pal.line };
    // gövde
    const top = Lh + H;
    const bodyPts = [[-L / 2, Lh + H * 0.55], [-L / 2 + L * 0.07, Lh + H * 0.93], [-L * 0.25, top], [L * 0.05, top - H * 0.04 + hump * 0.4], [L * 0.3, top + H * 0.03 + hump], [L / 2 - 0.02, Lh + H * 0.86], [L / 2 + 0.03, Lh + H * 0.5], [L * 0.4, Lh + H * 0.1], [L * 0.15, Lh - 0.005], [-L * 0.15, Lh + H * 0.04], [-L * 0.38, Lh + H * 0.06], [-L / 2 - 0.01, Lh + H * 0.27]];
    // bacak düğümleri (üst, alt) ön ve arka için
    const legSpec = (front) => {
      const hx = front ? L * 0.34 : -L * 0.32, hy = Lh + H * 0.45, kx = hx + (front ? 0.02 : -0.04), ky = Lh * 0.5;
      const upper = [[hx, hy + H * 0.25, front ? H * 0.75 : H * 0.95], [hx + (front ? 0.01 : -0.03), hy - (hy - ky) * 0.45, lw * (front ? 2.0 : 2.6)], [kx, ky, lw * 1.2]];
      const lower = [[kx, ky, lw * 1.15], [kx - (front ? 0 : 0.02), ky * 0.5, lw * 0.85], [kx + 0.01, 0.03, lw * 0.75], [kx + 0.03, 0.0, lw * 0.95]];
      return { hip: [hx, hy], knee: [kx, ky], upper, lower };
    };
    const legs = [];
    for (const far of [true, false]) {
      for (const front of [true, false]) {
        const s = legSpec(front), p = far ? farPal : pal, dx = far ? (front ? 0.05 : 0.04) : 0;
        const hip = makeLayer({ pts: limbPts(s.upper.map(([x, y, w]) => [x + dx, y, w])), pal: p, o: { fur: 0.8, furDir: -1.4, softLine: true } }, [s.hip[0] + dx, s.hip[1]], far ? -0.03 : -0.012);
        const lowSpec = { pts: limbPts(s.lower.map(([x, y, w]) => [x + dx, y, w])), pal: p, o: { fur: 0.6, furDir: -1.5, sock: o.sock ? { y: kind === 'wolf' ? 0.1 : 0.12, col: o.sock } : null } };
        lowSpec.extra = (ctx) => { ctx.fillStyle = kind === 'bear' ? '#2a1a10' : '#2a1c14'; ctx.beginPath(); ctx.ellipse(s.knee[0] + dx + 0.03, 0.012, lw * 0.6, lw * 0.35, 0, 0, 6.283); ctx.fill(); };
        const knee = makeLayer(lowSpec, [s.knee[0] + dx, s.knee[1]], 0.001);
        knee.position.set(s.knee[0] - s.hip[0], s.knee[1] - s.hip[1], far ? -0.001 : 0.001);
        hip.add(knee); body.add(hip);
        legs.push({ hip, knee, front, far });
      }
    }
    // kuyruk
    const tb = [-L / 2 + 0.02, Lh + H * 0.8];
    const tailNodes = o.tail.map(([x, y, w]) => [tb[0] + x, tb[1] + y, w]);
    const tailSpec = { pts: limbPts(tailNodes), pal: { ...pal, belly: o.tailWhite ? '#f6efe4' : pal.belly }, o: { fur: 1.4, furDir: Math.PI, bellyY: o.tailWhite ? tb[1] - 0.03 : undefined } };
    if (o.tailTip) { const tx = tailNodes[tailNodes.length - 1][0]; tailSpec.o.tip = { grad: (ctx) => { const gg = ctx.createLinearGradient(tx + 0.14, 0, tx, 0); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.55, css(C(o.tailTip), 0)); gg.addColorStop(1, css(C(o.tailTip), 1)); return gg; } }; }
    const tail = makeLayer(tailSpec, tb, -0.02); body.add(tail);
    // gövde katmanı
    const bodyLayer = makeLayer({
      pts: bodyPts, pal, o: { bellyY: Lh + H * 0.28, fur: o.furLen ? 1.4 : 1, furLen: o.furLen || 1, spots: o.spots ? { n: 26, x0: -L * 0.35, x1: L * 0.3, y0: Lh + H * 0.55, y1: top - 0.02 } : null },
    }, [0, Lh + H * 0.5], 0);
    body.add(bodyLayer);
    // boyun + baş
    const Nt = [L * 0.33, top - 0.01], Nb = [L * 0.5, Lh + H * 0.4];
    const na = o.na, Hc = [Nt[0] + Math.cos(na) * o.nk + 0.04, Nt[1] + Math.sin(na) * o.nk];
    const hr = o.hr, sd = o.sd, rot = (x, y) => [Math.cos(sd) * x - Math.sin(sd) * y, Math.sin(sd) * x + Math.cos(sd) * y];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const tip = add(Hc, rot(hr * 0.45 + o.sl, 0));
    const headPts = [
      Nt, [lerp(Nt[0], Hc[0], 0.5) - 0.02, lerp(Nt[1], Hc[1], 0.5) + 0.02],
      add(Hc, [-hr * 0.85, hr * 0.45]), add(Hc, [-hr * 0.2, hr * 1.0]), add(Hc, [hr * 0.55, hr * 0.85]),
      add(Hc, rot(hr * 0.4 + o.sl * 0.55, o.sh * 0.7)), add(tip, rot(0, o.sh * 0.45)), add(tip, rot(0.012, 0)), add(tip, rot(0, -o.sh * 0.45)),
      add(Hc, rot(hr * 0.4 + o.sl * 0.4, -o.sh * 0.65)), add(Hc, [hr * 0.15, -hr * 0.95]), add(Hc, [-hr * 0.55, -hr * 0.8]),
      [lerp(Hc[0], Nb[0], 0.55) + 0.02, lerp(Hc[1], Nb[1], 0.5)], Nb, [Nb[0] - 0.12, Nb[1] + 0.04],
    ];
    const eyeP = add(Hc, rot(hr * 0.25, hr * 0.32)), noseP = add(tip, rot(-0.008, o.sh * 0.15));
    const neck = makeLayer({
      pts: headPts, pal, o: { bellyY: o.chestWhite ? Hc[1] - hr * 0.2 : Nb[1] - 0.02, fur: 1, furDir: -2.2 },
      extra: both(eyeDraw(eyeP[0], eyeP[1], hr * 0.16), dot(noseP[0], noseP[1], o.sh * 0.32, '#1a120c'),
        (ctx) => { ctx.strokeStyle = 'rgba(40,24,14,.5)'; ctx.lineWidth = 2 / PX; const m0 = add(tip, rot(-o.sl * 0.35, -o.sh * 0.25)), m1 = add(tip, rot(-0.01, -o.sh * 0.3)); ctx.beginPath(); ctx.moveTo(...m0); ctx.quadraticCurveTo(m0[0] + 0.02, m0[1] - 0.01, ...m1); ctx.stroke(); }),
    }, [Nt[0] + 0.03, Nt[1] - 0.04], 0.01);
    body.add(neck);
    const headPivot = [Nt[0] + 0.03, Nt[1] - 0.04];
    const lidCol = new T.Color(pal.base), lid = new T.Mesh(new T.PlaneGeometry(hr * 0.5, hr * 0.42), new T.MeshBasicMaterial({ color: lidCol.clone(), toneMapped: false }));
    lid.position.set(eyeP[0] - headPivot[0], eyeP[1] - headPivot[1] + hr * 0.03, 0.004); lid.scale.y = 0.01; neck.add(lid);
    // kulaklar (arkadaki koyu, öndeki açık; içleri renkli)
    const ears = [];
    for (const far of [true, false]) {
      const base = add(Hc, [-hr * (far ? 0.55 : 0.3), hr * 0.8]), [el, ew] = o.ear;
      let pts;
      if (o.earRound) pts = limbPts([[base[0], base[1], ew], [base[0] - 0.005, base[1] + el * 0.6, ew * 1.15], [base[0] - 0.01, base[1] + el, ew * 0.5]]);
      else pts = limbPts([[base[0], base[1], ew * 0.8], [base[0] - el * 0.25, base[1] + el * 0.5, ew], [base[0] - el * 0.45, base[1] + el, ew * 0.15]]);
      const ear = makeLayer({ pts, pal: far ? farPal : pal, o: { fur: 0.6 },
        extra: (ctx) => { ctx.fillStyle = css(C(o.earIn), 0.85); ctx.beginPath(); ctx.ellipse(base[0] - el * 0.2, base[1] + el * 0.45, ew * 0.25, el * 0.3, 0.35, 0, 6.283); ctx.fill(); } }, base, far ? -0.004 : 0.004);
      ear.position.set(base[0] - headPivot[0], base[1] - headPivot[1], far ? -0.004 : 0.012);
      neck.add(ear); ears.push(ear);
    }
    // boynuzlar
    if (o.antler) {
      const a0 = add(Hc, [-hr * 0.1, hr * 0.95]);
      const ant = (ctx) => {
        ctx.lineCap = 'round';
        const branch = (x, y, a, len, w, d) => { const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; for (const [c, k] of [['#3a2a1a', 1.35], ['#d9c8a8', 1], ['rgba(255,248,230,.7)', 0.35]]) { ctx.strokeStyle = c; ctx.lineWidth = w * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, x2, y2); ctx.stroke(); } if (d > 0) { branch(x2, y2, a - 0.35, len * 0.72, w * 0.75, d - 1); branch(lerp(x, x2, 0.6), lerp(y, y2, 0.6), a + 0.7, len * 0.5, w * 0.7, d - 2); } };
        branch(a0[0], a0[1], 1.9, 0.17, 0.022, 3); branch(a0[0] + 0.02, a0[1], 1.6, 0.16, 0.02, 3);
        ctx.strokeStyle = 'rgba(120,90,60,.5)'; ctx.lineWidth = 0.004; ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a0[0] - 0.02, a0[1] + 0.06); ctx.stroke();
      };
      const cvs = document.createElement('canvas'), B = { x0: a0[0] - 0.35, x1: a0[0] + 0.15, y0: a0[1] - 0.02, y1: a0[1] + 0.5 };
      cvs.width = Math.ceil((B.x1 - B.x0) * PX); cvs.height = Math.ceil((B.y1 - B.y0) * PX);
      const cx = cvs.getContext('2d'); cx.setTransform(PX, 0, 0, -PX, -B.x0 * PX, B.y1 * PX); ant(cx);
      const tex = new T.CanvasTexture(cvs); tex.colorSpace = T.SRGBColorSpace;
      const geo = new T.PlaneGeometry(B.x1 - B.x0, B.y1 - B.y0); geo.translate((B.x0 + B.x1) / 2 - headPivot[0], (B.y0 + B.y1) / 2 - headPivot[1], 0);
      const am = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, fog: true, side: T.DoubleSide, toneMapped: false })); am.material.color = TINT; am.position.z = -0.006; neck.add(am);
    }
    const a = { kind, o, root, face, rig, body, neck, ears, legs, tail, ph: Math.random() * 6, amp: 0, pitch: 0, flip: 1, earT: 1 + Math.random() * 3, blinkT: 1 + Math.random() * 4, swishT: 2 + Math.random() * 4, br: Math.random() * 6 };
    addShadow(root, L * o.size * 0.75);
    a.animate = (dt, t, speed, look) => {
      billboard(a);
      const stride = (Lh + H) * 0.9, run = speed > stride * 2.2;
      a.amp = lerp(a.amp, speed > 0.02 ? Math.min(0.85, 0.32 + speed / stride * 0.25) : 0, 1 - Math.exp(-dt * 6));
      a.ph += dt * speed / (stride * 0.5) * Math.PI;
      const offs = run || kind === 'fox' || kind === 'wolf' ? [0, Math.PI, Math.PI, 0] : [Math.PI * 0.5, Math.PI * 1.5, 0, Math.PI];
      legs.forEach((l, i) => {
        const p = a.ph + offs[i], sw = Math.sin(p);
        l.hip.rotation.z = sw * a.amp * (l.front ? 0.55 : 0.5);
        l.knee.rotation.z = (l.front ? 1 : -1) * Math.max(0, Math.cos(p)) * a.amp * 0.9;   // ön diz geriye, arka diz öne bükülür: ayak yay çizer
      });
      // adım ritmine bağlı yaylanma (iki adımda bir tepe), koşuda öne eğilme
      body.position.y = (Math.abs(Math.sin(a.ph)) - 0.35) * 0.03 * a.amp * (run ? 2.0 : 1);
      body.rotation.z = Math.sin(a.ph * 2) * 0.018 * a.amp + (run ? -0.05 : 0) * a.amp;
      // nefes: dururken daha görünür, gövde hafifçe kabarıp iner
      a.br += dt * (speed > 0.02 ? 3.2 : 1.6); const breath = Math.sin(a.br) * (speed > 0.02 ? 0.008 : 0.02);
      bodyLayer.scale.y = 1 + breath; bodyLayer.scale.x = 1 - breath * 0.3;
      // göz kırpma
      a.blinkT -= dt; lid.scale.y = a.blinkT < 0.14 ? 1 : 0.01; if (a.blinkT < 0) a.blinkT = 2.5 + Math.random() * 4 * (Math.random() < 0.2 ? 0.1 : 1);
      lid.material.color.copy(lidCol).multiply(TINT);
      // baş: otlarken iner, yürürken hafifçe sallanır
      const pt = look?.graze ? -0.95 + Math.sin(t * 9 + a.ph) * 0.03 : look?.alert ? 0.22 + Math.sin(t * 0.7) * 0.05 : speed > 0.02 ? -0.08 + Math.sin(a.ph * 2) * 0.05 : Math.sin(t * 0.45 + a.br * 0.1) * 0.08 + Math.sin(t * 1.3) * 0.02;
      a.pitch = lerp(a.pitch, pt, 1 - Math.exp(-dt * 3)); neck.rotation.z = a.pitch;
      a.swishT -= dt; if (a.swishT < 0) a.swishT = 2 + Math.random() * 5;
      const swish = a.swishT < 0.7 ? Math.sin(a.swishT * 18) * 0.28 * a.swishT : 0;
      tail.rotation.z = Math.sin(t * (kind === 'deer' || kind === 'fawn' ? 7 : 2.2) + a.br) * (speed > 0.02 ? 0.16 : 0.06) + swish + (speed > 0.02 ? Math.sin(a.ph * 2) * 0.06 : 0);
      a.earT -= dt; const tw = a.earT < 0.3 ? Math.sin(a.earT * 24) * 0.25 : 0; if (a.earT < 0) a.earT = 1.5 + Math.random() * 4;
      ears.forEach((e, i) => (e.rotation.z = Math.sin(t * 1.3 + i) * 0.04 + (i ? tw : 0) - a.pitch * 0.15));
    };
    return a;
  }
  // kameraya dönük dur, gittiği yöne aynalan
  function billboard(a) {
    const yaw = a.root.rotation.y, fx = Math.cos(yaw);
    if (Math.abs(fx) > 0.15) a.flip = fx >= 0 ? 1 : -1;
    a.face.rotation.y = -yaw; a.face.scale.x = lerp(a.face.scale.x || 1, a.flip, 0.25);
  }
  let shadowTex = null;
  function addShadow(root, w) {
    if (!shadowTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(20,14,8,.38)'); g.addColorStop(1, 'rgba(20,14,8,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); shadowTex = new T.CanvasTexture(c); }
    const s = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    s.scale.set(w * 1.3, 1, w * 0.45); s.position.y = 0.012; s.renderOrder = -1; root.add(s); root.userData.shadow = s;
  }

  // =====================================================================
  // ZIPLAYANLAR: tavşan, kar tavşanı, sincap
  // =====================================================================
  function makeHopper(kind, extra = {}) {
    seed = 77 + kind.length * 13 + Math.floor(Math.random() * 1000);
    const P = {
      rabbit: { pal: { base: '#9c7a5c', light: '#d0b08c', shadow: '#5e4634', belly: '#f2e8dc', line: '#3a2a1c' }, ear: 0.2, earIn: '#e9bcab', size: 0.6, tail: 'puff' },
      hare: { pal: { base: '#eeece8', light: '#ffffff', shadow: '#b8bcc4', belly: '#ffffff', line: '#6a6e78' }, ear: 0.22, earIn: '#e9c6be', earTip: '#2a2420', size: 0.65, tail: 'puff' },
      squirrel: { pal: { base: '#b4542a', light: '#e08a52', shadow: '#6a2e14', belly: '#f3e4d0', line: '#3a1a0a' }, ear: 0.06, earIn: '#e09a6a', size: 0.5, tail: 'bushy' },
    }[kind];
    const root = new T.Group(), face = new T.Group(); root.add(face);
    const rig = new T.Group(); rig.scale.setScalar(P.size); face.add(rig);
    const body = new T.Group(); rig.add(body);
    const pal = P.pal, sq = kind === 'squirrel';
    // arka bacak (uyluk + uzun ayak), ön pati
    const hind = makeLayer({ pts: [[-0.17, 0.2], [-0.08, 0.24], [0.0, 0.17], [0.02, 0.06], [0.08, 0.02], [0.1, -0.005], [-0.12, -0.005], [-0.2, 0.06]], pal, o: { fur: 1, furDir: -1 } }, [-0.08, 0.14], 0.02);
    const fore = makeLayer({ pts: limbPts([[0.12, 0.16, 0.05], [0.14, 0.07, 0.035], [0.17, 0.005, 0.035]]), pal, o: { fur: 0.6 } }, [0.12, 0.16], 0.015);
    const torso = makeLayer({ pts: sq ? [[-0.16, 0.12], [-0.12, 0.24], [0.0, 0.29], [0.12, 0.26], [0.18, 0.16], [0.12, 0.05], [-0.02, 0.03], [-0.15, 0.05]] : [[-0.22, 0.14], [-0.16, 0.27], [-0.02, 0.31], [0.12, 0.27], [0.18, 0.17], [0.12, 0.06], [-0.04, 0.03], [-0.2, 0.06]], pal, o: { bellyY: 0.1, fur: 1.2, furDir: Math.PI * 0.95 } }, [0, 0.15], 0);
    const Hc = sq ? [0.2, 0.3] : [0.2, 0.3], hr = sq ? 0.075 : 0.085;
    const head = makeLayer({
      pts: [[Hc[0] - hr, Hc[1] + hr * 0.1], [Hc[0] - hr * 0.5, Hc[1] + hr * 0.95], [Hc[0] + hr * 0.4, Hc[1] + hr * 0.85], [Hc[0] + hr * 1.25, Hc[1] + hr * 0.05], [Hc[0] + hr * 1.3, Hc[1] - hr * 0.3], [Hc[0] + hr * 0.6, Hc[1] - hr * 0.75], [Hc[0] - hr * 0.3, Hc[1] - hr * 0.8], [Hc[0] - hr * 0.9, Hc[1] - hr * 0.4]],
      pal, o: { bellyY: Hc[1] - hr * 0.35, fur: 0.9, furDir: Math.PI },
      extra: both(eyeDraw(Hc[0] + hr * 0.35, Hc[1] + hr * 0.2, hr * 0.17), dot(Hc[0] + hr * 1.25, Hc[1] - hr * 0.15, hr * 0.11, sq ? '#2a1a12' : '#c98378'),
        (ctx) => { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1 / PX; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(Hc[0] + hr * 1.15, Hc[1] - hr * 0.25); ctx.lineTo(Hc[0] + hr * 1.75, Hc[1] - hr * (0.05 + k * 0.17)); ctx.stroke(); } },
        extra.acorn ? (ctx) => {   // ağzında meşe palamudu
          const ax = Hc[0] + hr * 1.35, ay = Hc[1] - hr * 0.75;
          ctx.fillStyle = '#a8742e'; ctx.beginPath(); ctx.ellipse(ax, ay - hr * 0.15, hr * 0.32, hr * 0.42, 0.2, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,230,180,.5)'; ctx.beginPath(); ctx.ellipse(ax - hr * 0.08, ay - hr * 0.05, hr * 0.08, hr * 0.16, 0.2, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#6a4a22'; ctx.beginPath(); ctx.ellipse(ax + hr * 0.04, ay + hr * 0.2, hr * 0.36, hr * 0.17, 0.2, 0, 6.283); ctx.fill();
          ctx.strokeStyle = '#4a3216'; ctx.lineWidth = 2 / PX; ctx.beginPath(); ctx.moveTo(ax + hr * 0.08, ay + hr * 0.33); ctx.lineTo(ax + hr * 0.12, ay + hr * 0.48); ctx.stroke(); } : null),
    }, [Hc[0] - hr * 0.6, Hc[1] - hr * 0.5], 0.01);
    const ears = [];
    for (const far of [true, false]) {
      const b = [Hc[0] - hr * (far ? 0.35 : 0.15), Hc[1] + hr * 0.75];
      const pts = sq ? limbPts([[b[0], b[1], 0.04], [b[0] - 0.005, b[1] + P.ear * 0.6, 0.035], [b[0] - 0.01, b[1] + P.ear, 0.008]]) : limbPts([[b[0], b[1], 0.045], [b[0] - 0.04, b[1] + P.ear * 0.5, 0.055], [b[0] - 0.07, b[1] + P.ear, 0.02]]);
      const ear = makeLayer({ pts, pal: far ? { ...pal, base: shadeHex(pal.base, -0.08).getStyle() } : pal, o: { fur: 0.4,
        tip: P.earTip ? { grad: (ctx) => { const gg = ctx.createLinearGradient(0, b[1] + P.ear * 0.75, 0, b[1] + P.ear); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, P.earTip); return gg; } } : null },
        extra: (ctx) => { ctx.fillStyle = css(C(P.earIn), 0.8); ctx.beginPath(); ctx.ellipse(b[0] - (sq ? 0.004 : 0.035), b[1] + P.ear * 0.45, sq ? 0.012 : 0.016, P.ear * 0.32, sq ? 0 : 0.3, 0, 6.283); ctx.fill(); } }, b, far ? -0.004 : 0.006);
      ear.position.set(b[0] - (Hc[0] - hr * 0.6), b[1] - (Hc[1] - hr * 0.5), far ? -0.012 : 0.004);
      head.add(ear); ears.push(ear);
    }
    let tail;
    if (P.tail === 'puff') tail = makeLayer({ pts: [[-0.27, 0.2], [-0.22, 0.26], [-0.17, 0.22], [-0.19, 0.15], [-0.25, 0.14]], pal: { base: '#f6f2ec', light: '#ffffff', shadow: '#cfc8be', line: '#8a7a6a' }, o: { fur: 1.5 } }, [-0.2, 0.2], -0.01);
    else tail = makeLayer({ pts: limbPts([[-0.14, 0.12, 0.08], [-0.27, 0.2, 0.15], [-0.28, 0.38, 0.17], [-0.18, 0.52, 0.14], [-0.08, 0.5, 0.06]]), pal: { base: '#a8502a', light: '#e2a070', shadow: '#5e2810', line: '#3a1a0a' }, o: { fur: 2.2, furLen: 1.6, furDir: 1.6 } }, [-0.14, 0.12], -0.01);
    body.add(tail, hind, torso, fore, head);
    addShadow(root, 0.35 * P.size);
    const a = { kind, root, face, rig, body, head, ears, tail, hind, fore, hop: 0, sit: 0, flip: 1, earT: 2 };
    a.animate = (dt, t, speed, look) => {
      billboard(a);
      if (speed > 0.02 || a.hop > 0) { a.hop += dt * (speed > 0.6 ? 3.4 : 2.4); if (a.hop >= 1) a.hop = speed > 0.02 ? a.hop - 1 : 0; }
      const arc = Math.sin(a.hop * Math.PI);
      body.position.y = arc * 0.16;
      body.rotation.z = (a.hop < 0.5 ? 0.3 : -0.25) * arc;
      hind.rotation.z = -arc * 0.7; fore.rotation.z = arc * 0.5;
      a.sit = lerp(a.sit, look?.sit ? 1 : 0, 1 - Math.exp(-dt * 4));
      body.rotation.z += a.sit * (sq ? 0.75 : 0.35);
      head.rotation.z = -a.sit * (sq ? 0.6 : 0.25) + (look?.graze ? -0.25 + Math.sin(t * 10) * 0.05 : Math.sin(t * 1.1) * 0.03);
      a.br = (a.br || Math.random() * 6) + dt * (speed > 0.02 ? 3 : 2.2); torso.scale.y = 1 + Math.sin(a.br) * 0.025 * (1 - arc);
      head.rotation.z += look?.alert ? 0.25 : 0; head.position.y = (look?.alert ? 0.02 : 0) + Math.sin(a.br * 2.3) * 0.004;   // burun oynatma
      tail.rotation.z = Math.sin(t * 3.3) * (sq ? 0.14 : 0.05) - arc * 0.2;
      a.earT -= dt; if (a.earT < 0) a.earT = 1 + Math.random() * 3;
      ears.forEach((e, i) => (e.rotation.z = Math.sin(t * 1.7 + i * 2) * 0.05 + (a.earT < 0.3 && i ? Math.sin(a.earT * 30) * 0.2 : 0) - arc * 0.25));
    };
    return a;
  }

  // =====================================================================
  // KUŞLAR: ördek (+yavru), martı, kırlangıç, kaz, baykuş
  // =====================================================================
  function makeBird(kind) {
    seed = 301 + kind.length * 7 + Math.floor(Math.random() * 1000);
    const P = {
      duck: { pal: { base: '#8a6848', light: '#c4a07a', shadow: '#4e3824', belly: '#cbb08c', line: '#3a2818' }, bill: '#e0a13a', size: 0.55, swim: true, speculum: '#3b6ea8' },
      duckling: { pal: { base: '#d9b84a', light: '#fbe48a', shadow: '#9a7a22', belly: '#f8ea9a', line: '#6a5014' }, bill: '#d0822a', size: 0.32, swim: true, chick: true },
      gull: { pal: { base: '#eef0f0', light: '#ffffff', shadow: '#b8bec6', belly: '#ffffff', line: '#7a828a' }, wing: ['#aeb6c0', '#26262a'], bill: '#f0c040', size: 0.6, span: 0.62 },
      swallow: { pal: { base: '#283868', light: '#4a5c94', shadow: '#141c38', belly: '#f4ece0', line: '#0c1020' }, wing: ['#283868', '#141c38'], bill: '#1a1a1a', size: 0.42, span: 0.36, fork: true },
      goose: { pal: { base: '#7a756c', light: '#aaa498', shadow: '#45413a', belly: '#e2dccf', line: '#2a2622' }, wing: ['#857e72', '#3a3632'], bill: '#2a2826', size: 0.6, span: 0.72, neck: true },
      robin: { pal: { base: '#8a6a4c', light: '#c09a70', shadow: '#4a3422', belly: '#f07040', line: '#2a1a10' }, wing: ['#8a6a4c', '#3a2818'], bill: '#2a2420', size: 0.27, span: 0.3 },
      owl: { pal: { base: '#8a6c50', light: '#c4a07a', shadow: '#4a3622', belly: '#eadcc6', line: '#2e2014' }, size: 0.4 },
      // kar baykuşu: beyaz tüy, seyrek koyu benekler, altın gözler (kovuğun büyülü modu)
      snowowl: { pal: { base: '#e9e8e3', light: '#ffffff', shadow: '#b6bac4', belly: '#fbfaf6', line: '#5a5a62' }, size: 0.4, eye: '#f2c418', spot: 'rgba(70,70,82,.55)' },
    }[kind];
    const root = new T.Group(), face = new T.Group(); root.add(face);
    const rig = new T.Group(); rig.scale.setScalar(P.size); face.add(rig);
    const body = new T.Group(); rig.add(body);
    const pal = P.pal, a = { kind, root, face, rig, body, flip: 1, blinkT: 2, dab: 0, yaw: 0 };
    if (kind === 'owl' || kind === 'snowowl') {   // önden: yumurta gövde, yüz diski, iri turuncu (kar baykuşunda altın) gözler
      const bodyL = makeLayer({ pts: [[0, 0.02], [0.17, 0.08], [0.21, 0.3], [0.15, 0.48], [0, 0.52], [-0.15, 0.48], [-0.21, 0.3], [-0.17, 0.08]], pal, o: { bellyY: 0.36, fur: 1.4, furDir: -1.57,
        spots: { n: P.spot ? 52 : 40, x0: -0.12, x1: 0.12, y0: 0.06, y1: P.spot ? 0.42 : 0.32, col: P.spot } } }, [0, 0.25], 0);
      const head = makeLayer({
        pts: [[-0.17, 0.5], [-0.2, 0.66], [-0.16, 0.8], [-0.08, 0.76], [0, 0.78], [0.08, 0.76], [0.16, 0.8], [0.2, 0.66], [0.17, 0.5], [0, 0.45]], pal, o: { fur: 1.2, furDir: -1.57 },
        extra: both((ctx) => { ctx.fillStyle = 'rgba(244,232,212,.95)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 0.075, 0.62, 0.075, 0.085, 0, 0, 6.283); ctx.fill(); } },
          eyeDraw(-0.072, 0.625, 0.04, P.eye || '#f0a020'), eyeDraw(0.078, 0.625, 0.04, P.eye || '#f0a020'),
          (ctx) => { ctx.fillStyle = '#4a3420'; ctx.beginPath(); ctx.moveTo(-0.018, 0.585); ctx.lineTo(0.018, 0.585); ctx.lineTo(0, 0.54); ctx.closePath(); ctx.fill(); }),
      }, [0, 0.5], 0.01);
      const lid = new T.Mesh(new T.PlaneGeometry(0.3, 0.1), new T.MeshBasicMaterial({ color: pal.base })); lid.position.set(0, 0.13, 0.002); lid.scale.y = 0.01; head.add(lid);
      const wings = [-1, 1].map((s) => makeLayer({ pts: [[s * 0.12, 0.42], [s * 0.22, 0.34], [s * 0.22, 0.12], [s * 0.15, 0.06], [s * 0.12, 0.2]], pal: { ...pal, base: shadeHex(pal.base, -0.06).getStyle() }, o: { fur: 1, furDir: -1.57 } }, [s * 0.15, 0.4], 0.005));
      const feet = makeLayer({ pts: [[-0.07, 0.03], [0.07, 0.03], [0.08, -0.01], [-0.08, -0.01]], pal: { base: '#c89a40', light: '#e8bc60', shadow: '#8a6420', line: '#5a3a10' } }, [0, 0.01], 0.012);
      body.add(bodyL, ...wings, feet, head);
      a.head = head;
      a.animate = (dt, t, speed, look) => {
        a.face.rotation.y = -a.root.rotation.y;
        a.yaw = lerp(a.yaw, look?.yaw || 0, 1 - Math.exp(-dt * 1.6));
        head.rotation.z = Math.sin(t * 0.7) * 0.06 + a.yaw * 0.12; head.scale.x = 1 - Math.min(0.25, Math.abs(a.yaw) * 0.08);
        a.blinkT -= dt; lid.scale.y = a.blinkT < 0.25 ? 1 : 0.01; if (a.blinkT < 0) a.blinkT = 3 + Math.random() * 3;
        const f = speed > 0.5 ? Math.sin(t * 14) * 0.9 : 0; wings[0].rotation.z = -f; wings[1].rotation.z = f;
        bodyL.scale.y = 1 + Math.sin(t * 1.5) * 0.01;
      };
      addShadow(root, 0.0001); return a;
    }
    // yan görünüş gövde (damla) + baş + gaga
    const len = P.swim ? 0.42 : 0.4, h = P.chick ? 0.16 : P.swim ? 0.15 : 0.1;
    const bodyPts = P.swim ? [[-0.22, 0.06], [-0.24, 0.12], [-0.1, 0.16], [0.08, 0.15], [0.2, 0.1], [0.2, 0.02], [0.05, -0.02], [-0.15, -0.01]]
      : [[-0.26, 0.02], [-0.12, 0.06], [0.06, 0.07], [0.18, 0.04], [0.2, -0.01], [0.06, -0.05], [-0.12, -0.04]];
    if (P.chick) bodyPts.splice(0, bodyPts.length, [-0.14, 0.05], [-0.12, 0.14], [0.02, 0.17], [0.13, 0.11], [0.12, 0.02], [0, -0.02], [-0.11, 0.0]);
    if (kind === 'robin') bodyPts.splice(0, bodyPts.length, [-0.2, 0.03], [-0.1, 0.12], [0.06, 0.15], [0.18, 0.09], [0.19, -0.03], [0.06, -0.1], [-0.1, -0.07]);   // tombul kızılgerdan
    const bodyL = makeLayer({ pts: bodyPts, pal, o: { bellyY: P.swim ? 0.05 : -0.01, fur: P.chick ? 2 : 1, furDir: Math.PI, furLen: P.chick ? 0.6 : 1 } }, [0, 0.05], 0);
    const Hc = P.chick ? [0.1, 0.2] : P.swim ? [0.2, 0.24] : P.neck ? [0.34, 0.12] : kind === 'robin' ? [0.2, 0.12] : [0.22, 0.05], hr = P.chick ? 0.075 : P.swim ? 0.065 : kind === 'robin' ? 0.075 : 0.05;
    const billLen = P.swim ? hr * 1.1 : P.neck ? hr * 1.0 : kind === 'swallow' ? hr * 0.6 : hr * 1.3;
    const headPts = [[Hc[0] - hr, Hc[1]], [Hc[0] - hr * 0.5, Hc[1] + hr * 0.9], [Hc[0] + hr * 0.5, Hc[1] + hr * 0.9], [Hc[0] + hr, Hc[1] + hr * 0.1], [Hc[0] + hr * 0.6, Hc[1] - hr * 0.8], [Hc[0] - hr * 0.4, Hc[1] - hr * 0.9]];
    if (P.swim && !P.chick) headPts.push([Hc[0] - hr * 0.4, Hc[1] - hr * 2.4], [Hc[0] - hr * 1.6, Hc[1] - hr * 2.4]);   // ördeğin boynu
    if (P.neck) headPts.push([Hc[0] - hr * 0.6, Hc[1] - hr * 0.5], [Hc[0] - 0.2, Hc[1] - 0.12], [Hc[0] - 0.22, Hc[1] - 0.05]);
    const head = makeLayer({
      pts: headPts, pal: P.neck ? { ...pal, base: '#2a2826', light: '#4a4642', shadow: '#141210' } : pal, o: { fur: 0.8, furDir: Math.PI },
      extra: both(eyeDraw(Hc[0] + hr * 0.3, Hc[1] + hr * 0.25, hr * 0.17),
        (ctx) => { ctx.fillStyle = P.bill; ctx.beginPath(); ctx.moveTo(Hc[0] + hr * 0.8, Hc[1] + hr * 0.25); ctx.quadraticCurveTo(Hc[0] + hr * 0.9 + billLen, Hc[1] + (P.swim ? hr * 0.05 : 0), Hc[0] + hr * 0.95 + billLen, Hc[1] - hr * 0.12);
          ctx.quadraticCurveTo(Hc[0] + hr + billLen * 0.5, Hc[1] - hr * 0.35, Hc[0] + hr * 0.75, Hc[1] - hr * 0.25); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(60,30,10,.5)'; ctx.lineWidth = 1.5 / PX; ctx.stroke();
          if (P.neck) { ctx.fillStyle = '#f2efe8'; ctx.beginPath(); ctx.ellipse(Hc[0] - hr * 0.1, Hc[1] - hr * 0.35, hr * 0.35, hr * 0.22, 0.3, 0, 6.283); ctx.fill(); } }),
      pad: billLen,
    }, P.swim ? [Hc[0] - hr * 1.2, Hc[1] - hr * 2] : [Hc[0] - hr * 0.8, Hc[1] - hr * 0.3], 0.01);
    body.add(bodyL, head); a.head = head;
    if (P.speculum) { const sp = makeLayer({ pts: [[-0.12, 0.08], [0.06, 0.12], [0.1, 0.08], [-0.02, 0.05], [-0.14, 0.06]], pal: { base: '#6e5236', light: '#9a7a56', shadow: '#3e2a18', line: '#2a1a10' }, o: { fur: 1.6, furDir: Math.PI },
      extra: (ctx) => { ctx.fillStyle = P.speculum; ctx.fillRect(-0.06, 0.07, 0.07, 0.018); } }, [0, 0.08], 0.006); body.add(sp); a.wingFold = sp; }
    // kanatlar: uçan kuşlarda omuzdan çırpar (arkadaki koyu)
    const wings = [];
    if (P.wing) {
      for (const far of [true, false]) {
        const sp = P.span, ch = 0.11;
        const pts = [[0.05, 0], [0.04, sp * 0.4], [-0.02, sp * 0.82], [-0.08, sp], [-0.12, sp * 0.86], [-0.1, sp * 0.45], [-0.09, 0.02]];
        const wl = makeLayer({ pts, pal: { base: far ? shadeHex(P.wing[0], -0.12).getStyle() : P.wing[0], light: shadeHex(P.wing[0], 0.12).getStyle(), shadow: P.wing[1], line: pal.line }, o: { fur: 1.2, furDir: Math.PI, furLen: 1.8 },
          extra: (ctx) => { const gg = ctx.createLinearGradient(0, sp * 0.55, 0, sp); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, P.wing[1]); ctx.fillStyle = gg; ctx.save(); ctx.clip(smoothPath(pts)); ctx.fillRect(-0.2, -0.05, 0.3, sp * 1.1); ctx.restore();
            ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.2 / PX; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.moveTo(0.02, sp * (0.35 + k * 0.08)); ctx.lineTo(-0.1, sp * (0.38 + k * 0.08)); ctx.stroke(); } } }, [0, 0], far ? -0.02 : 0.02);
        wl.position.set(0.02, 0.04, far ? -0.02 : 0.02); body.add(wl); wings.push({ g: wl, far });
      }
      const tailPts = P.fork ? [[-0.2, 0.02], [-0.42, 0.06], [-0.3, 0.0], [-0.42, -0.06], [-0.2, -0.02]] : [[-0.2, 0.02], [-0.36, 0.035], [-0.37, -0.02], [-0.2, -0.02]];
      body.add(makeLayer({ pts: tailPts, pal: { ...pal, base: P.wing[0] }, o: { fur: 0.8, furDir: Math.PI } }, [-0.2, 0], -0.005));
    } else if (P.swim) {
      body.add(makeLayer({ pts: [[-0.2, 0.08], [-0.3, 0.16], [-0.27, 0.07]], pal, o: { fur: 0.5 } }, [-0.2, 0.08], -0.004));
    }
    addShadow(root, P.swim ? 0.0001 : 0.0001);
    a.animate = (dt, t, speed, look) => {
      billboard(a);
      if (wings.length) {
        if (!look?.perch) wings.forEach((w) => (w.g.visible = true));
        const f = look?.glide ? Math.sin(t * 1.3) * 0.1 : Math.sin(t * (kind === 'swallow' ? 20 : kind === 'goose' ? 6 : 8) + (look?.ph || 0));
        wings.forEach((w) => { const k = look?.glide ? 0.12 + Math.sin(t * 1.3) * 0.05 : f; w.g.scale.y = Math.sign(k || 1) * Math.max(0.1, Math.abs(k)); w.g.rotation.z = (w.far ? 0.25 : -0.1) - k * 0.25; });
        body.rotation.z = lerp(body.rotation.z, (look?.pitch || 0) * 0.6, 0.1);
      }
      if (look?.perch && wings.length) {
        wings.forEach((w) => { w.g.visible = false; });
        const pk = Math.max(0, Math.sin(t * 1.7 + (look.ph || 0)) - 0.85) * 4;
        head.rotation.z = Math.sin(t * 0.9 + (look.ph || 0)) * 0.12 - pk * 0.35; body.rotation.z = 0.25 + Math.sin(t * 2.5) * 0.02 - pk * 0.1;
        body.position.y = Math.abs(Math.sin(t * 3.1 + (look.ph || 0))) * 0.006;
      }
      if (P.swim) {
        body.position.y = Math.sin(t * 2.2 + (look?.ph || 0)) * 0.006;
        a.dab = lerp(a.dab, look?.dab ? 1 : 0, 1 - Math.exp(-dt * 3));
        body.rotation.z = -a.dab * 1.0; head.rotation.z = Math.sin(t * 1.4 + (look?.ph || 0)) * 0.08 - a.dab * 0.3;
      }
    };
    return a;
  }

  // =====================================================================
  // HAREKET: gezinme, aile takibi, giriş ve çıkış
  // =====================================================================
  class Mover {
    constructor(animal, opts) {
      Object.assign(this, { a: animal, x: 0, z: 0, yaw: 0, speed: 0, state: 'idle', timer: 1, target: null, leader: null, offset: V(-0.8, 0, 0.4), opts });
      this.walk = opts.walk || 0.5; this.run = opts.run || 1.6; this.region = opts.region; this.done = false; this.look = {}; this.acc = 0; this.lookT = 2 + Math.random() * 4; this.alertT = 0; this.yawGoal = null; this.age = 0;
    }
    place(x, z, yaw = 0) { this.x = x; this.z = z; this.yaw = yaw; }
    pickTarget(r) {
      const R = this.region; let x, z, k = 0;
      do { x = lerp(R.x0, R.x1, r()); z = lerp(R.z0, R.z1, r()); k++; } while (k < 20 && Math.hypot(x / 1.3, z) < (R.avoid || 2.8));
      this.target = V(x, 0, z);
    }
    update(dt, t, r, ground) {
      const o = this.opts;
      this.timer -= dt; this.age += dt; let want = 0;
      this.look.graze = false; this.look.sit = false; this.look.alert = false;
      if (this.state === 'leave' || this.state === 'enter') {
        const d = Math.hypot(this.target.x - this.x, this.target.z - this.z);
        want = this.state === 'leave' ? this.run : this.walk * 1.4;
        if (d < 0.3) { if (this.state === 'leave') { this.done = true; want = 0; } else { this.state = 'idle'; this.timer = 1 + r() * 2; } }
      } else if (this.leader) {
        const L = this.leader, back = V(Math.cos(L.yaw), 0, -Math.sin(L.yaw)), side = V(back.z, 0, -back.x);
        const tx = L.x - back.x * Math.abs(this.offset.x) + side.x * this.offset.z, tz = L.z - back.z * Math.abs(this.offset.x) + side.z * this.offset.z;
        this.target = V(tx, 0, tz);
        const d = Math.hypot(tx - this.x, tz - this.z);
        if (this.state === 'play' && this.timer > 0) { this.target = V(L.x + Math.cos(t * 1.8 + this.offset.z * 3) * 0.9, 0, L.z + Math.sin(t * 1.8 + this.offset.z * 3) * 0.6); want = this.run * 0.6; }
        else {
          this.state = 'follow'; want = d > 1.0 ? this.run * 0.75 : d > 0.2 ? this.walk * (0.6 + d) : 0;
          if (want === 0) { this.look.graze = L.look.graze; this.look.sit = L.look.sit; if (o.playful && r() < dt * 0.06) { this.state = 'play'; this.timer = 3 + r() * 3; } }
        }
      } else {
        if (this.state === 'idle' || this.state === 'graze' || this.state === 'sit') {
          if (this.state === 'graze') this.look.graze = true;
          if (this.state === 'sit') this.look.sit = true;
          if (this.timer <= 0) { this.state = 'walk'; this.pickTarget(r); }
        }
        if (this.state === 'walk') {
          want = this.walk;
          if (Math.hypot(this.target.x - this.x, this.target.z - this.z) < 0.25) { const roll = r(); this.state = o.grazer && roll < 0.6 ? 'graze' : o.sitter && roll < 0.5 ? 'sit' : 'idle'; this.timer = 2 + r() * 5; }
        }
      }
      if (this.target && want > 0 && this.state !== 'leave') {   // varışa yaklaşırken yumuşak yavaşlama
        const dist = Math.hypot(this.target.x - this.x, this.target.z - this.z); want *= Math.max(0.3, smoothstep(clamp(dist / 1.1)));
      }
      if (want === 0) {   // canlı bekleme: ara sıra başını kaldırıp dinler ya da dönüp öbür yana bakar
        this.lookT -= dt;
        if (this.lookT < 0) { this.lookT = 2.5 + r() * 4.5; const roll = r(); if (roll < 0.3 && !this.leader) this.yawGoal = this.yaw + (r() < 0.5 ? -1 : 1) * (2.4 + r() * 0.8); else if (roll < 0.75) this.alertT = 1 + r() * 1.5; }
        if (this.alertT > 0 && !this.look.graze) { this.alertT -= dt; this.look.alert = true; }
        if (this.yawGoal !== null) { let dy = this.yawGoal - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; this.yaw += dy * (1 - Math.exp(-dt * 2.2)); if (Math.abs(dy) < 0.05) this.yawGoal = null; }
      } else this.yawGoal = null;
      if (this.target && want > 0) {
        const dx = this.target.x - this.x, dz = this.target.z - this.z, goal = Math.atan2(-dz, dx);
        let dy = goal - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * (1 - Math.exp(-dt * 3.2));
        if (Math.abs(dy) > 1.2) want *= 0.5;
      }
      // ikinci derece yumuşatma: hız S eğrisiyle artar ve azalır (ani kalkış/duruş yok)
      this.acc = lerp(this.acc, (want - this.speed) * 2.4, 1 - Math.exp(-dt * 4.5)); this.speed = Math.max(0, this.speed + this.acc * dt);
      this.x += Math.cos(this.yaw) * this.speed * dt; this.z -= Math.sin(this.yaw) * this.speed * dt;
      const A = this.a;
      A.root.position.set(this.x, ground(this.x, this.z), this.z); A.root.rotation.y = this.yaw;
      A.animate(dt, t, this.speed / (A.root.scale.x || 1), this.look);
    }
    leave(sideX) { this.leader = null; this.state = 'leave'; this.target = V(sideX, 0, this.z + (Math.random() - 0.5) * 2); }
    enterFrom(x, z, tx, tz) { this.place(x, z, Math.atan2(-(tz - z), tx - x)); this.state = this.leader ? 'follow' : 'enter'; this.target = V(tx, 0, tz); }
  }

  window.Fauna = { TINT, quad: makeQuad, hopper: makeHopper, bird: makeBird, Mover };
})();
