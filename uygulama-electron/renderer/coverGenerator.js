// coverGenerator.js - ERME BOOKS bez ciltli (clothbound) kapak üretimi + 3D kapak stüdyosu.
// Tek parça yayılım (2048 x 1280): solda arka kapak, ortada sırt, sağda ön kapak.
//   window.CoverGen.render(spec, { mode }) -> { canvas, regions: { back:[x0,x1], spine:[x0,x1], front:[x0,x1] }, W, H }
//     mode: 'color' (görünür kapak) | 'rough' (pürüzlülük haritası) | 'metal' (varak maskesi)
//   window.CoverGen.build(spec) -> { color, rough, metal, regions, frontJpeg(), spreadJpeg() }
//   window.CoverGen.MOTIFS / CLOTHS / FOILS: seçenekler
//   window.CoverStudio.attach(canvas) -> { setCover(built), dispose() }
// spec: { title, author, blurb, motif, cloth, foil, cream, pages, variant }
(function () {
  const W = 2048, H = 1280;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const rng = (s) => () => ((s = (s * 16807 + 11) % 2147483647) / 2147483647);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  const SERIF = "'Cormorant Garamond', 'Playfair Display', 'Book Antiqua', Palatino, Georgia, 'Times New Roman', serif";

  // kumaş renkleri: klasik bez ciltler + kürasyonlu edebi tonlar
  const CLOTH_GROUPS = [
    ['Klasik bez ciltler', { bordo: ['#6B1D24', 'Bordo'], orman: ['#1E463A', 'Orman yeşili'], gece: ['#1A2238', 'Gece mavisi'], kehribar: ['#B5762A', 'Kehribar'], komur: ['#262626', 'Kömür siyahı'], krem: ['#E9DFC8', 'Krem'] }],
    ['Edebi tonlar', { lacivert: ['#1B365D', 'Lacivert'], kahve: ['#4E3423', 'Kahve'], murdum: ['#4A2545', 'Mürdüm'], petrol: ['#1F4E5A', 'Petrol'], hardal: ['#8A6A1E', 'Hardal'],
      antrasit: ['#2E3236', 'Antrasit'], kiremit: ['#8C3B22', 'Kiremit'], zeytin: ['#4F5A2A', 'Zeytin'], adacayi: ['#7C8F72', 'Adaçayı'], gul: ['#9C4A5A', 'Gül kurusu'],
      lavanta: ['#6E5C8A', 'Lavanta'], deniz: ['#2C6E7F', 'Deniz'], safran: ['#C08A1E', 'Safran'], tarcin: ['#7A3E1E', 'Tarçın'], sarap: ['#4E1420', 'Şarap'],
      mor: ['#3B2252', 'Mor'], ardic: ['#2F4A3F', 'Ardıç'], kul: ['#6B6B66', 'Kül'], pudra: ['#C9A0A0', 'Pudra'], gok: ['#5C7FA3', 'Gök'], buz: ['#A9BCC9', 'Buz'],
      kum: ['#CDB894', 'Kum'], fildisi: ['#F2EAD8', 'Fildişi'] }],
  ];
  const CLOTHS = {}; const CLOTH_NAMES = {};
  for (const [, g] of CLOTH_GROUPS) for (const [k, [hex, n]] of Object.entries(g)) { CLOTHS[k] = hex; CLOTH_NAMES[k] = n; }
  // varak ve baskı: metal olanlar 3D'de parlar
  const FOILS = { altin: { hex: '#D4AF37', metal: 1, name: 'Altın varak' }, gumus: { hex: '#C3C8CE', metal: 1, name: 'Gümüş varak' }, bakir: { hex: '#C07A4A', metal: 1, name: 'Bakır varak' },
    bronz: { hex: '#A8773A', metal: 1, name: 'Bronz varak' }, krem: { hex: '#EFE3C8', metal: 0, name: 'Mat krem baskı' }, siyah: { hex: '#1E1A18', metal: 0, name: 'Siyah mürekkep' } };
  const MOTIFS = {
    satranc: { name: 'Satranç', cat: 'Edebiyat' }, tuy: { name: 'Kalem & mürekkep', cat: 'Edebiyat' }, maske: { name: 'Sahne', cat: 'Edebiyat' },
    botanik: { name: 'Botanik', cat: 'Doğa' }, kus: { name: 'Kuşlar', cat: 'Doğa' }, gok: { name: 'Gökyüzü', cat: 'Doğa' },
    deniz: { name: 'Denizcilik', cat: 'Deniz & keşif' }, kesif: { name: 'Keşif & pusula', cat: 'Deniz & keşif' },
    gotik: { name: 'Gotik', cat: 'Gotik & gizem' }, anahtar: { name: 'Gizem & anahtar', cat: 'Gotik & gizem' },
    geometrik: { name: 'Geometrik rozet', cat: 'Geometrik' }, artdeco: { name: 'Art Deco', cat: 'Geometrik' }, minimal: { name: 'Minimal', cat: 'Geometrik' },
    masal: { name: 'Masal', cat: 'Masal & tarih' }, tarih: { name: 'Tarih & hanedan', cat: 'Masal & tarih' }, sark: { name: 'Şark & lale', cat: 'Masal & tarih' },
  };
  const MOTIF_NAMES = Object.fromEntries(Object.entries(MOTIFS).map(([k, v]) => [k, v.name]));
  const CARTS = { klasik: 'Klasik kartuş', oval: 'Oval madalyon', kemer: 'Kemer', rozet: 'Yuvarlak rozet', cerceve: 'İnce çerçeve' };
  const FONTS = {
    serif: { name: 'Klasik serif', family: SERIF, weight: 700, upper: true, sp: 3 },
    sans: { name: 'Modern sans', family: "'Gill Sans', 'Gill Sans MT', Futura, 'Century Gothic', 'Trebuchet MS', 'Segoe UI', sans-serif", weight: 600, upper: true, sp: 6 },
    kaligrafi: { name: 'El yazısı', family: "'Segoe Script', 'Lucida Calligraphy', 'Edwardian Script ITC', 'Brush Script MT', cursive", weight: 400, upper: false, sp: 0 },
    gotik: { name: 'Gotik', family: "'Old English Text MT', 'UnifrakturMaguntia', 'Engravers MT', 'Times New Roman', serif", weight: 400, upper: false, sp: 1 },
  };
  const TEXTURES = { keten: 'İnce keten', deri: 'Deri cilt', kagit: 'Mat kâğıt' };
  const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  // süs ve metin rengi önerisi: kumaşa en iyi okunan krem ya da koyu mürekkep
  function autoInk(cloth) {
    const cream = '#F4ECD8', dark = mix(cloth, '#000000', 0.8).replace(/rgb\((\d+),(\d+),(\d+)\)/, (_, r, g, b) => '#' + [r, g, b].map((v) => (+v).toString(16).padStart(2, '0')).join(''));
    const cc = contrast(cloth, cream), cd = contrast(cloth, dark);
    return cc >= cd ? { hex: cream, name: 'Krem', ratio: cc } : { hex: dark, name: 'Koyu mürekkep', ratio: cd };
  }

  // =====================================================================
  // İKONLAR: (-50..50) kutusunda dolu siluetler. cut: kumaş renginde iç detaylar.
  // =====================================================================
  const I = {};
  const P = (ctx, d) => ctx.fill(new Path2D(d));
  I.pawn = (c) => { c.beginPath(); c.arc(0, -26, 12, 0, 7); c.fill(); P(c, 'M-10 -14 L10 -14 L7 -9 L-7 -9 Z M-8 -9 C-6 6 -12 18 -18 26 L18 26 C12 18 6 6 8 -9 Z M-24 26 L24 26 L24 36 L-24 36 Z M-20 38 L20 38 L22 44 L-22 44 Z'); };
  I.rook = (c) => P(c, 'M-22 -44 L-12 -44 L-12 -36 L-5 -36 L-5 -44 L5 -44 L5 -36 L12 -36 L12 -44 L22 -44 L22 -26 L15 -20 L15 22 L22 28 L22 34 L-22 34 L-22 28 L-15 22 L-15 -20 L-22 -26 Z M-26 37 L26 37 L28 45 L-28 45 Z');
  I.bishop = (c) => { c.beginPath(); c.arc(0, -42, 5, 0, 7); c.fill(); P(c, 'M0 -37 C14 -26 16 -12 8 -2 L-8 -2 C-16 -12 -14 -26 0 -37 Z M-9 0 L9 0 L6 6 L-6 6 Z M-6 6 C-5 18 -10 26 -16 30 L16 30 C10 26 5 18 6 6 Z M-24 32 L24 32 L26 44 L-26 44 Z'); };
  I.bishopCut = (c) => { c.save(); c.rotate(-0.6); c.fillRect(-1.6, -32, 3.2, 14); c.restore(); };
  I.queen = (c) => { for (const x of [-20, -10, 0, 10, 20]) { c.beginPath(); c.arc(x, -40 + Math.abs(x) * 0.18, 4, 0, 7); c.fill(); }
    P(c, 'M-22 -34 L-14 -8 L-7 -30 L0 -6 L7 -30 L14 -8 L22 -34 L16 4 L-16 4 Z M-14 6 L14 6 C10 16 12 24 18 30 L-18 30 C-12 24 -10 16 -14 6 Z M-25 32 L25 32 L27 44 L-27 44 Z'); };
  I.king = (c) => P(c, 'M-3 -50 L3 -50 L3 -44 L9 -44 L9 -38 L3 -38 L3 -32 L-3 -32 L-3 -38 L-9 -38 L-9 -44 L-3 -44 Z M0 -30 C18 -30 22 -14 12 -2 L-12 -2 C-22 -14 -18 -30 0 -30 Z M-12 0 L12 0 L9 6 L-9 6 Z M-9 6 C-8 18 -12 25 -18 30 L18 30 C12 25 8 18 9 6 Z M-25 32 L25 32 L27 44 L-27 44 Z');
  I.knight = (c) => P(c, 'M-14 30 C-16 14 -10 4 -2 -4 C-8 -2 -16 2 -22 -2 C-28 -6 -26 -14 -20 -18 C-12 -26 -8 -36 0 -42 L2 -50 L8 -40 C22 -36 28 -18 26 4 C25 16 22 24 22 30 Z M-26 32 L26 32 L28 44 L-28 44 Z');
  I.knightCut = (c) => { c.beginPath(); c.arc(-2, -28, 3, 0, 7); c.fill(); };
  I.crown = (c) => { P(c, 'M-26 14 L-30 -16 L-16 -2 L-8 -24 L0 -6 L8 -24 L16 -2 L30 -16 L26 14 Z M-27 18 L27 18 L27 26 L-27 26 Z'); for (const [x, y] of [[-30, -19], [-8, -27], [8, -27], [30, -19]]) { c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); } };
  I.leaf = (c) => P(c, 'M0 -46 C26 -26 26 18 0 46 C-26 18 -26 -26 0 -46 Z');
  I.leafCut = (c) => { c.fillRect(-1.5, -34, 3, 72); for (let k = -2; k <= 2; k++) { c.save(); c.translate(0, k * 12); c.rotate(-0.7); c.fillRect(0, -1, 14, 2); c.restore(); c.save(); c.translate(0, k * 12); c.rotate(0.7 + Math.PI); c.fillRect(0, -1, 14, 2); c.restore(); } };
  I.sprig = (c) => { c.fillRect(-2, -40, 4, 86); for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { c.save(); c.translate(s * 3, -24 + k * 22 + (s > 0 ? 8 : 0)); c.scale(s, 1); c.rotate(0.85); c.translate(0, -16); c.scale(0.3, 0.36); I.leaf(c); c.restore(); } c.save(); c.translate(0, -42); c.scale(0.26, 0.3); I.leaf(c); c.restore(); };
  I.flower = (c) => { for (let k = 0; k < 5; k++) { c.save(); c.rotate((k / 5) * Math.PI * 2); c.beginPath(); c.ellipse(0, -22, 13, 20, 0, 0, 7); c.fill(); c.restore(); } };
  I.flowerCut = (c) => { c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill(); };
  I.acorn = (c) => { P(c, 'M-18 -6 C-18 24 -6 40 0 44 C6 40 18 24 18 -6 Z M-24 -6 C-24 -26 24 -26 24 -6 Z'); c.fillRect(-2, -34, 4, 12); };
  I.feather = (c) => { P(c, 'M14 -48 C30 -20 20 16 -10 34 L-6 18 L-16 22 C-4 4 0 -20 14 -48 Z'); c.save(); c.lineWidth = 3.5; c.strokeStyle = c.fillStyle; c.beginPath(); c.moveTo(-8, 28); c.quadraticCurveTo(-16, 38, -22, 48); c.stroke(); c.restore(); };
  I.featherCut = (c) => { c.save(); c.lineWidth = 2; c.strokeStyle = c.fillStyle; c.beginPath(); c.moveTo(12, -40); c.quadraticCurveTo(8, -6, -8, 26); c.stroke(); c.restore(); };
  I.inkpot = (c) => { P(c, 'M-22 0 C-22 -10 -14 -16 -10 -16 L-10 -24 L10 -24 L10 -16 C14 -16 22 -10 22 0 L22 30 L-22 30 Z M-14 -30 L14 -30 L14 -24 L-14 -24 Z'); };
  I.book = (c) => { P(c, 'M0 -18 C-14 -28 -30 -28 -44 -22 L-44 30 C-30 24 -14 24 0 34 C14 24 30 24 44 30 L44 -22 C30 -28 14 -28 0 -18 Z'); };
  I.bookCut = (c) => { c.fillRect(-1.5, -16, 3, 48); };
  I.anchor = (c) => { c.save(); c.lineWidth = 7; c.strokeStyle = c.fillStyle; c.lineCap = 'round';
    c.beginPath(); c.arc(0, -36, 8, 0, 7); c.stroke(); c.beginPath(); c.moveTo(0, -28); c.lineTo(0, 40); c.stroke(); c.beginPath(); c.moveTo(-18, -16); c.lineTo(18, -16); c.stroke();
    c.beginPath(); c.arc(0, 8, 32, 0.25, Math.PI - 0.25); c.stroke(); c.restore(); P(c, 'M-36 6 L-24 18 L-38 22 Z M36 6 L24 18 L38 22 Z'); };
  I.wave = (c) => { c.save(); c.lineWidth = 7; c.strokeStyle = c.fillStyle; c.lineCap = 'round'; for (const y of [-12, 10]) { c.beginPath(); for (let x = -44; x <= 44; x += 2) { const yy = y + Math.sin(x * 0.12) * 8; x === -44 ? c.moveTo(x, yy) : c.lineTo(x, yy); } c.stroke(); } c.restore(); };
  I.shell = (c) => { P(c, 'M0 38 L-36 -6 C-30 -36 30 -36 36 -6 Z M-10 38 L10 38 L6 46 L-6 46 Z'); };
  I.shellCut = (c) => { for (let k = -3; k <= 3; k++) { c.save(); c.translate(0, 36); c.rotate(k * 0.24); c.fillRect(-1.2, -62, 2.4, 52); c.restore(); } };
  I.wheel = (c) => { c.save(); c.lineWidth = 6; c.strokeStyle = c.fillStyle; c.beginPath(); c.arc(0, 0, 26, 0, 7); c.stroke(); c.lineCap = 'round';
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 42, Math.sin(a) * 42); c.stroke(); } c.restore(); c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill(); };
  I.star = (c) => { c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 18 : 44; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); };
  I.moon = (c) => { c.beginPath(); c.arc(0, 0, 40, 0.9, Math.PI * 2 - 0.9, false); c.arc(16, 0, 32, Math.PI * 2 - 1.2, 1.2, true); c.closePath(); c.fill(); };
  I.sun = (c) => { c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill(); for (let k = 0; k < 12; k++) { c.save(); c.rotate((k / 12) * Math.PI * 2); P(c, 'M-5 -26 L0 -46 L5 -26 Z'); c.restore(); } };
  I.sparkle = (c) => P(c, 'M0 -44 C4 -8 8 -4 44 0 C8 4 4 8 0 44 C-4 8 -8 4 -44 0 C-8 -4 -4 -8 0 -44 Z');
  I.rosette = (c) => { for (let k = 0; k < 8; k++) { c.save(); c.rotate((k / 8) * Math.PI * 2); c.beginPath(); c.ellipse(0, -24, 9, 20, 0, 0, 7); c.fill(); c.restore(); } c.beginPath(); c.arc(0, 0, 12, 0, 7); c.fill(); };
  I.rosetteCut = (c) => { c.beginPath(); c.arc(0, 0, 6, 0, 7); c.fill(); };
  I.diamond = (c) => P(c, 'M0 -44 L30 0 L0 44 L-30 0 Z');
  I.diamondCut = (c) => P(c, 'M0 -22 L14 0 L0 22 L-14 0 Z');
  I.quatrefoil = (c) => { for (const [x, y] of [[0, -20], [20, 0], [0, 20], [-20, 0]]) { c.beginPath(); c.arc(x, y, 20, 0, 7); c.fill(); } };
  I.quatrefoilCut = (c) => { c.beginPath(); c.arc(0, 0, 8, 0, 7); c.fill(); };
  I.fleur = (c) => P(c, 'M0 -46 C12 -32 12 -14 4 -2 L4 10 L-4 10 L-4 -2 C-12 -14 -12 -32 0 -46 Z M-4 -2 C-20 -6 -40 -20 -34 -34 C-24 -26 -14 -18 -6 6 Z M4 -2 C20 -6 40 -20 34 -34 C24 -26 14 -18 6 6 Z M-24 10 L24 10 L24 18 L-24 18 Z M-6 18 L6 18 L10 42 L-10 42 Z');
  I.bird = (c) => P(c, 'M-44 -6 C-30 -10 -18 -4 -8 2 C-4 -10 6 -18 18 -18 C26 -18 30 -14 32 -10 L44 -8 L32 -4 C30 8 22 20 4 26 L-10 40 L-8 24 C-24 22 -36 12 -44 -6 Z');
  I.birdCut = (c) => { c.beginPath(); c.arc(20, -11, 2.5, 0, 7); c.fill(); };
  I.key = (c) => { c.save(); c.lineWidth = 7; c.strokeStyle = c.fillStyle; c.beginPath(); c.arc(0, -30, 14, 0, 7); c.stroke(); c.restore(); c.fillRect(-3.5, -16, 7, 60); c.fillRect(0, 22, 14, 6); c.fillRect(0, 34, 18, 7); };
  I.keyhole = (c) => { c.beginPath(); c.arc(0, 0, 40, 0, 7); c.fill(); };
  I.keyholeCut = (c) => { c.beginPath(); c.arc(0, -8, 10, 0, 7); c.fill(); P(c, 'M-6 -2 L6 -2 L10 24 L-10 24 Z'); };
  I.candle = (c) => { P(c, 'M0 -46 C8 -36 8 -28 0 -22 C-8 -28 -8 -36 0 -46 Z'); c.fillRect(-1.5, -22, 3, 6); c.fillRect(-10, -16, 20, 46); P(c, 'M-24 30 L24 30 L20 40 L-20 40 Z'); };
  I.mask = (c) => P(c, 'M-36 -30 C-14 -38 14 -38 36 -30 C38 0 26 34 0 42 C-26 34 -38 0 -36 -30 Z');
  I.maskCut = (c) => { for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 15, -10, 9, 6, s * 0.3, 0, 7); c.fill(); } c.beginPath(); c.arc(0, 14, 12, 0.2, Math.PI - 0.2); c.lineWidth = 4; c.strokeStyle = c.fillStyle; c.stroke(); };
  I.rose = (c) => { c.beginPath(); c.arc(0, -10, 24, 0, 7); c.fill(); c.fillRect(-2.5, 12, 5, 34); c.save(); c.translate(10, 28); c.rotate(0.8); c.scale(0.3, 0.26); I.leaf(c); c.restore(); };
  I.roseCut = (c) => { c.lineWidth = 3; c.strokeStyle = c.fillStyle; c.beginPath(); c.arc(0, -10, 14, 0.3, 4.6); c.stroke(); c.beginPath(); c.arc(2, -10, 6, 3, 8); c.stroke(); };

  I.fan = (c) => P(c, 'M0 40 L-44 -14 A56 56 0 0 1 44 -14 Z');
  I.fanCut = (c) => { for (let k = -3; k <= 3; k++) { c.save(); c.translate(0, 40); c.rotate(k * 0.24); c.fillRect(-1.3, -50, 2.6, 44); c.restore(); } c.beginPath(); c.arc(0, 40, 10, 0, 7); c.fill(); };
  I.chevron = (c) => P(c, 'M-44 -10 L0 -40 L44 -10 L44 6 L0 -24 L-44 6 Z M-44 22 L0 -8 L44 22 L44 38 L0 8 L-44 38 Z');
  I.arch = (c) => P(c, 'M-28 46 L-28 -6 C-28 -28 -10 -40 0 -48 C10 -40 28 -28 28 -6 L28 46 Z');
  I.archCut = (c) => { P(c, 'M-18 40 L-18 -4 C-18 -18 -8 -28 0 -34 C8 -28 18 -18 18 -4 L18 40 Z'); c.fillStyle = c.fillStyle; };
  I.compassRose = (c) => { c.beginPath(); for (let k = 0; k < 16; k++) { const a = -Math.PI / 2 + (k / 16) * Math.PI * 2, r = k % 4 === 0 ? 48 : k % 2 === 0 ? 28 : 9; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); };
  I.compassRoseCut = (c) => { c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill(); };
  I.castle = (c) => P(c, 'M-38 46 L-38 -6 L-32 -6 L-32 -14 L-24 -14 L-24 -6 L-14 -6 L-14 -24 L-8 -24 L-8 -38 L0 -50 L8 -38 L8 -24 L14 -24 L14 -6 L24 -6 L24 -14 L32 -14 L32 -6 L38 -6 L38 46 Z');
  I.castleCut = (c) => { P(c, 'M-8 46 L-8 28 C-8 20 8 20 8 28 L8 46 Z'); c.fillRect(-2.5, -26, 5, 9); };
  I.tulip = (c) => { P(c, 'M0 8 C-22 2 -26 -24 -18 -44 C-10 -32 -6 -32 0 -46 C6 -32 10 -32 18 -44 C26 -24 22 2 0 8 Z'); c.fillRect(-2, 6, 4, 40); for (const s of [-1, 1]) { c.save(); c.translate(s * 2, 30); c.scale(s, 1); c.rotate(0.7); c.translate(0, -14); c.scale(0.22, 0.34); I.leaf(c); c.restore(); } };
  I.sword = (c) => { P(c, 'M-3.5 -48 L3.5 -48 L6 14 L-6 14 Z M-24 14 L24 14 L24 21 L-24 21 Z M-3.5 21 L3.5 21 L3.5 38 L-3.5 38 Z'); c.beginPath(); c.arc(0, 42, 6, 0, 7); c.fill(); };
  I.shield = (c) => P(c, 'M-32 -42 L32 -42 L32 -2 C32 22 14 38 0 46 C-14 38 -32 22 -32 -2 Z');
  I.shieldCut = (c) => P(c, 'M-4 -32 L4 -32 L4 -8 L22 -8 L22 0 L4 0 L4 32 L-4 32 L-4 0 L-22 0 L-22 -8 L-4 -8 Z');
  I.bat = (c) => P(c, 'M0 -10 C-8 -20 -20 -14 -24 -24 C-30 -10 -40 -12 -46 -2 C-36 0 -30 8 -28 18 C-22 8 -12 10 -6 16 L0 6 L6 16 C12 10 22 8 28 18 C30 8 36 0 46 -2 C40 -12 30 -10 24 -24 C20 -14 8 -20 0 -10 Z');

  // motif setleri: çerçevedeki ikonlar, köşe/ayraç ikonu, kenar şeridi biçimi
  const SETS = {
    satranc: { icons: ['king', 'knight', 'bishop', 'rook', 'queen', 'pawn'], sep: 'crown', corner: 'crown', strip: 'checker' },
    botanik: { icons: ['leaf', 'flower', 'sprig', 'acorn'], sep: 'flower', corner: 'rosette', strip: 'vine' },
    tuy: { icons: ['feather', 'inkpot', 'book', 'feather'], sep: 'diamond', corner: 'book', strip: 'beads' },
    deniz: { icons: ['anchor', 'shell', 'wheel', 'wave'], sep: 'star', corner: 'wheel', strip: 'waves' },
    gok: { icons: ['star', 'moon', 'sparkle', 'sun'], sep: 'sparkle', corner: 'sun', strip: 'stars' },
    geometrik: { icons: ['rosette', 'diamond', 'quatrefoil', 'fleur'], sep: 'diamond', corner: 'rosette', strip: 'checker' },
    kus: { icons: ['bird', 'feather', 'leaf', 'bird'], sep: 'leaf', corner: 'flower', strip: 'vine' },
    anahtar: { icons: ['key', 'keyhole', 'candle', 'key'], sep: 'diamond', corner: 'keyhole', strip: 'beads' },
    maske: { icons: ['mask', 'rose', 'star', 'mask'], sep: 'rose', corner: 'crown', strip: 'beads' },
    artdeco: { icons: ['fan', 'chevron', 'diamond', 'fan'], sep: 'diamond', corner: 'fan', strip: 'zigzag' },
    minimal: { icons: [], sep: 'diamond', corner: 'diamond', strip: 'line', minimal: true },
    gotik: { icons: ['arch', 'bat', 'candle', 'moon'], sep: 'diamond', corner: 'arch', strip: 'beads' },
    kesif: { icons: ['compassRose', 'anchor', 'star', 'wheel'], sep: 'star', corner: 'compassRose', strip: 'waves' },
    masal: { icons: ['castle', 'crown', 'star', 'flower'], sep: 'star', corner: 'crown', strip: 'stars' },
    tarih: { icons: ['sword', 'shield', 'crown', 'fleur'], sep: 'fleur', corner: 'shield', strip: 'checker' },
    sark: { icons: ['tulip', 'moon', 'rosette', 'tulip'], sep: 'star', corner: 'rosette', strip: 'beads' },
  };

  // =====================================================================
  // ÇİZİM
  // =====================================================================
  function render(spec, { mode = 'color', scale = 1 } = {}) {   // scale: EPUB kapağı için yüksek çözünürlük (çizim aynı, piksel k kat)
    const SC = scale, cv = mk(W * SC, H * SC), x = cv.getContext('2d');
    if (SC !== 1) x.setTransform(SC, 0, 0, SC, 0, 0);
    const S = SETS[spec.motif] || SETS.geometrik, r = rng(1 + (spec.variant || 0) * 7919);
    const cloth = /^#[0-9a-f]{6}$/i.test(spec.cloth || '') ? spec.cloth : CLOTHS[spec.cloth] || CLOTHS.bordo;
    const FO = FOILS[spec.foil] || (/^#[0-9a-f]{6}$/i.test(spec.foil || '') ? { hex: spec.foil, metal: 1 } : FOILS.altin), foilC = FO.hex;
    const light = lum(cloth) > 0.42, creamC = spec.ink || autoInk(cloth).hex;   // süs ve arka kapak metni
    const TEX = TEXTURES[spec.texture] ? spec.texture : 'keten', TF = FONTS[spec.font] || FONTS.serif, CS = CARTS[spec.cartouche] ? spec.cartouche : 'klasik';
    const color = mode === 'color';
    // haritalarda düz değerler: pürüzlülük (kumaş pürüzlü, varak parlak), varak maskesi (yalnız metal varak beyaz)
    const clothRough = { keten: '#f0f0f0', deri: '#8e8e8e', kagit: '#dadada' }[TEX];
    const PAL = color ? { cloth, cream: creamC, ink: light ? '#3a2e24' : mix(cloth, '#000000', 0.25), card: light ? '#FFFDF6' : '#F4ECD8', title: light ? '#2a2018' : mix(cloth, '#000000', 0.1) }
      : mode === 'rough' ? { cloth: clothRough, cream: '#b4b4b4', ink: '#c8c8c8', card: '#b4b4b4', title: '#c8c8c8', foil: FO.metal ? '#4a4a4a' : '#bcbcbc' }
        : { cloth: '#000000', cream: '#000000', ink: '#000000', card: '#000000', title: '#000000', foil: FO.metal ? '#ffffff' : '#000000' };
    const foil = (x0, y0, x1, y1) => {   // varak dolgusu: sıcak metalik geçiş (mat baskıda düz renk)
      if (!color) return PAL.foil;
      if (!FO.metal) return foilC;
      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, mix(foilC, '#5a3a10', 0.25)); g.addColorStop(0.35, mix(foilC, '#ffffff', 0.35)); g.addColorStop(0.55, foilC); g.addColorStop(1, mix(foilC, '#3a2408', 0.35));
      return g;
    };
    const pages = spec.pages || 220;
    const spineW = Math.round(spec.spineW ? clamp(spec.spineW, 90, 340) : clamp(70 + pages * 0.42, 110, 300));
    const coverW = Math.round((W - spineW) / 2), b0 = 0, b1 = coverW, s0 = b1, s1 = s0 + spineW, f0 = s1, f1 = W;
    // kumaş zemini
    x.fillStyle = PAL.cloth; x.fillRect(0, 0, W, H);
    if (color) { const g = x.createRadialGradient(W * 0.72, H * 0.4, 80, W * 0.6, H * 0.5, W * 0.75); g.addColorStop(0, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.16)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }

    // --- yardımcılar ---
    const icon = (name, cx, cy, size, fill, rot = 0) => {
      if (!I[name]) return;
      x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(size / 100, size / 100);
      if (color) { x.save(); x.translate(1.2 * 100 / size, 1.6 * 100 / size); x.fillStyle = 'rgba(0,0,0,.28)'; I[name](x); x.restore(); }   // baskı gölgesi
      x.fillStyle = fill; I[name](x);
      if (I[name + 'Cut']) { x.fillStyle = PAL.cloth; I[name + 'Cut'](x); }
      x.restore();
    };
    const iconFill = (k, y0) => (k % 2 ? PAL.cream : foil(0, y0 - 40, 0, y0 + 40));
    const rule = (x0, y0, x1, y1, w) => { x.fillStyle = foil(x0, y0, x1, y1 + 1); x.fillRect(x0, y0, x1 - x0, w ?? (y1 - y0)); };
    const frameRect = (x0, y0, x1, y1, lw) => { x.strokeStyle = foil(x0, y0, x1, y1); x.lineWidth = lw; x.strokeRect(x0, y0, x1 - x0, y1 - y0); };
    function strip(x0, y0, x1, y1, vertical) {   // kenar şeridi: dama, boncuk, dal, dalga, yıldız
      const L = vertical ? y1 - y0 : x1 - x0, T = vertical ? x1 - x0 : y1 - y0;
      if (S.strip === 'checker') {
        const n = 2, sq = T / n, cnt = Math.floor(L / sq);
        for (let i = 0; i < cnt; i++) for (let j = 0; j < n; j++) {
          if ((i + j) % 2) continue; const px = vertical ? x0 + j * sq : x0 + i * sq + (L - cnt * sq) / 2, py = vertical ? y0 + i * sq + (L - cnt * sq) / 2 : y0 + j * sq;
          x.fillStyle = foil(px, py, px + sq, py + sq); x.fillRect(px, py, sq, sq);
        }
      } else if (S.strip === 'beads' || S.strip === 'stars') {
        const step = T * 1.1, cnt = Math.floor(L / step);
        for (let i = 0; i < cnt; i++) { const t = (i + 0.5) * step + (L - cnt * step) / 2, cx = vertical ? x0 + T / 2 : x0 + t, cy = vertical ? y0 + t : y0 + T / 2;
          if (S.strip === 'stars' && i % 2 === 0) icon('star', cx, cy, T * 0.9, foil(cx, cy - T, cx, cy + T)); else { x.fillStyle = i % 2 ? PAL.cream : foil(cx - T, cy - T, cx + T, cy + T); x.beginPath(); x.arc(cx, cy, T * 0.26, 0, 7); x.fill(); } }
      } else if (S.strip === 'zigzag') {
        x.save(); x.strokeStyle = foil(x0, y0, x1, y1); x.lineWidth = T * 0.14; x.lineJoin = 'miter'; x.beginPath();
        const step = T * 0.8; for (let t = 0, k = 0; t <= L; t += step / 2, k++) { const w = (k % 2 ? 1 : -1) * T * 0.3, px = vertical ? x0 + T / 2 + w : x0 + t, py = vertical ? y0 + t : y0 + T / 2 + w; k ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke(); x.restore();
      } else if (S.strip === 'line') {
        x.fillStyle = foil(x0, y0, x1, y1);
        if (vertical) { x.fillRect(x0 + T * 0.3, y0, 2, L); x.fillRect(x0 + T * 0.62, y0, 1.2, L); } else { x.fillRect(x0, y0 + T * 0.3, L, 2); x.fillRect(x0, y0 + T * 0.62, L, 1.2); }
      } else if (S.strip === 'vine' || S.strip === 'waves') {
        x.save(); x.strokeStyle = foil(x0, y0, x1, y1); x.lineWidth = T * 0.12; x.beginPath();
        for (let t = 0; t <= L; t += 3) { const w = Math.sin(t / (T * 0.9)) * T * 0.28, px = vertical ? x0 + T / 2 + w : x0 + t, py = vertical ? y0 + t : y0 + T / 2 + w; t ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke(); x.restore();
        if (S.strip === 'vine') for (let t = T; t < L - T / 2; t += T * 1.4) { const w = Math.sin(t / (T * 0.9)), px = vertical ? x0 + T / 2 + w * T * 0.28 : x0 + t, py = vertical ? y0 + t : y0 + T / 2 + w * T * 0.28;
          x.save(); x.translate(px, py); x.rotate((vertical ? 0 : Math.PI / 2) + (w > 0 ? 0.9 : -0.9)); x.scale(T * 0.0042, T * 0.0042); x.fillStyle = PAL.cream; I.leaf(x); x.restore(); }
      }
    }
    function scroll(cx, cy, s, sx, sy) {   // varak kıvrımı (kartuş köşe süsü)
      x.save(); x.translate(cx, cy); x.scale(sx * s, sy * s); x.strokeStyle = foil(-60, -60, 60, 60); x.lineWidth = 3.2 / s; x.lineCap = 'round';
      x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(30, -4, 52, -22, 44, -42); x.bezierCurveTo(38, -56, 18, -50, 22, -36); x.bezierCurveTo(26, -26, 38, -32, 34, -40); x.stroke();
      x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(-4, 30, -22, 52, -42, 44); x.bezierCurveTo(-56, 38, -50, 18, -36, 22); x.bezierCurveTo(-26, 26, -32, 38, -40, 34); x.stroke();
      x.fillStyle = x.strokeStyle; x.beginPath(); x.arc(10, 10, 5, 0, 7); x.fill();
      x.beginPath(); x.moveTo(12, 12); x.quadraticCurveTo(30, 18, 40, 34); x.quadraticCurveTo(22, 30, 12, 12); x.fill();
      x.restore();
    }
    function flourishLine(cx, cy, w) {   // ince ayraç: iki yanda çizgi, ortada baklava
      x.fillStyle = foil(cx - w, cy - 6, cx + w, cy + 6);
      x.fillRect(cx - w, cy - 1, w - 16, 2); x.fillRect(cx + 16, cy - 1, w - 16, 2);
      x.beginPath(); x.moveTo(cx, cy - 8); x.lineTo(cx + 9, cy); x.lineTo(cx, cy + 8); x.lineTo(cx - 9, cy); x.closePath(); x.fill();
      for (const s of [-1, 1]) { x.beginPath(); x.arc(cx + s * 22, cy, 3, 0, 7); x.fill(); }
    }
    const spaced = (txt, px) => { try { x.letterSpacing = `${px}px`; } catch {} return txt; };
    const BODY = spec.font === 'sans' ? FONTS.sans.family : SERIF;   // yazar ve arka kapak metni
    function fitText(txt, maxW, size, weight = 600, italic = false, fam = BODY) {
      let fs = size; do { x.font = `${italic ? 'italic ' : ''}${weight} ${fs}px ${fam}`; fs -= 2; } while (x.measureText(txt).width > maxW && fs > 14); return fs + 2;
    }
    function wrap(txt, maxW) { const words = txt.split(/\s+/), lines = []; let ln = ''; for (const w of words) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > maxW && ln) { lines.push(ln); ln = w; } else ln = t; } if (ln) lines.push(ln); return lines; }

    // --- motif çerçevesi (ön ve arka kapakta) ---
    function border(X0, X1, simple) {
      const m = 34, band = 150, sw = 26, ix0 = X0 + m, ix1 = X1 - m, iy0 = m, iy1 = H - m;
      frameRect(ix0, iy0, ix1, iy1, 5); frameRect(ix0 + 10, iy0 + 10, ix1 - 10, iy1 - 10, 2);
      // dış şerit
      strip(ix0 + 18, iy0 + 18, ix1 - 18, iy0 + 18 + sw, false); strip(ix0 + 18, iy1 - 18 - sw, ix1 - 18, iy1 - 18, false);
      strip(ix0 + 18, iy0 + 18 + sw + 6, ix0 + 18 + sw, iy1 - 18 - sw - 6, true); strip(ix1 - 18 - sw, iy0 + 18 + sw + 6, ix1 - 18, iy1 - 18 - sw - 6, true);
      const bx0 = ix0 + 18 + sw + 8, bx1 = ix1 - 18 - sw - 8, by0 = iy0 + 18 + sw + 8, by1 = iy1 - 18 - sw - 8;
      frameRect(bx0 + band - 18, by0 + band - 18, bx1 - band + 18, by1 - band + 18, 3);
      if (S.minimal) {   // minimal: yalnız ince çizgiler ve köşelerde küçük baklavalar
        for (const [cx, cy] of [[bx0 + band - 18, by0 + band - 18], [bx1 - band + 18, by0 + band - 18], [bx0 + band - 18, by1 - band + 18], [bx1 - band + 18, by1 - band + 18]]) icon(S.corner, cx, cy, 30, foil(cx, cy - 20, cx, cy + 20));
        return { x0: bx0 + band, x1: bx1 - band, y0: by0 + band, y1: by1 - band };
      }
      // köşeler: çapraz çizgili kare + ikon
      const cs = band - 22;
      for (const [cx, cy] of [[bx0, by0], [bx1 - cs, by0], [bx0, by1 - cs], [bx1 - cs, by1 - cs]]) {
        x.save(); x.strokeStyle = foil(cx, cy, cx + cs, cy + cs); x.lineWidth = 2.5; x.strokeRect(cx + 4, cy + 4, cs - 8, cs - 8);
        x.beginPath(); x.moveTo(cx + 4, cy + 4); x.lineTo(cx + cs - 4, cy + cs - 4); x.moveTo(cx + cs - 4, cy + 4); x.lineTo(cx + 4, cy + cs - 4); x.stroke(); x.restore();
        x.fillStyle = PAL.cloth; x.beginPath(); x.arc(cx + cs / 2, cy + cs / 2, cs * 0.3, 0, 7); x.fill();
        icon(S.corner, cx + cs / 2, cy + cs / 2, cs * 0.46, PAL.cream);
      }
      // kenarlar boyunca ikonlar (sırayla krem / varak), aralarda küçük ayraç
      const placeRow = (ax, ay, bx, by, vertical) => {
        const L = vertical ? by - ay : bx - ax, cell = simple ? 118 : 96, n = Math.max(1, Math.floor(L / cell)), step = L / n;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * step, cx = vertical ? ax : ax + t, cy = vertical ? ay + t : ay;
          const k = (i + (spec.variant || 0)) % S.icons.length, nm = simple && i % 2 ? S.sep : S.icons[k];
          icon(nm, cx, cy, simple && i % 2 ? 40 : 74, iconFill(i + (vertical ? 1 : 0), cy));
          if (!simple && i < n - 1) icon(S.sep, vertical ? cx : cx + step / 2, vertical ? cy + step / 2 : cy, 22, foil(cx, cy - 20, cx, cy + 20));
        }
      };
      const mid = band / 2 - 4;
      placeRow(bx0 + cs + 6, by0 + mid, bx1 - cs - 6, by0 + mid, false); placeRow(bx0 + cs + 6, by1 - mid, bx1 - cs - 6, by1 - mid, false);
      placeRow(bx0 + mid, by0 + cs + 6, bx0 + mid, by1 - cs - 6, true); placeRow(bx1 - mid, by0 + cs + 6, bx1 - mid, by1 - cs - 6, true);
      return { x0: bx0 + band, x1: bx1 - band, y0: by0 + band, y1: by1 - band };
    }

    // ===== ÖN KAPAK =====
    const F = border(f0, f1, false), fcx = (F.x0 + F.x1) / 2, fcy = (F.y0 + F.y1) / 2;
    const up = (t) => (/[ğşıİçöüĞŞÇÖÜ]/.test(t) ? t.toLocaleUpperCase('tr-TR') : t.toUpperCase());   // yabancı adlarda i → I (ZWEIG), Türkçede i → İ
    const author = up(spec.author || ''), rawTitle = (spec.title || 'ERME BOOKS').trim(), title = TF.upper ? up(rawTitle) : rawTitle;
    let cw = Math.min(F.x1 - F.x0 - 70, 560);
    if (CS === 'rozet') cw = Math.min(F.x1 - F.x0 - 40, 520);
    const tw = CS === 'rozet' || CS === 'oval' ? cw * 0.7 : cw - 100;   // başlığın sığacağı genişlik
    const TFONT = (fs) => `${TF.weight} ${fs}px ${TF.family}`;
    spaced('', TF.sp); x.font = TFONT(92);
    let tLines = [title];
    if (x.measureText(title).width > tw && title.includes(' ')) {   // uzun başlık: 2-3 satıra böl
      for (const fs of [74, 64, 56, 50]) { x.font = TFONT(fs); tLines = wrap(title, tw); if (tLines.length <= 3) break; }
      if (tLines.length > 3) tLines = [tLines.slice(0, 2).join(' '), tLines.slice(2).join(' ')];
    }
    const base = 300 + (tLines.length - 1) * 66;
    const ch = CS === 'rozet' ? cw : CS === 'kemer' ? base + cw * 0.32 : CS === 'oval' ? base + 70 : base;
    const cx0 = fcx - cw / 2, cy0 = fcy - ch / 2 - 20;
    const off = CS === 'kemer' ? cw * 0.32 : CS === 'oval' ? 35 : CS === 'rozet' ? (ch - base) / 2 : 0;   // metin bloğunun kartuş içindeki kayması
    // süsler: kartuş biçimine göre
    if (CS === 'rozet') { for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; icon(S.sep, fcx + Math.cos(a) * (cw / 2 + 34), cy0 + ch / 2 + Math.sin(a) * (cw / 2 + 34), 26, foil(0, cy0, 0, cy0 + ch)); } }
    else {
      const sc = CS === 'kemer' ? [[-1, 1], [1, 1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sy] of sc) scroll(fcx + sx * (cw / 2 + 4), cy0 + ch / 2 + sy * (ch / 2 + 4), 1.05, sx, sy);
      icon(S.sep, fcx, cy0 - 70, 52, foil(fcx, cy0 - 100, fcx, cy0 - 40)); icon(S.sep, fcx, cy0 + ch + 70, 52, foil(fcx, cy0 + ch + 40, fcx, cy0 + ch + 100));
    }
    const cart = (inset) => {
      const a0 = cx0 + inset, a1 = cx0 + cw - inset, c0 = cy0 + inset, c1 = cy0 + ch - inset; x.beginPath();
      if (CS === 'oval') x.ellipse(fcx, cy0 + ch / 2, cw / 2 - inset, ch / 2 - inset, 0, 0, Math.PI * 2);
      else if (CS === 'rozet') x.arc(fcx, cy0 + ch / 2, cw / 2 - inset, 0, Math.PI * 2);
      else if (CS === 'kemer') { const R = cw / 2 - inset; x.moveTo(a0, c1); x.lineTo(a0, c0 + R); x.arc(fcx, c0 + R, R, Math.PI, 0); x.lineTo(a1, c1); x.closePath(); }
      else if (CS === 'cerceve') x.rect(a0, c0, a1 - a0, c1 - c0);
      else { const r = 34 - inset * 0.4; x.moveTo(a0 + r, c0); x.lineTo(a1 - r, c0); x.arc(a1, c0, r, Math.PI, Math.PI / 2, true); x.lineTo(a1, c1 - r); x.arc(a1, c1, r, -Math.PI / 2, Math.PI, true);
        x.lineTo(a0 + r, c1); x.arc(a0, c1, r, 0, -Math.PI / 2, true); x.lineTo(a0, c0 + r); x.arc(a0, c0, r, Math.PI / 2, 0, true); x.closePath(); }
    };
    const filled = CS !== 'cerceve';
    if (filled) {
      if (color) { x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 18; x.shadowOffsetY = 6; cart(0); x.fillStyle = PAL.card; x.fill(); x.restore(); }
      cart(0); x.fillStyle = PAL.card; x.fill();
      if (color) { const g = x.createLinearGradient(cx0, cy0, cx0 + cw, cy0 + ch); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(120,90,50,.12)'); x.fillStyle = g; cart(0); x.fill(); }
    }
    cart(filled ? 12 : 0); x.strokeStyle = foil(cx0, cy0, cx0 + cw, cy0 + ch); x.lineWidth = 3; x.stroke();
    cart(filled ? 20 : 10); x.lineWidth = 1.5; x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const ay = cy0 + 72 + off;
    x.fillStyle = filled ? PAL.ink : PAL.cream; spaced('', 4); fitText(author, Math.min(tw, cw - 120), 34, 600); x.fillText(author, fcx, ay);
    flourishLine(fcx, ay + 36, CS === 'rozet' ? 60 : 90);
    x.fillStyle = filled ? PAL.title : foil(fcx - cw / 2, cy0, fcx + cw / 2, cy0 + ch); spaced('', TF.sp);
    const fsT = Math.min(...tLines.map((l) => fitText(l, tw, tLines.length > 1 ? 68 : TF.upper ? 92 : 100, TF.weight, false, TF.family)));
    x.font = TFONT(fsT);
    const tTop = ay + 58, tBot = cy0 + ch - 60 - (CS === 'rozet' ? off : CS === 'oval' ? 30 : 0), lh = fsT * (TF.upper ? 1.0 : 1.08);
    tLines.forEach((l, i) => x.fillText(l, fcx, (tTop + tBot) / 2 - ((tLines.length - 1) * lh) / 2 + i * lh + 4));
    flourishLine(fcx, tBot + 16, 60);
    spaced('', 6); x.font = `600 30px ${SERIF}`; x.fillStyle = foil(fcx - 120, F.y1 - 50, fcx + 120, F.y1 - 10); x.fillText('ERME BOOKS', fcx, F.y1 - 34);

    // ===== SIRT =====
    const scx = (s0 + s1) / 2;
    strip(s0 + 18, 26, s1 - 18, 26 + 30, false); strip(s0 + 18, H - 56, s1 - 18, H - 26, false);
    for (const y of [76, 88, H - 96, H - 84]) rule(s0 + 14, y, s1 - 14, y + 4);
    // Hayat Ağacı amblemi
    { const ty = 170, s = Math.min(1, spineW / 160); x.save(); x.translate(scx, ty); x.scale(s, s); x.fillStyle = foil(-50, -50, 50, 50);
      x.fillRect(-4, -4, 8, 44); for (const [a, l] of [[-0.6, 28], [0.6, 28], [-1.2, 22], [1.2, 22]]) { x.save(); x.translate(0, 14); x.rotate(a); x.fillRect(-2, -l, 4, l); x.restore(); }
      for (let k = 0; k < 11; k++) { const a = -Math.PI / 2 + (k - 5) * 0.28, rr = 28 + (k % 2) * 6; x.beginPath(); x.arc(Math.cos(a) * rr * 1.1, -6 + Math.sin(a) * rr * 0.9, 10, 0, 7); x.fill(); }
      x.beginPath(); x.arc(0, -16, 24, 0, 7); x.fill();
      x.fillStyle = PAL.cloth; x.fillRect(-1.5, -18, 3, 22);
      x.fillStyle = foil(-50, 30, 50, 50); for (const s2 of [-1, 1]) { x.beginPath(); x.moveTo(0, 38); x.quadraticCurveTo(s2 * 14, 40, s2 * 26, 48); x.lineTo(s2 * 22, 50); x.quadraticCurveTo(s2 * 10, 44, 0, 44); x.fill(); }
      x.restore(); }
    rule(s0 + 14, 236, s1 - 14, 240); rule(s0 + 14, H - 236, s1 - 14, H - 232);
    // dikey başlık: yukarıdan aşağıya
    { x.save(); x.translate(scx, (250 + H - 250) / 2); x.rotate(Math.PI / 2); x.textAlign = 'center'; x.textBaseline = 'middle';
      const spineTxt = `${title}  —  ${author}`, maxL = H - 560, maxT = spineW * 0.62;
      const sf = (fs) => (TF.upper ? `${Math.min(700, TF.weight)} ${fs}px ${TF.family}` : `${TF.weight} ${fs}px ${TF.family}`);
      spaced('', TF.upper ? 4 : 1); let fs = Math.min(maxT, 64); x.font = sf(fs);
      while (x.measureText(spineTxt).width > maxL && fs > 16) { fs -= 2; x.font = sf(fs); }
      x.fillStyle = foil(-maxL / 2, -fs, maxL / 2, fs); x.fillText(spineTxt, 0, fs * 0.05); x.restore(); }
    // sırt kenarı (kitap kapağı mafsalı)
    if (color) for (const sx of [s0, s1]) { const g = x.createLinearGradient(sx - 14, 0, sx + 14, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(sx - 14, 0, 28, H); }

    // ===== ARKA KAPAK =====
    const B = border(b0, b1, true), bcx = (B.x0 + B.x1) / 2;
    const px0 = B.x0 + 30, px1 = B.x1 - 30, py0 = B.y0 + 20, py1 = B.y1 - 20;
    frameRect(px0, py0, px1, py1, 4); frameRect(px0 + 10, py0 + 10, px1 - 10, py1 - 10, 1.5);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    spaced('', 4); x.font = `600 34px ${BODY}`; x.fillStyle = PAL.cream; fitText(author, px1 - px0 - 80, 34, 600); x.fillText(author, bcx, py0 + 80);
    flourishLine(bcx, py0 + 124, 70);
    const blurb = (spec.blurb || '').trim();
    if (blurb) {
      spaced('', 0.4); let fs = 33, lines; const maxW = px1 - px0 - 110, maxH = py1 - py0 - 300;
      do { x.font = `500 ${fs}px ${BODY}`; lines = wrap(blurb, maxW); fs -= 1; } while (lines.length * fs * 1.45 > maxH && fs > 18);
      fs += 1; const lh = fs * 1.45, top = (py0 + 150 + py1 - 130) / 2 - (lines.length * lh) / 2 + lh / 2;
      x.fillStyle = PAL.cream; lines.forEach((l, i) => x.fillText(l, bcx, top + i * lh));
    }
    spaced('', 6); x.font = `600 28px ${SERIF}`; x.fillStyle = foil(bcx - 110, py1 - 70, bcx + 110, py1 - 30); x.fillText('ERME BOOKS', bcx, py1 - 56);
    try { x.letterSpacing = '0px'; } catch {}

    // ===== cilt dokusu: keten dokuma, deri tanesi ya da mat kâğıt (görünür kapakta ve pürüzlülükte) =====
    if (mode !== 'metal') {
      const rr = rng(97 + TEX.length);
      if (TEX === 'deri') {   // deri: düzensiz tane ve yumuşak lekeler, hafif parlaklık
        for (let i = 0; i < 260; i++) { const gx = rr() * W, gy = rr() * H, gr = 40 + rr() * 160, g = x.createRadialGradient(gx, gy, 0, gx, gy, gr); g.addColorStop(0, `rgba(${rr() < 0.7 ? '0,0,0' : '255,255,255'},${color ? 0.03 : 0.06})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); }
        for (let i = 0; i < 22000; i++) { x.fillStyle = `rgba(${rr() < 0.85 ? '0,0,0' : '255,255,255'},${0.025 + rr() * 0.035})`; x.beginPath(); x.ellipse(rr() * W, rr() * H, 1.5 + rr() * 3.5, 1 + rr() * 2.5, rr() * 3, 0, 7); x.fill(); }
      }
      const PW = W * SC, PH = H * SC, img = x.getImageData(0, 0, PW, PH), d = img.data;
      const amp = color ? 1 : 0.6;
      let rowN = 0;
      for (let py = 0; py < PH; py++) {
        const yy = (py / SC) | 0;
        if (py % SC === 0) rowN = (rr() - 0.5) * 10;
        const wy = Math.sin(yy * 2.1) * 0.5 + 0.5;
        for (let px = 0; px < PW; px++) {
          const xx = (px / SC) | 0, i = (py * PW + px) * 4, hsh = (((xx * 7919 + yy * 104729) % 23) - 11);
          let k;
          if (TEX === 'keten') { const wx = Math.sin(xx * 2.1) * 0.5 + 0.5; k = ((xx + yy) & 2 ? wx : wy) * 14 - 7 + rowN + hsh * 0.55; }
          else if (TEX === 'deri') k = hsh * 0.35;
          else k = hsh * 0.4 + rowN * 0.15;   // kâğıt: ince, düzgün tane
          k *= amp; d[i] += k; d[i + 1] += k; d[i + 2] += k;
        }
      }
      x.putImageData(img, 0, 0);
      if (TEX === 'kagit') { for (let i = 0; i < 500; i++) { x.strokeStyle = `rgba(${rr() < 0.5 ? '0,0,0' : '255,255,255'},.05)`; x.lineWidth = 0.8; const fx = rr() * W, fy = rr() * H; x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + rr() * 20 - 10, fy + rr() * 20 - 10, fx + rr() * 30 - 15, fy + rr() * 30 - 15); x.stroke(); } }
      if (color) {   // kenar yıpranması ve hafif ışık
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,.12)'); g.addColorStop(0.08, 'rgba(0,0,0,0)'); g.addColorStop(0.92, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.14)');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
    }
    return { canvas: cv, regions: { back: [b0, b1], spine: [s0, s1], front: [f0, f1] }, W, H, spineW };
  }

  function crop(cv, x0, x1, scale = 1) { const c = mk(Math.round((x1 - x0) * scale), Math.round(cv.height * scale)); c.getContext('2d').drawImage(cv, x0, 0, x1 - x0, cv.height, 0, 0, c.width, c.height); return c; }
  function build(spec) {
    const col = render(spec, { mode: 'color' }), rough = render(spec, { mode: 'rough' }), metal = render(spec, { mode: 'metal' });
    const R = col.regions;
    return {
      spec, color: col.canvas, rough: rough.canvas, metal: metal.canvas, regions: R, W, H,
      frontJpeg: (q = 0.92) => crop(col.canvas, R.front[0], R.front[1]).toDataURL('image/jpeg', q),
      // EPUB kapağı: aynı tasarım 2 kat çözünürlükte (~1800×2560) yeniden çizilir
      frontHiJpeg: (q = 0.92) => { const hi = render(spec, { mode: 'color', scale: 2 }); return crop(hi.canvas, R.front[0] * 2, R.front[1] * 2).toDataURL('image/jpeg', q); },
      spreadJpeg: (q = 0.88) => col.canvas.toDataURL('image/jpeg', q),
    };
  }
  // motif kütüphanesi için küçük önizleme
  function preview(cv, motif, clothHex, foilKey) {
    const x = cv.getContext('2d'), w = cv.width, h = cv.height, S = SETS[motif] || SETS.geometrik, F = FOILS[foilKey] || FOILS.altin, ink = autoInk(clothHex).hex;
    x.fillStyle = clothHex; x.fillRect(0, 0, w, h);
    const icons = S.minimal ? [S.sep, S.sep, S.sep] : [S.icons[0], S.corner, S.icons[1] || S.icons[0]];
    icons.forEach((nm, i) => { if (!I[nm]) return; x.save(); x.translate(w * (0.2 + i * 0.3), h / 2); const sc = (S.minimal ? 0.16 : 0.34) * h / 40; x.scale(sc, sc); x.fillStyle = i % 2 ? ink : F.hex; I[nm](x); if (I[nm + 'Cut']) { x.fillStyle = clothHex; I[nm + 'Cut'](x); } x.restore(); });
    x.strokeStyle = F.hex; x.lineWidth = 1; x.strokeRect(2.5, 2.5, w - 5, h - 5);
  }
  window.CoverGen = { render, build, crop, preview, autoInk, lum, contrast, CLOTHS, CLOTH_NAMES, CLOTH_GROUPS, FOILS, MOTIFS, MOTIF_NAMES, CARTS, FONTS, TEXTURES, SETS, W, H };

  // =====================================================================
  // 3D KAPAK STÜDYOSU: kalın kapaklı kitap, bez cilt yayılımı sarılı
  // =====================================================================
  window.CoverStudio = {
    attach(cv) {
      const T = window.THREE; if (!T) return null;
      let renderer; try { renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { console.warn('WebGL yok', e); return null; }
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.setPixelRatio(window.ErmeQuality ? window.ErmeQuality.dpr(2) : Math.min(window.devicePixelRatio || 1, 2));
      const scene = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 0.15, 7);
      if (window.Book3D?.studioEnv) scene.environment = window.Book3D.studioEnv(renderer);
      scene.add(new T.HemisphereLight('#fff4e4', '#3a2a1e', 0.7));
      const key = new T.DirectionalLight('#fff2dc', 2.2); key.position.set(-3, 4, 5); scene.add(key);
      const rim = new T.DirectionalLight('#ffd7a0', 1.4); rim.position.set(4, 1, -3); scene.add(rim);
      const shadowC = mk(128, 128), sx = shadowC.getContext('2d'), sg = sx.createRadialGradient(64, 64, 4, 64, 64, 64); sg.addColorStop(0, 'rgba(20,12,6,.55)'); sg.addColorStop(1, 'rgba(20,12,6,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
      const shadow = new T.Mesh(new T.PlaneGeometry(3.2, 1.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadowC), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.32; scene.add(shadow);
      const book = new T.Group(); scene.add(book);
      const resize = () => { const w = cv.clientWidth || 1, h = cv.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
      const ro = new ResizeObserver(resize); ro.observe(cv); resize();
      // sayfa kenarı dokusu
      const pagesTex = (() => { const c = mk(64, 512), x = c.getContext('2d'); x.fillStyle = '#efe4cb'; x.fillRect(0, 0, 64, 512); for (let i = 0; i < 64; i += 2) { x.fillStyle = `rgba(120,90,50,${0.06 + (i % 6 ? 0 : 0.08)})`; x.fillRect(i, 0, 1, 512); } const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; })();
      const pagesTop = (() => { const c = mk(512, 64), x = c.getContext('2d'); x.fillStyle = '#efe4cb'; x.fillRect(0, 0, 512, 64); for (let i = 0; i < 64; i += 2) { x.fillStyle = `rgba(120,90,50,${0.06 + (i % 6 ? 0 : 0.08)})`; x.fillRect(0, i, 512, 1); } const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; })();
      let parts = [];
      function setCover(built) {
        parts.forEach((m) => { book.remove(m); m.geometry.dispose(); [].concat(m.material).forEach((mm) => { ['map', 'roughnessMap', 'metalnessMap'].forEach((k) => mm[k] && mm[k] !== pagesTex && mm[k] !== pagesTop && mm[k].dispose()); mm.dispose(); }); }); parts = [];
        const R = built.regions, Hh = 2.5, scale = Hh / built.H;
        const cw = (R.front[1] - R.front[0]) * scale, th = (R.spine[1] - R.spine[0]) * scale * 0.64, board = 0.03;   // sırt eğrisi düzden geniştir
        const tex = (src, x0, x1, srgb) => { const t = new T.CanvasTexture(window.CoverGen.crop(src, x0, x1, 0.75)); if (srgb) t.colorSpace = T.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
        const mat = (x0, x1) => new T.MeshStandardMaterial({ map: tex(built.color, x0, x1, true), roughnessMap: tex(built.rough, x0, x1), metalnessMap: tex(built.metal, x0, x1), roughness: 1, metalness: 1 });
        const front = mat(...R.front), back = mat(...R.back), spine = mat(...R.spine);
        const edgeMat = new T.MeshStandardMaterial({ color: built.spec.cloth, roughness: 0.9 });
        const endpaper = new T.MeshStandardMaterial({ color: '#f1e6cf', roughness: 0.9 });
        // kapaklar: ön (+z), arka (-z); sırt solda (-x)
        const fb = new T.Mesh(new T.BoxGeometry(cw, Hh, board), [edgeMat, edgeMat, edgeMat, edgeMat, front, endpaper]); fb.position.set(0, 0, th / 2 - board / 2);
        const bb = new T.Mesh(new T.BoxGeometry(cw, Hh, board), [edgeMat, edgeMat, edgeMat, edgeMat, endpaper, back]); bb.position.set(0, 0, -th / 2 + board / 2);
        const sp = new T.Mesh(new T.CylinderGeometry(th / 2, th / 2, Hh, 32, 1, true, Math.PI, Math.PI), spine); sp.position.set(-cw / 2, 0, 0); sp.scale.x = 0.55;
        const pb = new T.Mesh(new T.BoxGeometry(cw - 0.07, Hh - 0.08, th - board * 2 - 0.004), [new T.MeshStandardMaterial({ map: pagesTex, roughness: 0.95 }), endpaper, new T.MeshStandardMaterial({ map: pagesTop, roughness: 0.95 }), new T.MeshStandardMaterial({ map: pagesTop, roughness: 0.95 }), endpaper, endpaper]);
        pb.position.set(0.02, 0, 0);
        parts = [fb, bb, sp, pb]; parts.forEach((m) => book.add(m));
      }
      // fareyle 360° çevirme, tekerlekle yakınlaşma, boştayken yavaş dönüş
      const rot = { y: -0.5, x: 0.08, vy: 0, vx: 0 }; let drag = null, idle = 0, zoom = 7, zoomT = 7;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', (e) => { if (!drag) return; rot.vy = (e.clientX - drag.x) * 0.008; rot.vx = (e.clientY - drag.y) * 0.006; drag = { x: e.clientX, y: e.clientY }; idle = 0; });
      const up = () => { drag = null; cv.style.cursor = 'grab'; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.style.cursor = 'grab';
      cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomT = clamp(zoomT + e.deltaY * 0.003, 4.2, 9); }, { passive: false });
      let raf = 0, last = performance.now(), alive = true, shown = true;
      // sekme gizliyken (canvas görünmüyorken) çizim durur: GPU'yu ağaç sahnesine bırak
      const io = new IntersectionObserver((e) => { shown = e[0].isIntersecting; if (shown && alive && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } });
      io.observe(cv);
      const loop = (now) => {
        raf = 0; if (!alive || !shown) return; const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000)); last = now; idle += dt;
        rot.y += rot.vy; rot.x = clamp(rot.x + rot.vx, -0.7, 0.7); rot.vy *= Math.exp(-dt * 5); rot.vx *= Math.exp(-dt * 5);
        if (!drag && idle > 2.5) rot.y += dt * 0.25 * Math.min(1, (idle - 2.5) / 2);
        book.rotation.set(rot.x, rot.y, 0); book.position.y = Math.sin(now / 1400) * 0.03;
        zoom += (zoomT - zoom) * (1 - Math.exp(-dt * 6)); cam.position.z = zoom; cam.lookAt(0, 0, 0);
        renderer.render(scene, cam); raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return { setCover, showSide(side) { rot.y = side === 'back' ? Math.PI - 0.35 : side === 'spine' ? Math.PI / 2 - 0.2 : -0.35; rot.vy = 0; idle = 0; }, dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); } };
    },
  };
})();
