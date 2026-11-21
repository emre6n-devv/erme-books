// scene.js - kenar menünün altındaki animasyonlu mevsim sahnesi.
// Her mevsim kendi manzarası: kış = karlı dağ evi, ilkbahar = çiçekli çayır,
// yaz = gün batımında sahil, sonbahar = kızıl orman.
// Dışarıya tek bir şey açar: window.SeasonScene.set('kis' | 'ilkbahar' | 'yaz' | 'sonbahar')
(() => {
  const canvas = document.getElementById('sceneCanvas');
  const wrap = document.getElementById('sceneWrap');
  if (!canvas || !wrap) return;
  const ctx = canvas.getContext('2d');
  const pop = wrap.closest('.season-pop');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  let W = 0, H = 0, season = 'sonbahar', scene = null;

  // ---------- çizim yardımcıları ----------
  function vgrad(y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  }
  function sky(stops) { ctx.fillStyle = vgrad(0, H, stops); ctx.fillRect(0, 0, W, H); }
  function circle(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function glow(x, y, r, c) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function hill(baseY, amp, freq, off, fill) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 4; x += 4) ctx.lineTo(x, baseY + Math.sin(x * freq + off) * amp + Math.sin(x * freq * 2.3 + off * 1.7) * amp * 0.35);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  function twinkle(stars, t) {
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.55 * Math.abs(Math.sin(t * 0.0012 + s.p))})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }
  function makeStars(r, n, maxY) { return arr(n, () => ({ x: r() * W, y: r() * H * maxY, p: r() * 6, s: 0.5 + r() * 0.9 })); }

  // Düşen yaprak / taç yaprağı (sonbahar ve ilkbahar ortak)
  function newFlake(colors, size, from) {
    return {
      x: from ? from[0] + rand(-6, 6) : rand(-10, W), y: from ? from[1] + rand(-4, 4) : rand(-20, -4),
      s: rand(size[0], size[1]), rot: rand(0, TAU), vr: rand(-0.04, 0.04), vy: rand(0.25, 0.55),
      p: rand(0, TAU), c: pick(colors), landed: false, life: 1, delay: rand(0, 120),
    };
  }
  function stepFlake(f, t, wind, groundY, oval) {
    if (f.delay > 0) { f.delay--; return false; }
    if (f.landed) { f.life -= 0.005; return f.life <= 0; }
    f.y += f.vy + Math.sin(t * 0.002 + f.p) * 0.15;
    f.x += Math.sin(t * 0.0015 + f.p) * 0.45 + wind;
    f.rot += f.vr + Math.sin(t * 0.003 + f.p) * 0.02;
    if (f.y >= groundY + (f.p % 6)) f.landed = true;
    if (f.x > W + 8) return true;
    ctx.save(); ctx.globalAlpha = f.life; ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = f.c; ctx.beginPath();
    if (oval) ctx.ellipse(0, 0, f.s, f.s * 0.6, 0, 0, TAU);
    else { ctx.moveTo(0, -f.s); ctx.quadraticCurveTo(f.s * 0.8, 0, 0, f.s); ctx.quadraticCurveTo(-f.s * 0.8, 0, 0, -f.s); }
    ctx.fill(); ctx.restore();
    return false;
  }

  // ================= KIŞ: karlı dağlar, çam ağaçları, bacası tüten dağ evi =================
  const kis = {
    init() {
      const r = rng(11);
      this.stars = makeStars(r, 30, 0.45);
      this.valleyY = H * 0.62;
      this.peaks = [];
      let x = -20;
      while (x < W + 30) { const px = x + 22 + r() * 22; this.peaks.push([px, H * (0.24 + r() * 0.16)]); x = px + 8 + r() * 14; }
      this.groundY = H * 0.84;
      this.pines = [[0.08, 0.30], [0.19, 0.22], [0.3, 0.15], [0.76, 0.17], [0.86, 0.33], [0.96, 0.24]].map(([px, ph]) => ({ x: W * px, h: H * ph }));
      this.cabin = { x: W * 0.52, w: Math.min(42, W * 0.17) };
      this.snow = arr(65, () => ({ x: rand(0, W), y: rand(0, H), r: rand(0.6, 2), vy: rand(0.25, 0.65), p: rand(0, TAU) }));
      this.smoke = [];
    },
    mountains() {
      const v = this.valleyY, pts = [[-20, v]];
      this.peaks.forEach((p, i) => { pts.push(p); const n = this.peaks[i + 1]; pts.push([n ? (p[0] + n[0]) / 2 : W + 20, v - (n ? H * 0.06 : 0)]); });
      ctx.fillStyle = '#4b5c76'; ctx.beginPath(); ctx.moveTo(-20, H);
      pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(W + 20, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8eef7';
      for (let i = 1; i < pts.length - 1; i += 2) {
        const [px, py] = pts[i], [lx, ly] = pts[i - 1], [rx, ry] = pts[i + 1], f = 0.32;
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.lineTo(px + (lx - px) * f, py + (ly - py) * f);
        ctx.lineTo(px - 2, py + (ly - py) * f * 0.7);
        ctx.lineTo(px + 2, py + (ry - py) * f * 0.85);
        ctx.lineTo(px + (rx - px) * f, py + (ry - py) * f);
        ctx.closePath(); ctx.fill();
      }
    },
    pine(x, base, h) {
      ctx.fillStyle = '#2b1f18'; ctx.fillRect(x - 1.5, base - h * 0.12, 3, h * 0.14);
      for (let i = 0; i < 3; i++) {
        const top = base - h + i * h * 0.24, bot = top + h * 0.46, hw = h * (0.16 + i * 0.07);
        ctx.fillStyle = '#1c3531'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - hw, bot); ctx.lineTo(x + hw, bot); ctx.closePath(); ctx.fill();
        const sh = (bot - top) * 0.42, sw = hw * 0.42;
        ctx.fillStyle = 'rgba(238,244,251,0.92)'; ctx.beginPath(); ctx.moveTo(x, top);
        ctx.lineTo(x - sw, top + sh); ctx.lineTo(x - sw * 0.3, top + sh * 0.8); ctx.lineTo(x + sw * 0.2, top + sh * 1.05); ctx.lineTo(x + sw, top + sh);
        ctx.closePath(); ctx.fill();
      }
    },
    cabinDraw(t) {
      const { x, w } = this.cabin, h = w * 0.58, base = this.groundY - 2, top = base - h;
      glow(x - w * 0.18, base + 4, w * 0.8, 'rgba(255,190,100,0.18)');
      ctx.fillStyle = '#6b4630'; ctx.fillRect(x - w / 2, top, w, h);
      ctx.fillStyle = '#4a2f20'; for (let y = top + 4; y < base; y += 4) ctx.fillRect(x - w / 2, y, w, 0.8);
      const chx = x + w * 0.22;
      ctx.fillStyle = '#4a3a34'; ctx.fillRect(chx, top - h * 0.75, w * 0.12, h * 0.6);
      ctx.fillStyle = '#34261f'; ctx.beginPath(); ctx.moveTo(x - w * 0.62, top + 1); ctx.lineTo(x, top - h * 0.7); ctx.lineTo(x + w * 0.62, top + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eef3fa'; ctx.beginPath(); ctx.moveTo(x - w * 0.64, top + 1); ctx.lineTo(x, top - h * 0.74); ctx.lineTo(x + w * 0.64, top + 1);
      ctx.lineTo(x + w * 0.5, top - 1); ctx.lineTo(x, top - h * 0.52); ctx.lineTo(x - w * 0.5, top - 1); ctx.closePath(); ctx.fill();
      ctx.fillRect(chx - 1, top - h * 0.8, w * 0.12 + 2, 2.5);
      const flick = 0.82 + 0.18 * Math.sin(t * 0.009) * Math.sin(t * 0.0037);
      const wx = x - w * 0.3, wy = top + h * 0.28, ws = w * 0.2;
      glow(wx + ws / 2, wy + ws / 2, ws * 2.2, `rgba(255,200,110,${0.35 * flick})`);
      ctx.fillStyle = `rgba(255,205,120,${flick})`; ctx.fillRect(wx, wy, ws, ws);
      ctx.fillStyle = '#4a2f20'; ctx.fillRect(wx + ws / 2 - 0.5, wy, 1, ws); ctx.fillRect(wx, wy + ws / 2 - 0.5, ws, 1);
      ctx.fillStyle = '#3a2418'; ctx.fillRect(x + w * 0.05, base - h * 0.62, w * 0.18, h * 0.62);
      if (Math.random() < 0.06) this.smoke.push({ x: chx + w * 0.06, y: top - h * 0.8, r: 1.5, a: 0.45 });
      this.smoke = this.smoke.filter((s) => {
        s.y -= 0.22; s.x += 0.12 + Math.sin(s.y * 0.1) * 0.08; s.r += 0.035; s.a -= 0.0022;
        if (s.a <= 0) return false;
        circle(s.x, s.y, s.r, `rgba(210,218,230,${s.a})`); return true;
      });
    },
    draw(t) {
      sky(['#0a101b', '#1b273b', '#3b4c68']);
      twinkle(this.stars, t);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const a = 0.05 + 0.035 * Math.sin(t * 0.0008 + k * 2);
        [[14, a * 0.6], [7, a], [2.5, a * 1.6]].forEach(([lw, al]) => {
          ctx.strokeStyle = `rgba(${k === 1 ? '140,120,255' : '110,255,190'},${al})`; ctx.lineWidth = lw; ctx.beginPath();
          for (let x = 0; x <= W; x += 6) { const y = H * (0.13 + k * 0.05) + Math.sin(x * 0.022 + t * 0.0004 + k) * 7; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke();
        });
      }
      ctx.restore();
      glow(W * 0.82, H * 0.14, 30, 'rgba(225,235,250,0.22)'); circle(W * 0.82, H * 0.14, 7, '#eef3fa');
      this.mountains();
      hill(H * 0.7, 5, 0.02, 1, '#9fb1c8');
      hill(this.groundY, 3, 0.025, 2, '#dce5f0');
      this.cabinDraw(t);
      this.pines.forEach((p, i) => this.pine(p.x, this.groundY + (i % 2) * 3, p.h));
      hill(H * 0.93, 2, 0.03, 0.5, '#f2f6fb');
      for (const s of this.snow) {
        s.y += s.vy; s.x += Math.sin(t * 0.0009 + s.p) * 0.3 + 0.08;
        if (s.y > H) { s.y = -3; s.x = rand(0, W); }
        if (s.x > W + 3) s.x = -3;
        circle(s.x, s.y, s.r, 'rgba(255,255,255,0.88)');
      }
    },
  };

  // ================= İLKBAHAR: çayır, çiçek açmış ağaç, kelebekler, bulutlar =================
  function makeTree(r, depth, len, width) {
    const node = { len, width, angle: 0, kids: [], phase: r() * 6 };
    if (depth > 0) {
      const n = depth > 4 ? 2 : (r() < 0.6 ? 2 : 3);
      for (let i = 0; i < n; i++) {
        const k = makeTree(r, depth - 1, len * (0.7 + r() * 0.12), width * 0.68);
        k.angle = (i - (n - 1) / 2) * (0.34 + r() * 0.22) + (r() - 0.5) * 0.3;
        node.kids.push(k);
      }
    }
    return node;
  }
  function drawBranch(node, x, y, ang, depth, t, tips, color) {
    const a = ang + node.angle + Math.sin(t * 0.0011 + node.phase) * 0.016 * depth;
    const x2 = x + Math.sin(a) * node.len, y2 = y - Math.cos(a) * node.len;
    ctx.strokeStyle = color; ctx.lineWidth = node.width; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (depth >= 3) tips.push([x2, y2]);
    for (const k of node.kids) drawBranch(k, x2, y2, a, depth + 1, t, tips, color);
  }

  const ilkbahar = {
    init() {
      const r = rng(5);
      this.groundY = H * 0.8;
      this.tree = makeTree(r, 6, Math.min(H * 0.14, 30), Math.max(2.5, H * 0.024));
      this.blossom = arr(400, () => ({ r: 3.5 + r() * 4.5, dx: (r() - 0.5) * 6, dy: (r() - 0.5) * 6, c: Math.floor(r() * 4) }));
      this.clouds = arr(3, (i) => ({ x: r() * W, y: H * (0.1 + i * 0.09), s: 0.6 + r() * 0.5, v: 0.05 + r() * 0.06 }));
      this.flowers = arr(34, () => ({ x: r() * W, y: this.groundY + 4 + r() * (H - this.groundY - 6), h: 4 + r() * 7, c: ['#f7d64a', '#f59ab8', '#ffffff', '#b58cf0', '#ff8a65'][Math.floor(r() * 5)], p: r() * 6 }));
      this.flies = arr(3, (i) => ({ x: r() * W, y: H * (0.45 + i * 0.1), v: 0.25 + r() * 0.2, p: r() * 6, c: ['#ffd24a', '#8fd3ff', '#ff9fc4'][i] }));
      this.petals = arr(18, () => newFlake(['#f7c3d3', '#fbe4ec', '#e98fab'], [1.5, 2.4], null));
      this.tips = [];
    },
    cloud(c) {
      const s = c.s * 10;
      [[0, 0, 1], [1.1, 0.25, 0.8], [-1.1, 0.3, 0.75], [0.5, -0.45, 0.8], [-0.5, -0.35, 0.7]].forEach(([dx, dy, k]) =>
        circle(c.x + dx * s, c.y + dy * s, s * k, 'rgba(255,255,255,0.92)'));
    },
    draw(t) {
      sky(['#5c9ccc', '#a9d3e8', '#e6f3dc']);
      glow(W * 0.16, H * 0.17, 34, 'rgba(255,246,200,0.7)'); circle(W * 0.16, H * 0.17, 9, '#fff6cf');
      for (const c of this.clouds) { c.x += c.v; if (c.x - c.s * 25 > W) c.x = -c.s * 25; this.cloud(c); }
      hill(H * 0.6, 8, 0.015, 2, '#93c47a');
      hill(H * 0.7, 6, 0.02, 0.5, '#74ad5d');
      this.tips = []; ctx.lineCap = 'round';
      drawBranch(this.tree, W * 0.3, this.groundY + 2, 0, 0, t, this.tips, '#4a3428');
      const cols = ['#f6bfd0', '#ee9ab6', '#fde8ef', '#e27fa2'];
      this.tips.forEach(([x, y], i) => { const b = this.blossom[i % 400]; circle(x + b.dx, y + b.dy, b.r, cols[b.c]); });
      hill(this.groundY, 3, 0.03, 1, '#5e9c4c');
      for (const f of this.flowers) {
        const sw = Math.sin(t * 0.0018 + f.p) * 1.4;
        ctx.strokeStyle = '#3f7a35'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.quadraticCurveTo(f.x, f.y - f.h * 0.5, f.x + sw, f.y - f.h); ctx.stroke();
        circle(f.x + sw, f.y - f.h, 2, f.c); circle(f.x + sw, f.y - f.h, 0.7, '#f5b700');
      }
      for (const b of this.flies) {
        b.x += b.v; if (b.x > W + 10) { b.x = -10; b.y = rand(H * 0.4, H * 0.75); }
        const y = b.y + Math.sin(t * 0.002 + b.p) * 9, flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 0.018 + b.p));
        ctx.save(); ctx.translate(b.x, y); ctx.scale(flap, 1);
        ctx.fillStyle = b.c; ctx.beginPath(); ctx.ellipse(-2.6, -1, 2.8, 2.2, -0.3, 0, TAU); ctx.ellipse(2.6, -1, 2.8, 2.2, 0.3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-2, 1.8, 1.8, 1.4, 0.3, 0, TAU); ctx.ellipse(2, 1.8, 1.8, 1.4, -0.3, 0, TAU); ctx.fill();
        ctx.restore(); ctx.fillStyle = '#3a2a22'; ctx.fillRect(b.x - 0.5, y - 2.5, 1, 5);
      }
      this.petals.forEach((f, i) => {
        if (stepFlake(f, t, 0.35, this.groundY + 6, true)) this.petals[i] = newFlake(['#f7c3d3', '#fbe4ec', '#e98fab'], [1.5, 2.4], this.tips.length ? pick(this.tips) : null);
      });
    },
  };

  // ================= YAZ: gün batımında sahil, deniz, palmiye, yelkenli, martılar =================
  const yaz = {
    init() {
      const r = rng(9);
      this.hz = H * 0.52; this.shore = H * 0.76;
      this.sunX = W * 0.36;
      this.waves = arr(9, () => ({ x: r() * W, y: this.hz + 4 + r() * (this.shore - this.hz - 8), len: 6 + r() * 12, v: 0.05 + r() * 0.08 }));
      this.boat = { x: W * 0.62 };
      this.gulls = arr(3, (i) => ({ x: r() * W, y: H * (0.16 + i * 0.07), s: 3.5 + r() * 2, v: 0.18 + r() * 0.15, p: r() * 6 }));
      this.shells = arr(5, () => ({ x: r() * W * 0.6, y: this.shore + 12 + r() * (H - this.shore - 16) }));
    },
    palm(t) {
      const bx = W * 0.84, by = H * 0.97, tx = W * 0.74, ty = H * 0.42, cx = W * 0.9, cy = H * 0.65;
      const pt = (k) => [(1 - k) * (1 - k) * bx + 2 * (1 - k) * k * cx + k * k * tx, (1 - k) * (1 - k) * by + 2 * (1 - k) * k * cy + k * k * ty];
      for (let k = 0; k < 1; k += 0.05) {
        const [x1, y1] = pt(k), [x2, y2] = pt(k + 0.05);
        ctx.strokeStyle = k * 20 % 2 < 1 ? '#6a4a30' : '#57391f'; ctx.lineWidth = 5 - k * 2.2; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      const angles = [-2.6, -2.0, -1.3, -0.5, 0.2, 0.8];
      angles.forEach((a0, i) => {
        const a = a0 + Math.sin(t * 0.0015 + i) * 0.06, len = 24 + (i % 2) * 6;
        for (let k = 0; k <= 1; k += 0.08) {
          const d = len * k, droop = k * k * 10;
          const x = tx + Math.cos(a) * d, y = ty + Math.sin(a) * d + droop;
          const nx = -Math.sin(a), ny = Math.cos(a), w = (1 - k) * 4.5 + 0.8;
          ctx.strokeStyle = i % 2 ? '#2f5d2c' : '#3b6f33'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - nx * w, y - ny * w + 1.5); ctx.lineTo(x + nx * w, y + ny * w + 1.5); ctx.stroke();
        }
      });
      circle(tx - 1.5, ty + 3, 2.2, '#4a3320'); circle(tx + 2, ty + 4, 2.2, '#3e2a1a');
    },
    umbrella() {
      const x = W * 0.2, top = H * 0.73, base = H * 0.95, r = Math.min(20, W * 0.09);
      ctx.save(); ctx.translate(x, top); ctx.rotate(-0.18);
      ctx.strokeStyle = '#e9e1d2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, base - top); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#fbf1df' : '#e0574a'; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, Math.PI + (i * Math.PI) / 6, Math.PI + ((i + 1) * Math.PI) / 6); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#3f7fbf'; ctx.save(); ctx.translate(x + 12, H * 0.9); ctx.rotate(-0.08); ctx.fillRect(0, 0, 22, 7);
      ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 2.5, 22, 1.5); ctx.restore();
    },
    draw(t) {
      const hz = this.hz, sh = this.shore;
      ctx.fillStyle = vgrad(0, hz, ['#23305a', '#634878', '#e7856a', '#f8c67c']); ctx.fillRect(0, 0, W, hz);
      glow(this.sunX, hz - 3, 60, 'rgba(255,196,120,0.45)'); circle(this.sunX, hz - 3, 13, '#ffd98c');
      for (const g of this.gulls) {
        g.x += g.v; if (g.x > W + 10) { g.x = -10; g.y = rand(H * 0.12, H * 0.35); }
        const f = 0.2 + 0.7 * Math.abs(Math.sin(t * 0.006 + g.p)), y = g.y + Math.sin(t * 0.001 + g.p) * 3;
        ctx.strokeStyle = '#3a2a3e'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(g.x - g.s, y);
        ctx.quadraticCurveTo(g.x - g.s / 2, y - g.s * f, g.x, y); ctx.quadraticCurveTo(g.x + g.s / 2, y - g.s * f, g.x + g.s, y); ctx.stroke();
      }
      ctx.fillStyle = vgrad(hz, sh, ['#35557e', '#2c7894', '#37a0a6']); ctx.fillRect(0, hz, W, sh - hz + 6);
      for (let i = 0; i < 10; i++) {
        const y = hz + 2 + i * ((sh - hz - 6) / 10), w = (22 - i * 1.3) * (0.55 + 0.45 * Math.sin(t * 0.004 + i * 1.3));
        ctx.fillStyle = `rgba(255,212,140,${0.6 - i * 0.045})`; ctx.fillRect(this.sunX - w / 2 + Math.sin(t * 0.002 + i) * 2, y, w, 1.4);
      }
      for (const w of this.waves) {
        w.x += w.v; if (w.x > W + 20) w.x = -20;
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(w.x, w.y, w.len, 1);
      }
      this.boat.x += 0.06; if (this.boat.x > W + 15) this.boat.x = -15;
      const bx = this.boat.x;
      ctx.fillStyle = '#2b2233'; ctx.beginPath(); ctx.moveTo(bx - 7, hz + 1); ctx.lineTo(bx + 7, hz + 1); ctx.lineTo(bx + 5, hz + 4); ctx.lineTo(bx - 5, hz + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f6efe4'; ctx.beginPath(); ctx.moveTo(bx, hz - 12); ctx.lineTo(bx, hz); ctx.lineTo(bx - 7, hz); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + 1, hz - 9); ctx.lineTo(bx + 1, hz); ctx.lineTo(bx + 5, hz); ctx.closePath(); ctx.fill();
      const tide = Math.sin(t * 0.0011) * 3.5;
      const edge = (x) => sh + tide + Math.sin(x * 0.05 + t * 0.001) * 1.6;
      ctx.fillStyle = 'rgba(214,190,150,0.55)'; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 4; x += 4) ctx.lineTo(x, sh + 3 + Math.sin(x * 0.05) * 1.5); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = vgrad(sh, H, ['#efd3a1', '#d9b27c']); ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 4; x += 4) ctx.lineTo(x, edge(x)); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let x = 0; x <= W + 4; x += 4) x ? ctx.lineTo(x, edge(x) + 0.5) : ctx.moveTo(x, edge(x) + 0.5); ctx.stroke();
      for (const s of this.shells) circle(s.x, s.y, 1.3, '#fff3e6');
      this.umbrella();
      this.palm(t);
    },
  };

  // ================= SONBAHAR: kızıl orman, çit, balkabakları, sis, göçmen kuşlar =================
  const sonbahar = {
    init() {
      const r = rng(21);
      this.groundY = H * 0.8;
      this.farTrees = arr(Math.ceil(W / 9), (i) => ({ x: i * 9 + r() * 4, y: H * 0.6 + r() * 5, r: 6 + r() * 5, c: ['#8a5446', '#9b654b', '#7a4a42', '#a2704e'][Math.floor(r() * 4)] }));
      this.trees = [[0.08, 0.36], [0.24, 0.28], [0.62, 0.3], [0.8, 0.4], [0.95, 0.27]].map(([px, ph], i) => ({
        x: W * px, h: H * ph, p: r() * 6,
        blobs: arr(6, () => ({ dx: (r() - 0.5) * 1.1, dy: (r() - 0.5) * 0.8, k: 0.45 + r() * 0.3, c: ['#c2492e', '#d9722e', '#e3a33b', '#a33a24', '#e08a34'][Math.floor(r() * 5)] })),
      }));
      this.mist = arr(4, () => ({ x: r() * W, y: H * (0.56 + r() * 0.12), rx: 40 + r() * 30, v: 0.04 + r() * 0.05 }));
      this.geese = { x: -60, y: H * 0.2, wait: 120 };
      this.leaves = arr(20, () => newFlake(['#d9722e', '#c2492e', '#e3a33b', '#9c3b22', '#b8612a'], [2.6, 4], null));
      this.litter = arr(40, () => ({ x: r() * W, y: this.groundY + 4 + r() * (H - this.groundY - 4), c: ['#b8612a', '#9c3b22', '#d9722e', '#6b3a1e'][Math.floor(r() * 4)], a: r() * 3 }));
      this.crowns = [];
    },
    tree(tr, t) {
      const base = this.groundY + 2, crownY = base - tr.h * 0.72, rad = tr.h * 0.36, sway = Math.sin(t * 0.001 + tr.p) * 1.2;
      ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = Math.max(2, tr.h * 0.07); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tr.x, base); ctx.lineTo(tr.x + sway * 0.5, crownY + rad * 0.3); ctx.stroke();
      for (const b of tr.blobs) {
        const x = tr.x + b.dx * rad + sway, y = crownY + b.dy * rad;
        circle(x, y, rad * b.k, b.c); this.crowns.push([x, y]);
      }
    },
    pumpkin(x, y, s) {
      ctx.fillStyle = '#d8701f';
      [-0.55, 0.55, 0].forEach((dx) => { ctx.beginPath(); ctx.ellipse(x + dx * s, y, s * 0.62, s * 0.7, 0, 0, TAU); ctx.fill(); });
      ctx.strokeStyle = 'rgba(120,50,10,0.5)'; ctx.lineWidth = 0.8;
      [-0.3, 0.3].forEach((dx) => { ctx.beginPath(); ctx.moveTo(x + dx * s, y - s * 0.6); ctx.quadraticCurveTo(x + dx * s * 1.4, y, x + dx * s, y + s * 0.6); ctx.stroke(); });
      ctx.strokeStyle = '#4a6a2a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y - s * 0.65); ctx.lineTo(x + 1.5, y - s * 1.05); ctx.stroke();
    },
    draw(t) {
      sky(['#34283b', '#7a4a4d', '#dc9a5c']);
      glow(W * 0.76, H * 0.33, 45, 'rgba(250,200,130,0.4)'); circle(W * 0.76, H * 0.33, 10, '#f7cd8a');
      const g = this.geese;
      if (g.wait > 0) g.wait--; else {
        g.x += 0.35;
        for (let i = 0; i < 7; i++) {
          const side = i % 2 ? 1 : -1, row = Math.ceil(i / 2), x = g.x - row * 6, y = g.y + side * row * 3.5;
          const f = 0.3 + 0.6 * Math.abs(Math.sin(t * 0.008 + i));
          ctx.strokeStyle = '#2b1e24'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2.5, y);
          ctx.quadraticCurveTo(x - 1.2, y - 2.5 * f, x, y); ctx.quadraticCurveTo(x + 1.2, y - 2.5 * f, x + 2.5, y); ctx.stroke();
        }
        if (g.x - 30 > W) { g.x = -30; g.y = rand(H * 0.12, H * 0.3); g.wait = 400 + rand(0, 400); }
      }
      hill(H * 0.62, 4, 0.02, 1, '#6e4a3f');
      for (const ft of this.farTrees) circle(ft.x, ft.y, ft.r, ft.c);
      hill(H * 0.66, 3, 0.03, 2, '#5a3a2c');
      for (const m of this.mist) {
        m.x += m.v; if (m.x - m.rx > W) m.x = -m.rx;
        ctx.fillStyle = 'rgba(255,225,200,0.09)'; ctx.beginPath(); ctx.ellipse(m.x, m.y, m.rx, 7, 0, 0, TAU); ctx.fill();
      }
      this.crowns = [];
      this.trees.forEach((tr) => this.tree(tr, t));
      hill(this.groundY, 2.5, 0.03, 1, '#4d2f1b');
      for (const l of this.litter) { ctx.fillStyle = l.c; ctx.beginPath(); ctx.ellipse(l.x, l.y, 2, 1, l.a, 0, TAU); ctx.fill(); }
      const fy = H * 0.86, fend = W * 0.52;
      ctx.fillStyle = '#7a5537';
      for (let x = 4; x < fend; x += 16) ctx.fillRect(x, fy - 12, 3, 14);
      ctx.fillRect(0, fy - 9, fend, 2); ctx.fillRect(0, fy - 4, fend, 2);
      this.pumpkin(W * 0.66, H * 0.92, 6); this.pumpkin(W * 0.74, H * 0.94, 4.5);
      const wind = 0.15 + 0.35 * Math.max(0, Math.sin(t * 0.0005));
      this.leaves.forEach((f, i) => {
        if (stepFlake(f, t, wind, this.groundY + 4, false))
          this.leaves[i] = newFlake(['#d9722e', '#c2492e', '#e3a33b', '#9c3b22', '#b8612a'], [2.6, 4], Math.random() < 0.7 && this.crowns.length ? pick(this.crowns) : null);
      });
    },
  };

  const SCENES = { kis, ilkbahar, yaz, sonbahar };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene = SCENES[season]; scene.init();
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || !W || !H || !scene) return;
    if (pop && !pop.classList.contains('open')) return;   // mevsim menüsü kapalıyken çizme (görünmüyor)
    ctx.lineCap = 'round';
    scene.draw(t);
  }

  window.SeasonScene = {
    set(s) {
      if (!SCENES[s] || (s === season && scene)) return;
      const swap = () => { season = s; if (W && H) { scene = SCENES[s]; scene.init(); } canvas.classList.remove('fade'); };
      if (!scene) { swap(); return; }
      canvas.classList.add('fade');
      setTimeout(swap, 280);
    },
  };

  new ResizeObserver(resize).observe(wrap);
  resize();
  requestAnimationFrame(frame);
})();