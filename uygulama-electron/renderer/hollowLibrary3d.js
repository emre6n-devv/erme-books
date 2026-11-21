// hollowLibrary3d.js - Hayat Ağacı'nın gövdesindeki kütüphane (Three.js r158, UMD).
// Kovuktan girilen, iç kabuk dokulu silindirik bir oda: duvar boyunca oyulmuş kavisli raflar, tavandan sarkan
// sıcak fenerler, havada süzülen toz zerreleri. Odanın ortasından 360° bakılır.
//   Fare sürükle: etrafa bak · tekerlek: raflara yaklaş · kitabı tut-sürükle: başka rafa / sıraya taşı
//   kitaba tık: aç · çift tık / sağ tık: o noktaya vur (sarsıntı + toz, yakındaki 2-3 kitap devrilip yere düşer)
//   yerdeki kitaba tık: rafa geri dizilir; tutup bir rafa da bırakılabilir.
// Düzen (raftaki sıralar ve yerdeki kitaplar) localStorage'da saklanır.
//   window.HollowLibrary.attach(wrap, { onOpen(book), onCovered(), onExit() }) -> { enter(books, season), exit(), active }
(function () {
  const T = window.THREE;
  if (!T) return;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const texOf = (c, rep) => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(...rep); } return t; };

  // ---------- oda ölçüleri ----------
  const R = 3.3, H = 5.0, SD = 0.38, TH = 0.055;                 // duvar yarıçapı, tavan, raf derinliği, raf kalınlığı
  const LEVELS = [0.34, 0.98, 1.62, 2.26, 2.9, 3.54];             // raf üst yüzeyleri
  const DOOR = Math.PI, DOOR_W = 0.95, BAYS = 7, RIB = 0.09;      // kapı açısı ve genişliği, bölme sayısı
  const RB = R - SD + 0.16;                                        // kitap merkezlerinin yarıçapı
  const EYE = 1.62, FLOOR = 0;

  // ---------- elle boyanmış dokular ----------
  function barkInside() {   // ağacın iç kabuğu: dikey lifler, budak gözleri, sıcak kahve
    const c = mkCanvas(512, 512), x = c.getContext('2d'), r = rng(11);
    const g = x.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#5a3820'); g.addColorStop(0.5, '#6e472a'); g.addColorStop(1, '#5a3820');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      const xx = r() * 512, w = 1 + r() * 4; x.strokeStyle = r() < 0.5 ? `rgba(40,22,10,${0.2 + r() * 0.35})` : `rgba(150,100,60,${0.12 + r() * 0.2})`; x.lineWidth = w;
      x.beginPath(); x.moveTo(xx, 0); for (let y = 0; y <= 512; y += 32) x.lineTo(xx + Math.sin(y * 0.02 + i) * 6 + (r() - 0.5) * 3, y); x.stroke();
    }
    for (let k = 0; k < 6; k++) { const cx = r() * 512, cy = r() * 512, rx = 8 + r() * 14;
      for (let j = 0; j < 5; j++) { x.strokeStyle = `rgba(30,16,8,${0.5 - j * 0.08})`; x.lineWidth = 2; x.beginPath(); x.ellipse(cx, cy, rx + j * 5, (rx + j * 5) * 2.2, 0, 0, 6.283); x.stroke(); } }
    return texOf(c, [8, 2.2]);
  }
  function ringsTex(dark) {   // zemin ve tavan: gövdenin kesiti, yıllık halkalar
    const S = 1024, c = mkCanvas(S, S), x = c.getContext('2d'), r = rng(dark ? 5 : 3);
    x.fillStyle = dark ? '#2e1c10' : '#a87a4c'; x.fillRect(0, 0, S, S);
    for (let k = 0; k < 70; k++) {
      const rad = (k / 70) * S * 0.5, wob = 3 + r() * 4;
      x.strokeStyle = dark ? `rgba(10,5,2,${0.25 + r() * 0.3})` : `rgba(${90 + r() * 30},${55 + r() * 20},${28 + r() * 12},${0.35 + r() * 0.4})`;
      x.lineWidth = 1.5 + r() * 4; x.beginPath();
      for (let a = 0; a <= 6.3; a += 0.05) { const rr = rad + Math.sin(a * 5 + k) * wob * (k / 70); const px = S / 2 + Math.cos(a) * rr, py = S / 2 + Math.sin(a) * rr; a ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.stroke();
    }
    for (let k = 0; k < 9; k++) { const a = r() * 6.283, l = S * (0.15 + r() * 0.3); x.strokeStyle = 'rgba(30,16,8,.5)'; x.lineWidth = 2 + r() * 2; x.beginPath(); x.moveTo(S / 2 + Math.cos(a) * S * 0.5, S / 2 + Math.sin(a) * S * 0.5); x.lineTo(S / 2 + Math.cos(a + 0.03) * (S * 0.5 - l), S / 2 + Math.sin(a + 0.03) * (S * 0.5 - l)); x.stroke(); }
    const v = x.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5); v.addColorStop(0, 'rgba(255,220,170,.12)'); v.addColorStop(1, 'rgba(0,0,0,.35)'); x.fillStyle = v; x.fillRect(0, 0, S, S);
    return texOf(c);
  }
  function woodTex() {
    const c = mkCanvas(512, 64), x = c.getContext('2d'), r = rng(21);
    x.fillStyle = '#8a5a32'; x.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(${60 + r() * 40},${32 + r() * 20},${14},${0.25 + r() * 0.3})`; x.lineWidth = 1 + r() * 2; const y = r() * 64; x.beginPath(); x.moveTo(0, y); for (let xx = 0; xx <= 512; xx += 32) x.lineTo(xx, y + Math.sin(xx * 0.02 + i) * 3); x.stroke(); }
    return texOf(c, [3, 1]);
  }
  function glowTex() {
    const c = mkCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return texOf(c);
  }
  function spineGeneric() {   // dekor kitap sırtı: gri tonlu (renk örnek başına verilir)
    const c = mkCanvas(64, 256), x = c.getContext('2d');
    x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, 64, 256);
    const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(0,0,0,.4)'); x.fillStyle = g; x.fillRect(0, 0, 64, 256);
    x.fillStyle = 'rgba(255,240,200,.85)'; for (const y of [18, 26, 228, 236]) x.fillRect(4, y, 56, 3);
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(10, 70, 44, 90);
    x.fillStyle = 'rgba(255,240,200,.55)'; for (let i = 0; i < 5; i++) x.fillRect(16, 80 + i * 16, 32, 4);
    return texOf(c);
  }
  function pagesTex() {
    const c = mkCanvas(64, 256), x = c.getContext('2d'); x.fillStyle = '#efe4cc'; x.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 64; i += 2) { x.fillStyle = `rgba(120,90,50,${0.08 + (i % 6 === 0 ? 0.08 : 0)})`; x.fillRect(i, 0, 1, 256); }
    return texOf(c);
  }
  function spineReal(b) {   // gerçek kitap sırtı: başlık aşağıdan yukarı, yazar, yaldız bantlar
    const W = 128, Hh = 640, c = mkCanvas(W, Hh), x = c.getContext('2d');
    x.fillStyle = b.color; x.fillRect(0, 0, W, Hh);
    const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,.4)'); g.addColorStop(0.22, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = g; x.fillRect(0, 0, W, Hh);
    x.fillStyle = '#e8c878'; for (const y of [30, 42, Hh - 46, Hh - 34]) x.fillRect(8, y, W - 16, 4);
    x.save(); x.translate(W / 2, Hh - 70); x.rotate(-Math.PI / 2);
    let fs = 40; const title = b.title.length > 42 ? b.title.slice(0, 40) + '…' : b.title;
    x.font = `600 ${fs}px Georgia, serif`; while (x.measureText(title).width > Hh - 220 && fs > 18) { fs -= 2; x.font = `600 ${fs}px Georgia, serif`; }
    x.fillStyle = '#f6ecd6'; x.textBaseline = 'middle'; x.fillText(title, 0, b.author ? -10 : 0);
    if (b.author) { x.font = `400 ${Math.max(16, fs * 0.55)}px Georgia, serif`; x.fillStyle = 'rgba(246,236,214,.75)'; x.fillText(b.author, 0, fs * 0.62); }
    x.restore();
    if (b.kind === 'project') { x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(W * 0.62, 0); x.lineTo(W * 0.84, 0); x.lineTo(W * 0.84, 130); x.lineTo(W * 0.73, 112); x.lineTo(W * 0.62, 130); x.fill(); }   // ayraç: devam eden proje
    return texOf(c);
  }
  const DECOR_COLS = ['#7a2a24', '#2e4a36', '#24345a', '#8a6a2a', '#5a3a26', '#2a5a5a', '#6a2a4a', '#c8b48a', '#3a3a3a', '#8a4a24', '#4a5a2a', '#9a8a6a'];

  window.HollowLibrary = {
    attach(wrap, opts = {}) {
      const cv = wrap.querySelector('canvas'), label = wrap.querySelector('.hl-label');
      let renderer;
      try { renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' }); } catch (e) { console.warn('WebGL yok', e); return null; }
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      const EQ = window.ErmeQuality;
      renderer.setPixelRatio(EQ ? EQ.dpr(1.5) : Math.min(window.devicePixelRatio || 1, 1.5));
      const scene = new T.Scene(); scene.background = new T.Color('#1a0f08'); scene.fog = new T.Fog('#1a0f08', 5, 11);
      const cam = new T.PerspectiveCamera(62, 1, 0.05, 40);
      const resize = () => { const w = cv.clientWidth || 1, h = cv.clientHeight || 1; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
      const ro = new ResizeObserver(resize); ro.observe(cv);

      // ---------- ışık ----------
      scene.add(new T.HemisphereLight('#ffd9a8', '#3a2010', 0.55));
      const lamps = [];
      const glow = glowTex();
      [[0.55, 3.9, 0.4, 1.0], [-1.15, 3.35, -0.65, 0.78], [0.9, 3.15, -1.2, 0.62]].forEach(([x, y, z, s], i) => {   // tavandan ince zincirlerle sarkan kâğıt fenerler
        const g = new T.Group(); g.position.set(x, y, z); scene.add(g);
        const chainM = new T.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.7, roughness: 0.4 }), top = H + 0.9 - y;
        for (let k = 0; k * 0.07 < top; k++) { const l = new T.Mesh(new T.TorusGeometry(0.018, 0.004, 4, 8), chainM); l.position.y = 0.26 * s + k * 0.07; l.rotation.y = k % 2 ? Math.PI / 2 : 0; g.add(l); }
        const paper = new T.Mesh(new T.SphereGeometry(0.2 * s, 24, 16), new T.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffa850', emissiveIntensity: 0.85, roughness: 0.8 }));
        paper.scale.y = 1.25; g.add(paper);
        for (const yy of [0.25, -0.25]) { const cap = new T.Mesh(new T.CylinderGeometry(0.045 * s, 0.045 * s, 0.025, 16), new T.MeshStandardMaterial({ color: '#c8964a', metalness: 0.7, roughness: 0.35, emissive: '#5a3410', emissiveIntensity: 0.6 })); cap.position.y = yy * s; g.add(cap); }
        const tas = new T.Mesh(new T.ConeGeometry(0.018 * s, 0.09 * s, 6).rotateX(Math.PI), new T.MeshStandardMaterial({ color: '#a8402a' })); tas.position.y = -0.31 * s; g.add(tas);
        const halo = new T.Sprite(new T.SpriteMaterial({ map: glow, color: '#ffb05a', transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.55 })); halo.scale.setScalar(1.6 * s); g.add(halo);
        const L = new T.PointLight('#ffb867', 8 * s, 9, 1.7); g.add(L);
        lamps.push({ g, L, ph: i * 2.1, base: 8 * s });
      });

      // ---------- oda: iç kabuk duvarı, kesit zemini, kubbe ----------
      const a0RootAll = DOOR + DOOR_W / 2 + 0.2;
      const bark = barkInside();
      const wallMat = new T.MeshStandardMaterial({ map: bark, roughness: 0.95, side: T.BackSide, color: '#c8a888' });
      const wall = new T.Mesh(new T.CylinderGeometry(R, R, H, 96, 1, true, DOOR + DOOR_W / 2, Math.PI * 2 - DOOR_W), wallMat); wall.position.y = H / 2; scene.add(wall);
      const lintel = new T.Mesh(new T.CylinderGeometry(R, R, H - 2.55, 24, 1, true, DOOR - DOOR_W / 2, DOOR_W), wallMat); lintel.position.y = 2.55 + (H - 2.55) / 2; scene.add(lintel);
      const floor = new T.Mesh(new T.CircleGeometry(R, 96).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ map: ringsTex(false), roughness: 0.85 })); scene.add(floor);
      const DOME = 0.62, HOLE = 0.2;   // kubbe yüksekliği oranı, tepe açıklığı (radyan)
      const dome = new T.Mesh(new T.SphereGeometry(R, 72, 24, 0, Math.PI * 2, HOLE, Math.PI / 2 - HOLE), new T.MeshStandardMaterial({ map: bark, color: '#7a5a42', roughness: 1, side: T.BackSide }));
      dome.scale.y = DOME; dome.position.y = H; scene.add(dome);
      const domeY = (phi) => H + Math.cos(phi) * R * DOME, domeR = (phi) => Math.sin(phi) * R;
      { const r = rng(31), branchM = new T.MeshStandardMaterial({ map: bark, color: '#9a7050', roughness: 0.9 });
        for (let k = 0; k < 16; k++) {   // kubbe boyunca kıvrılarak tepede buluşan dallar (yarısı ters yöne sarmal: örgü)
          const a0 = (k / 16) * Math.PI * 2 + r() * 0.1, tw = (k % 2 ? 1 : -1) * (0.7 + r() * 0.5), pts = [];
          for (let i = 0; i <= 14; i++) { const u = i / 14, phi = lerp(Math.PI / 2, HOLE + 0.02, u), a = a0 + tw * u, rr = domeR(phi) - 0.06; pts.push(V(Math.sin(a) * rr, domeY(phi) - 0.05, Math.cos(a) * rr)); }
          scene.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 48, 0.05 + r() * 0.05, 6), branchM));
        }
        const ringPts = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; ringPts.push(V(Math.sin(a) * domeR(HOLE) * 0.98, domeY(HOLE) - 0.04, Math.cos(a) * domeR(HOLE) * 0.98)); }
        scene.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(ringPts, true), 60, 0.07, 8, true), branchM)); }
      // tepe açıklığı: dışarının mevsim ışığı ve aşağı süzülen yumuşak hüzme
      const skyMat = new T.MeshBasicMaterial({ color: '#fff2cc', toneMapped: false });
      const sky = new T.Mesh(new T.CircleGeometry(domeR(HOLE) * 1.1, 32).rotateX(Math.PI / 2), skyMat); sky.position.y = domeY(HOLE) + 0.25; scene.add(sky);
      const shaftMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { uCol: { value: new T.Color('#ffd98a') }, uT: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 uCol; uniform float uT; varying vec2 vUv;
          void main(){ float edge = sin(vUv.x * 3.14159 * 8.0 + uT * 0.3) * 0.15 + 0.85; float fade = pow(vUv.y, 1.6) * smoothstep(0.0, 0.25, vUv.y);
            gl_FragColor = vec4(uCol, 0.16 * fade * edge); }` });
      const shaftTop = domeY(HOLE) + 0.1, shaft = new T.Mesh(new T.CylinderGeometry(domeR(HOLE) * 0.95, 1.05, shaftTop - 0.02, 32, 1, true), shaftMat); shaft.position.set(0, shaftTop / 2, 0); scene.add(shaft);
      const shaftSpot = new T.SpotLight('#ffd98a', 14, shaftTop + 1, 0.42, 0.6, 1.2); shaftSpot.position.set(0, shaftTop, 0); shaftSpot.target.position.set(0, 0, 0); scene.add(shaftSpot, shaftSpot.target);
      // kapı: dışarının mevsim ışığı + organik çerçeve
      const chordZ = -R * Math.cos(DOOR_W / 2) + 0.01, chordW = 2 * R * Math.sin(DOOR_W / 2) + 0.06, DH = 2.55, AW = 1.5, AH = 2.3;
      const archPath = (x, W, Hh) => { x.beginPath(); x.moveTo(W / 2 - AW / chordW * W / 2, Hh);
        for (let i = 0; i <= 32; i++) { const a = Math.PI * (i / 32); x.lineTo(W / 2 - Math.cos(a) * AW / chordW * W / 2, Hh - Math.pow(Math.sin(a), 0.7) * AH / DH * Hh); } x.closePath(); };
      { const W = 512, Hh = Math.round(512 * DH / chordW), c = mkCanvas(W, Hh), x = c.getContext('2d');
        x.drawImage(bark.image, 0, 0, W * 0.6, Hh * 1.4); x.drawImage(bark.image, W * 0.6, 0, W * 0.6, Hh * 1.4);
        x.globalCompositeOperation = 'destination-out'; archPath(x, W, Hh); x.fill();
        const t = texOf(c);
        const front = new T.Mesh(new T.PlaneGeometry(chordW, DH), new T.MeshStandardMaterial({ map: t, color: '#c8a888', roughness: 0.95, alphaTest: 0.5, side: T.DoubleSide }));
        front.position.set(0, DH / 2, chordZ); scene.add(front); }
      // kemer çerçevesi: kabuktan kalın bir dudak
      { const pts = []; for (let i = 0; i <= 32; i++) { const a = Math.PI * (i / 32); pts.push(V(-Math.cos(a) * AW / 2, Math.pow(Math.sin(a), 0.7) * AH, chordZ + 0.03)); }
        scene.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 64, 0.09, 8), new T.MeshStandardMaterial({ map: bark, color: '#a07a5a', roughness: 0.9 }))); }
      // kapının ardı: mevsimin yumuşak ışığı (gradyan) ve kapıdan süzülen ışık
      const doorGlowMat = new T.MeshBasicMaterial({ color: '#ffe8c0', toneMapped: false, transparent: true });
      { const c = mkCanvas(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 170, 10, 128, 150, 170);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,.18)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
        doorGlowMat.map = texOf(c); }
      const doorPlane = new T.Mesh(new T.PlaneGeometry(3, 3), doorGlowMat); doorPlane.position.set(0, 1.3, chordZ - 0.7); scene.add(doorPlane);
      const doorLight = new T.PointLight('#ffe2b8', 3.5, 6, 1.6); doorLight.position.set(0, 1.3, chordZ + 0.5); scene.add(doorLight);

      // ---------- raflar ve bölmeler ----------
      const wood = woodTex(), shelfMat = new T.MeshStandardMaterial({ map: wood, color: '#c89a68', roughness: 0.7 });
      const arcLen = Math.PI * 2 - DOOR_W - 0.06, bayA = arcLen / BAYS, a0All = DOOR + DOOR_W / 2 + 0.03;
      const bays = []; for (let b = 0; b < BAYS; b++) bays.push({ a0: a0All + b * bayA + RIB / R * 1.2, a1: a0All + (b + 1) * bayA - RIB / R * 1.2 });
      const shelfShape = (a0, a1) => { const sh = new T.Shape(), ri = R - SD, ro = R - 0.02, N = 24;
        for (let i = 0; i <= N; i++) { const a = lerp(a0, a1, i / N); i ? sh.lineTo(Math.sin(a) * ri, Math.cos(a) * ri) : sh.moveTo(Math.sin(a) * ri, Math.cos(a) * ri); }
        for (let i = N; i >= 0; i--) { const a = lerp(a0, a1, i / N); sh.lineTo(Math.sin(a) * ro, Math.cos(a) * ro); }
        return sh; };
      const shelfMeshes = [];
      for (const b of bays) {
        const geo = new T.ExtrudeGeometry(shelfShape(b.a0 - 0.02, b.a1 + 0.02), { depth: TH, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 }).rotateX(Math.PI / 2);
        for (const y of LEVELS) { const m = new T.Mesh(geo, shelfMat); m.position.y = y; scene.add(m); shelfMeshes.push(m); }
        const top = new T.Mesh(geo, shelfMat); top.position.y = LEVELS[LEVELS.length - 1] + 0.64; scene.add(top); shelfMeshes.push(top);
      }
      // bölmeler: tavana kadar uzanan, hafif kıvrımlı kök sütunlar
      const ribMat = new T.MeshStandardMaterial({ map: bark, color: '#8a6446', roughness: 0.9 });
      const ribs = [];
      for (let b = 0; b <= BAYS; b++) {
        const a = a0All + b * bayA, rr = R - SD * 0.55, pts = [];
        for (let i = 0; i <= 10; i++) { const y = (i / 10) * H, w = Math.sin(i * 0.9 + b) * 0.05; pts.push(V(Math.sin(a + w / R) * (rr + Math.sin(i * 1.3 + b) * 0.04), y, Math.cos(a + w / R) * (rr + Math.sin(i * 1.3 + b) * 0.04))); }
        const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, RIB * (b === 0 || b === BAYS ? 1.3 : 1), 8), ribMat); scene.add(m); ribs.push(m);
      }

      // ---------- kitaplar ----------
      const boxGeo = new T.BoxGeometry(1, 1, 1);
      const pagesMat = new T.MeshStandardMaterial({ map: pagesTex(), roughness: 0.9 });
      pagesMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', ''); };   // sayfalar örnek rengini almasın
      const coverMat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 });
      const spineMat = new T.MeshStandardMaterial({ map: spineGeneric(), roughness: 0.7 });
      const NDEC = 1400;
      const decor = new T.InstancedMesh(boxGeo, [coverMat, coverMat, pagesMat, pagesMat, spineMat, pagesMat], NDEC);
      decor.instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(decor);
      const books = [], realMeshes = [], byId = new Map();
      const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sv = V(), tmp = V(), tmp2 = V(), UP = V(0, 1, 0);
      let nDec = 0;
      function newBook(o) {
        const b = Object.assign({ state: 'shelf', pos: V(), q: new T.Quaternion(), vel: V(), ang: V(), pull: 0, pullT: 0, shake: 0, shakeT: 9, lean: 0, dirty: true, shelf: null }, o);
        books.push(b); byId.set(b.id, b); return b;
      }
      // dekor kitaplar: her rafta kümeler ve aralıklar (sabit tohumla hep aynı düzen)
      const shelves = [];
      // raflar arası küçük objeler (sabit boşluklarda durur, kitaplar kayınca onlarla birlikte kayar)
      const PROPS = [{ type: 'lamp', li: 1, bi: 1, at: 0.15, w: 0.3 }, { type: 'jar', li: 2, bi: 5, at: 0.55, w: 0.26 }, { type: 'terrarium', li: 3, bi: 2, at: 0.35, w: 0.34 },
        { type: 'hourglass', li: 1, bi: 4, at: 0.7, w: 0.2 }, { type: 'compass', li: 2, bi: 0, at: 0.4, w: 0.24 }, { type: 'jar', li: 4, bi: 3, at: 0.2, w: 0.26 }];
      { const r = rng(77);
        for (let li = 0; li < LEVELS.length; li++) for (let bi = 0; bi < bays.length; bi++) {
          const B = bays[bi], len = (B.a1 - B.a0) * RB, sh = { li, bi, y: LEVELS[li], a0: B.a0, len, items: [] }; shelves.push(sh);
          let s = 0.04; const reserve = (li === 1 || li === 2) && (bi === 3 || bi === 2 || bi === 4);   // göz hizası, karşı bölmeler: gerçek kitaplara yer
          const prop = PROPS.find((p) => p.li === li && p.bi === bi);
          while (s < len - 0.05) {
            if (prop && !prop.placed && s > prop.at * len) { prop.placed = true; sh.items.push({ gap: true, fixed: true, prop, w: prop.w }); s += prop.w; continue; }
            if (r() < (reserve ? 0.6 : 0.45)) { const w = Math.min(len - s, 0.15 + r() * (reserve ? 0.55 : 0.45)); sh.items.push({ gap: true, w }); s += w; continue; }   // gözün dinleneceği boşluklar
            const n = 3 + Math.floor(r() * 9), col = DECOR_COLS[Math.floor(r() * DECOR_COLS.length)];
            for (let k = 0; k < n && s < len - 0.1 && nDec < NDEC; k++) {
              const w = 0.028 + r() * 0.06, h = 0.24 + r() * 0.2 + (r() < 0.08 ? 0.1 : 0), d = 0.2 + r() * 0.1;
              const c = new T.Color(r() < 0.6 ? col : DECOR_COLS[Math.floor(r() * DECOR_COLS.length)]).offsetHSL(0, 0, (r() - 0.5) * 0.08);
              const bk = newBook({ id: `d${nDec}`, real: false, idx: nDec++, w, h, d, color: c, jit: (r() - 0.5) * 0.03 });
              decor.setColorAt(bk.idx, c); sh.items.push({ book: bk, w: w + 0.003 }); bk.shelf = sh; s += w + 0.003;
            }
          }
          const used = sh.items.reduce((a, it) => a + it.w, 0); if (used < len - 0.04) sh.items.push({ gap: true, w: len - 0.04 - used });
          if (prop && !prop.placed) { prop.placed = true; sh.items.push({ gap: true, fixed: true, prop, w: prop.w }); }
        }
        decor.count = nDec; decor.instanceColor.needsUpdate = true; }
      // raf düzeni: her öğenin açısı (kayarak yer açma için hedef olarak kullanılır)
      function layout(sh, extra) {   // extra: { at, w } sürükleme sırasında açılan geçici boşluk
        let s = 0.04; const its = sh.items.slice();
        if (extra) {
          // geçici boşluğu en yakın sağdaki (yoksa soldaki) aralıktan al
          let k = its.findIndex((it, i) => i >= extra.at && it.gap && !it.fixed && it.w >= extra.w + 0.01);
          if (k < 0) for (let i = extra.at - 1; i >= 0; i--) if (its[i].gap && !its[i].fixed && its[i].w >= extra.w + 0.01) { k = i; break; }
          if (k < 0) return false;
          its[k] = { gap: true, w: its[k].w - extra.w - 0.004 }; its.splice(extra.at, 0, { slot: true, w: extra.w + 0.004 });
        }
        const out = [];
        for (const it of its) { const c = s + it.w / 2; out.push({ it, a: sh.a0 + c / RB }); s += it.w; }
        for (const o of out) { if (o.it.book && o.it.book.state === 'shelf') { o.it.book.ta = o.a; o.it.book.ty = sh.y; } if (o.it.prop) { o.it.prop.ta = o.a; o.it.prop.ty = sh.y; } }
        return out;
      }
      const shelfPose = (b, a, y, pull, outP, outQ) => {
        const r = RB - pull; outP.set(Math.sin(a) * r, y + TH * 0 + b.h / 2 + 0.002, Math.cos(a) * r);
        e.set(0, a + Math.PI, b.jit + b.lean, 'YXZ'); outQ.setFromEuler(e);
      };
      // gerçek kitaplar (EPUB'lar ve projeler)
      const spineCache = new Map();
      function makeReal(d) {
        const col = d.color || '#7a3b2a';
        const pages = d.pages || 220, h = 0.38 + (d.title.length % 5) * 0.012;
        let w = clamp(0.045 + pages / 7000, 0.05, 0.11), dd = 0.27;
        const WR = d.wrap && d.wrap.src && d.wrap.regions ? d.wrap : null;
        if (WR) { const R = WR.regions; w = clamp(h * (R.spine[1] - R.spine[0]) / WR.H * 0.8, 0.04, 0.13); dd = h * (R.front[1] - R.front[0]) / WR.H; }   // bez cilt oranları
        const sp = spineCache.get(d.id) || spineReal({ ...d, color: col }); spineCache.set(d.id, sp);
        const cm = new T.MeshStandardMaterial({ color: col, roughness: 0.7 });
        const front = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
        if (WR) { /* bez cilt sarımı aşağıda yüklenir */ } else if (d.cover) new T.TextureLoader().load(d.cover, (tx) => { tx.colorSpace = T.SRGBColorSpace; front.map = tx; front.needsUpdate = true; }); else front.color.set(col);
        const spineM = new T.MeshStandardMaterial({ map: sp, roughness: 0.6 });
        const mesh = new T.Mesh(boxGeo, [front, cm, pagesMat, pagesMat, spineM, pagesMat]);
        if (WR) {   // onaylı bez cilt kapağı: ön (+x), arka (-x), sırt (+z) aynı sarımdan kesilir
          const im = new Image();
          im.onload = () => {
            const R = WR.regions, sx = im.width / WR.W;
            const cut = (x0, x1) => { const c = mkCanvas(Math.round((x1 - x0) * sx * 0.5), Math.round(im.height * 0.5)); c.getContext('2d').drawImage(im, x0 * sx, 0, (x1 - x0) * sx, im.height, 0, 0, c.width, c.height); return texOf(c); };
            front.map = cut(...R.front); front.color.set('#ffffff'); front.needsUpdate = true;
            cm.map = cut(...R.back); cm.color.set('#ffffff'); cm.needsUpdate = true;
            spineM.map = cut(...R.spine); spineM.roughness = 0.75; spineM.needsUpdate = true;
          };
          im.src = WR.src;
        }
        scene.add(mesh); realMeshes.push(mesh);
        const b = newBook({ id: d.id, real: true, data: d, mesh, w, h, d: dd, color: new T.Color(col), jit: 0 });
        mesh.userData.book = b; return b;
      }
      function clearReal() {
        for (const b of books.filter((x) => x.real)) { scene.remove(b.mesh); b.mesh.material.forEach((m) => { if (m !== pagesMat) { m.map && m !== pagesMat && !spineCache.has(b.id) && m.map.dispose(); m.dispose(); } }); byId.delete(b.id); }
        for (const sh of shelves) sh.items = sh.items.map((it) => (it.book && it.book.real ? { gap: true, w: it.w } : it));
        for (let i = books.length - 1; i >= 0; i--) if (books[i].real) books.splice(i, 1);
        realMeshes.length = 0;
      }
      function insertAt(sh, at, b) {   // rafta at sırasına kitabı koy (yer en yakın aralıktan alınır)
        const its = sh.items, w = b.w + 0.004;
        let k = its.findIndex((it, i) => i >= at && it.gap && !it.fixed && it.w >= w + 0.006);
        if (k < 0) for (let i = Math.min(at, its.length) - 1; i >= 0; i--) if (its[i].gap && !its[i].fixed && its[i].w >= w + 0.006) { k = i; break; }
        if (k < 0) return false;
        its[k].w -= w; if (k < at) at--; its.splice(at, 0, { book: b, w }); if (its[k].w < 0.004 && its[k] !== its[at]) its.splice(its.indexOf(its[k]), 1);
        b.shelf = sh; b.state = 'shelf'; layout(sh); return true;
      }
      function removeFromShelf(b) {   // çekilen / düşen kitabın yeri boşluk olarak kalır
        const sh = b.shelf; if (!sh) return; const i = sh.items.findIndex((it) => it.book === b);
        if (i >= 0) sh.items[i] = { gap: true, w: sh.items[i].w };
        // komşu boşlukları birleştir
        for (let j = sh.items.length - 1; j > 0; j--) if (sh.items[j].gap && sh.items[j - 1].gap && !sh.items[j].fixed && !sh.items[j - 1].fixed) { sh.items[j - 1].w += sh.items[j].w; sh.items.splice(j, 1); }
        b.shelf = null;
      }
      const firstFit = (b, prefer) => {   // gerçek kitap için uygun raf: göz hizasında, karşı bölmelerden başlayarak
        const order = prefer || [[1, 3], [2, 3], [1, 2], [1, 4], [2, 2], [2, 4], [3, 3], [0, 3], [3, 2], [3, 4]];
        for (const [li, bi] of order) { const sh = shelves.find((s) => s.li === li && s.bi === bi); const at = sh.items.findIndex((it) => it.gap && !it.fixed && it.w >= b.w + 0.012); if (at >= 0 && insertAt(sh, at, b)) return true; }
        for (const sh of shelves) { const at = sh.items.findIndex((it) => it.gap && !it.fixed && it.w >= b.w + 0.012); if (at >= 0 && insertAt(sh, at, b)) return true; }
        return false;
      };

      // ---------- düzenin saklanması ----------
      const KEY = 'hollowLibraryLayout.v2';
      function save() {
        try {
          const data = { shelves: shelves.map((sh) => sh.items.map((it) => (it.fixed ? ['p', PROPS.indexOf(it.prop)] : it.gap ? ['g', +it.w.toFixed(4)] : [it.book.id]))),
            floor: books.filter((b) => b.state === 'floor').map((b) => [b.id, ...b.pos.toArray().map((v) => +v.toFixed(3)), ...b.q.toArray().map((v) => +v.toFixed(4))]) };
          localStorage.setItem(KEY, JSON.stringify(data));
        } catch {}
      }
      function restore() {
        let data; try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
        if (!data || data.shelves?.length !== shelves.length) return;
        const seen = new Set();
        shelves.forEach((sh, i) => {
          const its = [];
          for (const row of data.shelves[i]) {
            if (row[0] === 'g') { its.push({ gap: true, w: row[1] }); continue; }
            if (row[0] === 'p') { const p = PROPS[row[1]]; if (p) its.push({ gap: true, fixed: true, prop: p, w: p.w }); continue; }
            const b = byId.get(row[0]); if (!b || seen.has(b)) { const w0 = b ? b.w + 0.004 : 0.06; its.push({ gap: true, w: w0 }); continue; }
            seen.add(b); its.push({ book: b, w: b.w + (b.real ? 0.004 : 0.003) }); b.shelf = sh; b.state = 'shelf';
          }
          // genişlik tutarlılığı: toplamı rafa sığdır
          const used = its.reduce((a, it) => a + it.w, 0), len = sh.len - 0.04;
          if (used > len) { let over = used - len; for (let k = its.length - 1; k >= 0 && over > 0; k--) if (its[k].gap && !its[k].fixed) { const cut = Math.min(its[k].w, over); its[k].w -= cut; over -= cut; } }
          else its.push({ gap: true, w: len - used });
          sh.items = its.filter((it) => !it.gap || it.w > 0.002);
        });
        for (const row of data.floor || []) { const b = byId.get(row[0]); if (!b || seen.has(b)) continue; seen.add(b); b.state = 'floor'; b.landN = ++landCount; b.shelf = null; b.pos.set(row[1], row[2], row[3]); { const rr = Math.hypot(b.pos.x, b.pos.z), mx = R - 0.85; if (rr > mx) { b.pos.x *= mx / rr; b.pos.z *= mx / rr; } } b.q.set(row[4], row[5], row[6], row[7]); }
        // kayıtta olmayanlar (yeni kitaplar ya da kaybolan dekorlar) uygun bir rafa
        for (const b of books) if (!seen.has(b)) { for (const sh of shelves) { const i = sh.items.findIndex((it) => it.book === b); if (i >= 0) sh.items[i] = { gap: true, w: sh.items[i].w }; } b.shelf = null; firstFit(b); }
      }

      // ---------- raf objeleri ----------
      const brass = new T.MeshStandardMaterial({ color: '#b8893a', metalness: 0.85, roughness: 0.35 });
      const glass = new T.MeshStandardMaterial({ color: '#e8f4f0', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
      const woodM = new T.MeshStandardMaterial({ color: '#5a3620', roughness: 0.8 });
      const flies = [];
      function buildProp(p) {
        const g = new T.Group(); scene.add(g); p.g = g; p.anim = null;
        if (p.type === 'lamp') {   // masa feneri: pirinç gövde, cam, titreyen alev
          const base = new T.Mesh(new T.CylinderGeometry(0.06, 0.075, 0.03, 16), brass); base.position.y = 0.015; g.add(base);
          for (const [x, z] of [[-0.045, -0.045], [0.045, -0.045], [-0.045, 0.045], [0.045, 0.045]]) { const post = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, 0.16, 6), brass); post.position.set(x, 0.11, z); g.add(post); }
          const gl = new T.Mesh(new T.BoxGeometry(0.09, 0.14, 0.09), glass); gl.position.y = 0.11; g.add(gl);
          const roof = new T.Mesh(new T.ConeGeometry(0.075, 0.06, 4), brass); roof.rotation.y = Math.PI / 4; roof.position.y = 0.22; g.add(roof);
          const ring = new T.Mesh(new T.TorusGeometry(0.02, 0.004, 6, 12), brass); ring.position.y = 0.265; g.add(ring);
          const flame = new T.Mesh(new T.SphereGeometry(0.018, 10, 8), new T.MeshBasicMaterial({ color: '#ffc864', toneMapped: false })); flame.scale.y = 1.7; flame.position.y = 0.1; g.add(flame);
          const halo = new T.Sprite(new T.SpriteMaterial({ map: glow, color: '#ffb050', transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.7 })); halo.scale.setScalar(0.45); halo.position.y = 0.11; g.add(halo);
          const L = new T.PointLight('#ffb862', 1.8, 2.6, 1.8); L.position.y = 0.12; g.add(L);
          p.anim = (t) => { const f = 0.9 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.05; flame.scale.set(f, 1.7 * f, f); L.intensity = 1.8 * f; halo.material.opacity = 0.6 * f; };
        } else if (p.type === 'jar') {   // cam fanus içinde parlayan ateş böcekleri
          const jar = new T.Mesh(new T.CylinderGeometry(0.075, 0.08, 0.2, 20, 1, true), glass); jar.position.y = 0.1; g.add(jar);
          const bottom = new T.Mesh(new T.CircleGeometry(0.08, 20).rotateX(-Math.PI / 2), glass); bottom.position.y = 0.002; g.add(bottom);
          const cork = new T.Mesh(new T.CylinderGeometry(0.06, 0.055, 0.04, 16), new T.MeshStandardMaterial({ color: '#b08a5a', roughness: 1 })); cork.position.y = 0.215; g.add(cork);
          const leaf = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), new T.MeshStandardMaterial({ color: '#4a6a2a' })); leaf.scale.set(1, 0.3, 1); leaf.position.y = 0.015; g.add(leaf);
          const L = new T.PointLight('#d8ff8a', 0.5, 1.4, 1.8); L.position.y = 0.1; g.add(L);
          const fl = [0, 1, 2].map((k) => { const sp = new T.Sprite(new T.SpriteMaterial({ map: glow, color: '#e6ff9a', transparent: true, depthWrite: false, blending: T.AdditiveBlending })); sp.scale.setScalar(0.05); g.add(sp); return { sp, ph: k * 2.1 }; });
          p.anim = (t) => { let sum = 0; fl.forEach((f) => { const q = t * 0.9 + f.ph; f.sp.position.set(Math.sin(q * 1.3) * 0.045, 0.07 + Math.sin(q * 0.8) * 0.05 + 0.03, Math.cos(q * 1.1) * 0.045);
            const on = Math.max(0, Math.sin(t * 1.7 + f.ph * 1.9)); f.sp.material.opacity = 0.25 + on * 0.75; f.sp.scale.setScalar(0.035 + on * 0.03); sum += on; }); L.intensity = 0.2 + sum * 0.25; };
        } else if (p.type === 'terrarium') {   // yosun ve eğrelti otu teraryumu
          const base = new T.Mesh(new T.CylinderGeometry(0.1, 0.11, 0.03, 20), woodM); base.position.y = 0.015; g.add(base);
          const dome = new T.Mesh(new T.SphereGeometry(0.11, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), glass); dome.position.y = 0.06; g.add(dome);
          const moss = new T.Mesh(new T.SphereGeometry(0.09, 14, 8), new T.MeshStandardMaterial({ color: '#5a7a32', roughness: 1 })); moss.scale.set(1, 0.28, 1); moss.position.y = 0.035; g.add(moss);
          const fernM = new T.MeshStandardMaterial({ color: '#6a9a3a', side: T.DoubleSide, roughness: 0.8 });
          for (let k = 0; k < 6; k++) { const fr = new T.Mesh(new T.ConeGeometry(0.012, 0.11, 4), fernM); fr.position.set(Math.sin(k * 1.05) * 0.035, 0.09, Math.cos(k * 1.05) * 0.035); fr.rotation.set(Math.cos(k * 1.05) * 0.5, 0, -Math.sin(k * 1.05) * 0.5); g.add(fr); }
          const stone = new T.Mesh(new T.SphereGeometry(0.022, 8, 6), new T.MeshStandardMaterial({ color: '#8a8a80' })); stone.position.set(0.04, 0.05, -0.02); g.add(stone);
        } else if (p.type === 'hourglass') {   // eski kum saati: kum yavaşça akar
          for (const y of [0.012, 0.188]) { const cap = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.024, 16), woodM); cap.position.y = y; g.add(cap); }
          for (let k = 0; k < 3; k++) { const post = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, 0.17, 6), woodM); post.position.set(Math.sin(k * 2.09) * 0.05, 0.1, Math.cos(k * 2.09) * 0.05); g.add(post); }
          for (const sgn of [1, -1]) { const bulb = new T.Mesh(new T.SphereGeometry(0.042, 14, 10), glass); bulb.scale.y = 1.2; bulb.position.y = 0.1 + sgn * 0.042; g.add(bulb); }
          const sandM = new T.MeshStandardMaterial({ color: '#d8b070', roughness: 1 });
          const top = new T.Mesh(new T.ConeGeometry(0.032, 0.04, 12).rotateX(Math.PI), sandM); top.position.y = 0.13; g.add(top);
          const bot = new T.Mesh(new T.ConeGeometry(0.034, 0.03, 12), sandM); bot.position.y = 0.04; g.add(bot);
          const stream = new T.Mesh(new T.CylinderGeometry(0.0025, 0.0025, 0.06, 4), sandM); stream.position.y = 0.085; g.add(stream);
          p.anim = (t) => { const k = (t / 60) % 1; top.scale.setScalar(Math.max(0.05, 1 - k)); bot.scale.setScalar(0.3 + k * 0.7); };
        } else if (p.type === 'compass') {   // pirinç pusula: iğne hafifçe titreşir
          const g2 = new T.Group(); g2.rotation.x = -0.55; g2.position.y = 0.05; g.add(g2);
          const body = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.028, 28), brass); body.rotation.x = Math.PI / 2; g2.add(body);
          const fc = mkCanvas(128, 128), x = fc.getContext('2d'); x.fillStyle = '#efe2c0'; x.beginPath(); x.arc(64, 64, 62, 0, 6.283); x.fill();
          x.strokeStyle = '#6a4a20'; x.lineWidth = 2; for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283, l = k % 4 ? 8 : 16; x.beginPath(); x.moveTo(64 + Math.sin(a) * 58, 64 - Math.cos(a) * 58); x.lineTo(64 + Math.sin(a) * (58 - l), 64 - Math.cos(a) * (58 - l)); x.stroke(); }
          x.fillStyle = '#6a2a1a'; x.font = 'bold 18px Georgia'; x.textAlign = 'center'; x.fillText('K', 64, 34);
          const face = new T.Mesh(new T.CircleGeometry(0.066, 28), new T.MeshStandardMaterial({ map: texOf(fc), roughness: 0.6 })); face.position.z = 0.0145; g2.add(face);
          const needle = new T.Mesh(new T.ConeGeometry(0.008, 0.11, 4), new T.MeshStandardMaterial({ color: '#a8281a', metalness: 0.3 })); needle.position.z = 0.018; g2.add(needle);
          const ring = new T.Mesh(new T.TorusGeometry(0.075, 0.006, 6, 28), brass); ring.position.z = 0.012; g2.add(ring);
          p.anim = (t) => { needle.rotation.z = Math.sin(t * 0.7) * 0.12 + Math.sin(t * 3.1) * 0.03; };
        }
      }
      PROPS.forEach(buildProp);
      // üst rafın kenarında tüneyen, ara sıra göz kırpan küçük baykuş figürü
      let owl = null;
      if (window.Fauna) {
        const bay = bays[3], a = (bay.a0 + bay.a1) / 2 - 0.12, holder = new T.Group(); holder.rotation.y = a + Math.PI;
        holder.position.set(Math.sin(a) * (R - SD + 0.12), LEVELS[LEVELS.length - 1] + 0.64, Math.cos(a) * (R - SD + 0.12)); scene.add(holder);
        const o = window.Fauna.bird('owl'); o.root.scale.setScalar(1.15); holder.add(o.root);
        o.root.traverse((m) => { if (m.material) m.material.color = new T.Color(1, 1, 1); });
        owl = { o, look: 0, lookT: 2 };
      }

      // ---------- toz zerreleri ve vuruş tozu ----------
      const NM = 420, mGeo = new T.BufferGeometry(), mPos = new Float32Array(NM * 3), MOTES = [];
      const r0 = rng(5);
      for (let i = 0; i < NM; i++) { const a = r0() * 6.283, rr = Math.sqrt(r0()) * (R - 0.5); MOTES.push({ x: Math.sin(a) * rr, y: r0() * H, z: Math.cos(a) * rr, ph: r0() * 6, sp: 0.02 + r0() * 0.05 }); }
      mGeo.setAttribute('position', new T.BufferAttribute(mPos, 3));
      const motes = new T.Points(mGeo, new T.PointsMaterial({ map: glow, color: '#ffd59a', size: 0.035, transparent: true, depthWrite: false, opacity: 0.55, blending: T.AdditiveBlending })); motes.frustumCulled = false; scene.add(motes);
      let nMotes = NM;
      const applyQuality = (p) => { renderer.setPixelRatio(EQ ? EQ.dpr(1.5) : 1); resize(); nMotes = Math.max(60, Math.round(NM * (p ? p.particles : 1))); mGeo.setDrawRange(0, nMotes); };
      if (EQ) { applyQuality(EQ.p); EQ.on(applyQuality); }
      const ND = 160, dGeo = new T.BufferGeometry(), dPos = new Float32Array(ND * 3), DUST = Array.from({ length: ND }, () => ({ life: 0, p: V(), v: V() }));
      dGeo.setAttribute('position', new T.BufferAttribute(dPos, 3));
      const dust = new T.Points(dGeo, new T.PointsMaterial({ map: glow, color: '#d8b890', size: 0.07, transparent: true, depthWrite: false, opacity: 0.8 })); dust.frustumCulled = false; scene.add(dust);
      let dustI = 0;
      const puff = (p, n) => { for (let k = 0; k < n; k++) { const d = DUST[dustI++ % ND]; d.life = 1; d.p.copy(p); d.v.set((Math.random() - 0.5) * 0.6, Math.random() * 0.35, (Math.random() - 0.5) * 0.6); } };

      // ---------- kamera: odanın ortasından 360° ----------
      const look = { yaw: 0, pitch: -0.05, vy: 0, vp: 0, zoom: 0, zoomT: 0 };
      let enterT = 1, exiting = false, active = false, shakeCam = 0;
      const camBase = V(0, EYE, 0), dir = V();
      function updateCam(dt) {
        look.yaw += look.vy; look.pitch = clamp(look.pitch + look.vp, -1.53, 1.45);   // zeminden kubbeye
        look.vy *= Math.exp(-dt * 7); look.vp *= Math.exp(-dt * 7);
        look.zoom = lerp(look.zoom, look.zoomT, 1 - Math.exp(-dt * 6));
        dir.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch));
        // giriş: kapıdan (kovuktan) süzülerek odanın ortasına
        const k = smooth(enterT), door = V(0, EYE + 0.1, -R + 0.15);
        cam.position.copy(door).lerp(camBase, k).addScaledVector(dir, look.zoom * 1.7);
        if (shakeCam > 0) { shakeCam = Math.max(0, shakeCam - dt * 2.5); cam.position.x += (Math.random() - 0.5) * shakeCam * 0.03; cam.position.y += (Math.random() - 0.5) * shakeCam * 0.03; }
        cam.fov = lerp(66, 50, look.zoom) + (1 - k) * 8; cam.updateProjectionMatrix();
        cam.lookAt(tmp.copy(cam.position).add(dir));
      }

      // ---------- etkileşim ----------
      const ray = new T.Raycaster(), mouse = new T.Vector2(-9, -9);
      let down = null, drag = null, hover = null, lastClick = 0;
      const pickables = () => [decor, ...realMeshes];
      function hitAt(cx, cy, list) {
        const b = cv.getBoundingClientRect(); mouse.set(((cx - b.left) / b.width) * 2 - 1, -((cy - b.top) / b.height) * 2 + 1);
        ray.setFromCamera(mouse, cam); return ray.intersectObjects(list || pickables(), false)[0];
      }
      // çıkış kemeri: fare ışını kapı düzlemini kemerin içinde kesiyor mu (önünde kitap/raf yoksa)
      const doorPt = V();
      function doorHit(h) {
        const r = ray.ray; if (Math.abs(r.direction.z) < 1e-4) return false;
        const t = (chordZ - r.origin.z) / r.direction.z; if (t <= 0.2) return false;
        if (h && h.distance < t - 0.05) return false;
        doorPt.copy(r.origin).addScaledVector(r.direction, t);
        const u = doorPt.x / (AW / 2); if (Math.abs(u) >= 1 || doorPt.y < 0) return false;
        return doorPt.y < AH * Math.pow(Math.sqrt(1 - u * u), 0.7);
      }
      let hoverDoor = false, doorK = 0;
      const doorBase = new T.Color('#ffe8c0'), doorLightBase = new T.Color('#ffe2b8');
      const bookOf = (h) => (!h ? null : h.object === decor ? books[bookIndexByInst[h.instanceId]] : h.object.userData.book);
      const bookIndexByInst = []; books.forEach((b, i) => { if (!b.real) bookIndexByInst[b.idx] = i; });
      function rayCylinder(rad) {   // fare ışınının kitap çemberiyle kesişimi (kamera içeride)
        const o = ray.ray.origin, d = ray.ray.direction, a = d.x * d.x + d.z * d.z, bq = 2 * (o.x * d.x + o.z * d.z), c = o.x * o.x + o.z * o.z - rad * rad;
        const disc = bq * bq - 4 * a * c; if (disc < 0 || a < 1e-6) return null; const t = (-bq + Math.sqrt(disc)) / (2 * a); return o.clone().addScaledVector(d, t);
      }
      function dropTarget(b) {   // sürüklenen kitabın bırakılacağı raf ve sıra
        const P = rayCylinder(RB); if (!P) return null;
        let a = Math.atan2(P.x, P.z); while (a < a0All) a += Math.PI * 2;
        const bay = bays.findIndex((B) => a >= B.a0 - 0.02 && a <= B.a1 + 0.02); if (bay < 0) return { P };
        let li = -1, best = 9; LEVELS.forEach((y, i) => { const dd = Math.abs(P.y - (y + 0.22)); if (dd < best && P.y > y - 0.12) { best = dd; li = i; } });
        if (li < 0 || best > 0.45) return { P };
        const sh = shelves.find((s) => s.li === li && s.bi === bay), s = (a - sh.a0) * RB;
        let acc = 0.04, at = sh.items.length; for (let i = 0; i < sh.items.length; i++) { if (acc + sh.items[i].w / 2 > s) { at = i; break; } acc += sh.items[i].w; }
        const lay = layout(sh, { at, w: b.w });
        if (!lay) { layout(sh); return { P }; }
        const slot = lay.find((o) => o.it.slot);
        return { P, sh, at, a: slot.a };
      }
      let preview = null;   // şu an geçici boşluk açılmış raf
      function clearPreview() { if (preview) { layout(preview); preview = null; } }

      cv.addEventListener('pointerdown', (ev) => {
        if (!active || exiting || ev.button === 2) return;
        ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
        if (ev.button === 1) { down = { mode: 'look', x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false }; cv.style.cursor = 'move'; return; }   // orta tuş: etrafa bak
        if (ev.button !== 0) return;
        const h = hitAt(ev.clientX, ev.clientY), b = bookOf(h);   // sol tuş: yalnız kitaplar
        down = { mode: 'book', x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, b, moved: false, t: performance.now() };
      });
      cv.addEventListener('pointermove', (ev) => {
        const b0 = cv.getBoundingClientRect(); mouse.set(((ev.clientX - b0.left) / b0.width) * 2 - 1, -((ev.clientY - b0.top) / b0.height) * 2 + 1);
        label.style.transform = `translate(${ev.clientX - b0.left + 16}px, ${ev.clientY - b0.top + 14}px)`;
        if (!down) return;
        const dx = ev.clientX - down.lx, dy = ev.clientY - down.ly; down.lx = ev.clientX; down.ly = ev.clientY;
        if (!down.moved && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) {
          down.moved = true;
          if (down.mode === 'book' && down.b && (down.b.state === 'shelf' || down.b.state === 'floor')) {   // kitabı tut
            const b = down.b; if (b === selected) select(null); if (b.state === 'shelf') removeFromShelf(b); b.state = 'drag'; drag = { b, lift: 0 }; cv.style.cursor = 'grabbing';
          }
        }
        if (down.mode === 'look' && down.moved) { look.vy = -dx * 0.0042; look.vp = dy * 0.0034; }
      });
      const endDown = (ev) => {
        if (!down) return;
        const d0 = down; down = null; cv.style.cursor = '';
        if (drag) {   // bırak: rafa yerleş ya da yere düş
          const b = drag.b; drag = null;
          ray.setFromCamera(mouse, cam); const tgt = dropTarget(b); clearPreview();
          if (tgt && tgt.sh && insertAt(tgt.sh, tgt.at, b)) { b.state = 'shelf'; b.settle = 0; }
          else { b.state = 'fall'; b.vel.set(0, 0, 0); b.ang.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2); }
          save(); return;
        }
        if (d0.mode === 'look' || d0.moved) return;
        const b = d0.b;
        if (!b) {   // boşluğa tık: çıkış kemerine tıklandıysa ağaca dön
          if (enterT >= 1 && doorHit(hitAt(ev.clientX, ev.clientY))) { startExit(); return; }
          select(null); return;
        }
        if (b.state === 'floor') { if (firstFit(b)) { b.state = 'shelf'; b.settle = 0; save(); } return; }   // yerdeki kitabı rafa geri koy
        if (b.state === 'shelf') {
          if (b.real) { if (selected === b) openSel(); else select(b); }
          else { b.shake = 0.03; b.shakeT = 0; select(null); }
        }
      };
      let clickT = 0, selected = null;
      const card = wrap.querySelector('.hl-card');
      function select(b) {
        if (selected) selected.pullT = 0;
        selected = b; card.classList.toggle('show', !!b); if (!b) return;
        b.pullT = 0.12; const d = b.data;
        card.querySelector('.hl-cv').style.backgroundImage = d.cover ? `url("${d.cover}")` : ''; card.querySelector('.hl-cv').style.backgroundColor = d.color || '#7a3b2a';
        card.querySelector('b').textContent = d.title; card.querySelector('.hl-au').textContent = d.author || '';
        card.querySelector('.hl-meta').textContent = d.kind === 'project' ? 'Devam eden proje' : [d.own ? 'ERME baskısı · tamamlandı ✓' : '', d.pages ? `${d.pages} sayfa` : '', d.own ? '' : d.publisher || ''].filter(Boolean).join(' · ');
        card.querySelector('button').textContent = d.kind === 'project' ? 'Düzenlemeye devam et →' : 'Kitabı aç →';
      }
      const openSel = () => { if (selected && opts.onOpen) opts.onOpen(selected.data); };
      card.querySelector('button').addEventListener('click', openSel);
      cv.addEventListener('pointerup', endDown); cv.addEventListener('pointercancel', endDown);
      cv.addEventListener('pointerleave', () => { if (!down) mouse.set(-9, -9); });
      cv.addEventListener('wheel', (ev) => { ev.preventDefault(); look.zoomT = clamp(look.zoomT - ev.deltaY * 0.0012, 0, 1); }, { passive: false });
      const knockAt = (cx, cy) => {
        const h = hitAt(cx, cy, [...pickables(), ...shelfMeshes, ...ribs, wall, floor]); if (!h) return;
        const P = h.point; puff(P, 26); shakeCam = 0.6;
        const near = [];
        for (const b of books) {
          if (b.state !== 'shelf') continue;
          b.pos.distanceTo(P) < 1.1 && (b.shake = (1 - b.pos.distanceTo(P) / 1.1) * 0.07, b.shakeT = 0);
          const dd = b.pos.distanceTo(P); if (dd < 0.75) near.push([dd, b]);
        }
        near.sort((x, y) => x[0] - y[0]);
        const n = Math.min(near.length, 2 + (Math.random() < 0.5 ? 1 : 0));
        for (let k = 0; k < n; k++) {
          const b = near[k][1]; if (b === selected) select(null); removeFromShelf(b); b.state = 'fall';
          const toC = V(-b.pos.x, 0, -b.pos.z).normalize(), vy = 0.6 + Math.random() * 0.5, y0 = b.pos.y - b.h * 0.3;
          const tf = (vy + Math.sqrt(vy * vy + 2 * 9.8 * Math.max(0.05, y0))) / 9.8;           // yere iniş süresi
          const land = R - (1.05 + Math.random() * 0.45), travel = Math.hypot(b.pos.x, b.pos.z) - land;   // duvardan ~1-1.5 birim içeri
          b.vel.copy(toC).multiplyScalar(Math.max(0.6, travel / tf * 0.85)).add(V(0, vy, 0));
          b.ang.crossVectors(UP, toC).multiplyScalar(3.5 + Math.random() * 3).add(V(0, (Math.random() - 0.5) * 2, 0));
          b.delay = k * 0.07;
        }
        save();
      };
      // orta tuşun tarayıcı oto-kaydırma simgesini engelle
      cv.addEventListener('mousedown', (ev) => { if (ev.button === 1) ev.preventDefault(); });
      cv.addEventListener('auxclick', (ev) => { if (ev.button === 1) ev.preventDefault(); });
      cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (active && !exiting) knockAt(ev.clientX, ev.clientY); });

      // ---------- fizik: devrilme, düşüş, yere yerleşme ----------
      const corners = []; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) corners.push(V(sx, sy, sz));
      const floorAt = (b, x, z) => {   // yerde üst üste yığılma
        let y = FLOOR;
        // yalnız daha önce yere inmiş kitapların üstüne yığılır (karşılıklı yükselme olmasın)
        for (const o of books) if (o !== b && o.state === 'floor' && (o.landN || 0) < (b.landN ?? Infinity) && Math.hypot(o.pos.x - x, o.pos.z - z) < Math.max(o.h, b.h) * 0.45) y = Math.max(y, o.pos.y + o.w / 2);
        return y;
      };
      function lyingQuat(b, out) {   // kapağı üstte yatık duruş: yerel x (kalınlık) dikey, sırt yatay
        const ax = V(1, 0, 0).applyQuaternion(b.q), ay = V(0, 1, 0).applyQuaternion(b.q);
        const X = V(0, ax.y >= 0 ? 1 : -1, 0), Y = V(ay.x, 0, ay.z); if (Y.lengthSq() < 1e-4) Y.set(1, 0, 0); Y.normalize();
        const Z = V().crossVectors(X, Y); out.setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z)); return out;
      }
      const dq = new T.Quaternion(), lq = new T.Quaternion(); let landCount = 0;
      function stepBook(b, dt, t) {
        if (b.state === 'shelf') {
          b.pull = lerp(b.pull, Math.max(hover === b ? 0.07 : 0, b.pullT), 1 - Math.exp(-dt * 10));
          b.shakeT += dt; const sk = b.shakeT < 2 ? b.shake * Math.exp(-b.shakeT * 5) * Math.sin(b.shakeT * 28) : 0; b.lean = sk;
          shelfPose(b, b.ta, b.ty, b.pull, tmp, lq);
          const k = b.settle === undefined || b.settle >= 1 ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 7);
          if (b.settle !== undefined && b.settle < 1) b.settle += dt * 1.6;
          // raftan rafa geçerken hafif bir yay çizer
          if (b.pos.distanceToSquared(tmp) > 1e-7 || sk) { const far = b.pos.distanceTo(tmp); b.pos.lerp(tmp, k); if (far > 0.25) b.pos.y += far * 0.05; b.q.slerp(lq, k); b.dirty = true; }
          return;
        }
        if (b.state === 'drag') {
          const P = rayCylinder(RB - 0.45) || cam.position.clone().addScaledVector(ray.ray.direction, 1.6);
          const tgt = dropTarget(b);
          if (tgt?.sh) { if (preview !== tgt.sh) clearPreview(); preview = tgt.sh; } else clearPreview();
          tmp.copy(P); tmp.y = clamp(tmp.y, 0.3, H - 0.4);
          const vel = tmp2.copy(tmp).sub(b.pos);
          b.pos.lerp(tmp, 1 - Math.exp(-dt * 14));
          const a = tgt?.a ?? Math.atan2(P.x, P.z);
          e.set(clamp(-vel.y * 3, -0.4, 0.4), a + Math.PI, clamp(vel.x * 2, -0.35, 0.35), 'YXZ'); lq.setFromEuler(e); b.q.slerp(lq, 1 - Math.exp(-dt * 10)); b.dirty = true;
          return;
        }
        if (b.state === 'fall') {
          if (b.delay > 0) { b.delay -= dt; return; }
          b.vel.y -= 9.8 * dt; b.pos.addScaledVector(b.vel, dt);
          const w = b.ang.length(); if (w > 1e-5) { dq.setFromAxisAngle(tmp.copy(b.ang).divideScalar(w), w * dt); b.q.premultiply(dq); }
          const rr = Math.hypot(b.pos.x, b.pos.z); let lim = R - 0.25 - SD * (b.pos.y > LEVELS[0] ? 1 : 0.2);
          if (b.pos.y < LEVELS[0] + 0.2 && rr > R - 0.85) { lim = Math.min(lim, R - 0.85); }
          if (rr > lim) { b.pos.x *= lim / rr; b.pos.z *= lim / rr; const n = V(b.pos.x, 0, b.pos.z).normalize(), vn = b.vel.dot(n); if (vn > 0) b.vel.addScaledVector(n, -1.4 * vn); }
          let minY = 9; for (const c of corners) { tmp.set(c.x * b.w, c.y * b.h, c.z * b.d).applyQuaternion(b.q).add(b.pos); minY = Math.min(minY, tmp.y); }
          const fy = floorAt(b, b.pos.x, b.pos.z);
          if (minY <= fy) { b.state = 'land'; b.land = 0; b.fromQ = b.q.clone(); lyingQuat(b, b.toQ = new T.Quaternion()); b.fy = fy; b.slide = V(b.vel.x, 0, b.vel.z).multiplyScalar(0.3); b.bounce = Math.min(0.16, Math.abs(b.vel.y) * 0.04 + 0.05); puff(V(b.pos.x, fy + 0.02, b.pos.z), 8); }
          b.dirty = true; return;
        }
        if (b.state === 'land') {   // yere değince küçük bir sekme ile yatar
          b.land += dt / 0.55; const k = smooth(b.land);
          b.q.copy(b.fromQ).slerp(b.toQ, k);
          b.pos.addScaledVector(b.slide, dt); b.slide.multiplyScalar(Math.exp(-dt * 6));
          b.pos.y = b.fy + b.w / 2 + Math.abs(Math.sin(k * Math.PI * 2.5)) * b.bounce * (1 - k) * (1 - k);   // zeminin üst yüzeyinde, iki küçük sekme
          { const rr = Math.hypot(b.pos.x, b.pos.z), mx = R - 0.85; if (rr > mx) { b.pos.x *= mx / rr; b.pos.z *= mx / rr; } }
          if (b.land >= 1) { b.state = 'floor'; b.landN = ++landCount; save(); }
          b.dirty = true; return;
        }
        if (b.state === 'floor') {
          const lift = hover === b ? 0.03 : 0; const ty = Math.min(0.6, floorAt(b, b.pos.x, b.pos.z)) + b.w / 2 + lift;
          if (Math.abs(b.pos.y - ty) > 1e-4) { b.pos.y = lerp(b.pos.y, ty, 1 - Math.exp(-dt * 10)); b.dirty = true; }
        }
      }
      function writeBook(b) {
        if (!b.dirty) return; b.dirty = false;
        sv.set(b.w, b.h, b.d);
        if (b.real) { b.mesh.position.copy(b.pos); b.mesh.quaternion.copy(b.q); b.mesh.scale.copy(sv); }
        else { m4.compose(b.pos, b.q, sv); decor.setMatrixAt(b.idx, m4); decor.instanceMatrix.needsUpdate = true; }
      }
      function stepProps(dt, t, snap) {
        for (const p of PROPS) { if (p.ta === undefined) continue; tmp.set(Math.sin(p.ta) * (RB - 0.02), p.ty + 0.002, Math.cos(p.ta) * (RB - 0.02));
          if (snap) p.g.position.copy(tmp); else p.g.position.lerp(tmp, 1 - Math.exp(-dt * 8)); p.g.rotation.y = p.ta + Math.PI; p.anim && p.anim(t); }
        if (owl) { owl.lookT -= dt; if (owl.lookT < 0) { owl.look = (Math.random() - 0.5) * 2.2; owl.lookT = 2 + Math.random() * 4; } owl.o.animate(dt, t, 0, { yaw: owl.look }); }
      }
      function snapAll() { for (const sh of shelves) layout(sh); stepProps(0, 0, true); for (const b of books) if (b.state === 'shelf') { shelfPose(b, b.ta, b.ty, 0, b.pos, b.q); b.dirty = true; } }

      // ---------- döngü ----------
      let raf = 0, last = performance.now(), time = 0;
      function loop(now) {
        raf = 0; if (!active) return;
        if (EQ) EQ.frame(now);
        const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000)); last = now; time += dt;
        enterT = exiting ? Math.max(0, enterT - dt / 0.7) : Math.min(1, enterT + dt / 1.6);
        updateCam(dt);
        if (mouse.x > -2) { const [lx, ly] = toClient(mouse), bb = cv.getBoundingClientRect(); label.style.transform = `translate(${lx - bb.left + 16}px, ${ly - bb.top + 14}px)`; }
        if (!down && mouse.x > -2) {   // üzerine gelinen kitap
          const h = hitAt(...toClient(mouse)), b = bookOf(h);
          hover = b && (b.state === 'shelf' || b.state === 'floor') ? b : null;
          hoverDoor = !hover && enterT >= 1 && !exiting && doorHit(h);
          cv.style.cursor = hover ? 'grab' : hoverDoor ? 'pointer' : '';
          if (hover && hover.real) { label.innerHTML = `<b>${esc(hover.data.title)}</b>${hover.data.author ? `<span>${esc(hover.data.author)}</span>` : ''}<em>${hover.state === 'floor' ? 'tıkla: rafa koy · tut: taşı' : hover.data.kind === 'project' ? 'tıkla: düzenlemeye devam et' : 'tıkla: aç'}</em>`; label.classList.add('show'); }
          else if (hover && hover.state === 'floor') { label.innerHTML = '<em>tıkla: rafa geri koy</em>'; label.classList.add('show'); }
          else if (hoverDoor) { label.innerHTML = '<b>Dışarı Çık</b><em>tıkla: Ağaca Dön</em>'; label.classList.add('show'); }
          else label.classList.remove('show');
        } else { hoverDoor = false; if (drag) { label.classList.remove('show'); hover = null; } }
        // kapı üzerine gelinince hafifçe parlar
        doorK = lerp(doorK, hoverDoor ? 1 : 0, 1 - Math.exp(-dt * 8));
        doorGlowMat.color.copy(doorBase).multiplyScalar(1 + doorK * 0.45); doorLight.color.copy(doorLightBase); doorLight.intensity = 3.5 * (1 + doorK * 0.9);
        ray.setFromCamera(mouse, cam);
        for (const b of books) { stepBook(b, dt, time); writeBook(b); }
        stepProps(dt, time, false); shaftMat.uniforms.uT.value = time;
        for (const L of lamps) { L.L.intensity = L.base * (0.94 + Math.sin(time * 2.3 + L.ph) * 0.03 + Math.sin(time * 7.1 + L.ph) * 0.02); L.g.rotation.z = Math.sin(time * 0.6 + L.ph) * 0.03; }
        for (let i = 0; i < nMotes; i++) { const m = MOTES[i]; m.y += m.sp * dt; if (m.y > H) m.y = 0; mPos[i * 3] = m.x + Math.sin(time * 0.3 + m.ph) * 0.25; mPos[i * 3 + 1] = m.y; mPos[i * 3 + 2] = m.z + Math.cos(time * 0.25 + m.ph) * 0.25; }
        mGeo.attributes.position.needsUpdate = true;
        for (let i = 0; i < ND; i++) { const d = DUST[i]; if (d.life > 0) { d.life -= dt / 1.4; d.v.y -= 0.15 * dt; d.v.multiplyScalar(Math.exp(-dt * 1.5)); d.p.addScaledVector(d.v, dt); } dPos[i * 3] = d.p.x; dPos[i * 3 + 1] = d.life > 0 ? d.p.y : -99; dPos[i * 3 + 2] = d.p.z; }
        dGeo.attributes.position.needsUpdate = true;
        renderer.render(scene, cam);
        if (exiting && enterT <= 0) { finishExit(); return; }
        raf = requestAnimationFrame(loop);
      }
      const toClient = (m) => { const b = cv.getBoundingClientRect(); return [b.left + (m.x + 1) / 2 * b.width, b.top + (1 - m.y) / 2 * b.height]; };
      const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const DOOR_COL = { ilkbahar: '#eef6ee', yaz: '#fff1cc', sonbahar: '#e8b67a', kis: '#9fb4dc' };
      function startExit() { if (!active || exiting) return; exiting = true; clearPreview(); select(null); label.classList.remove('show'); wrap.classList.remove('in'); }
      function finishExit() { active = false; wrap.classList.remove('show', 'in'); label.classList.remove('show'); opts.onExit && opts.onExit(); }

      snapAll();
      return {
        get active() { return active; },
        setBooks(list) { select(null); clearReal(); for (const d of list) makeReal(d); restore(); for (const b of books) if (b.real && b.state === 'shelf' && !b.shelf) firstFit(b); snapAll(); save(); },
        enter(list, season, focusId) {
          this.setBooks(list);
          doorBase.set(DOOR_COL[season] || '#ffe8c0'); doorLightBase.set(DOOR_COL[season] || '#ffe2b8'); doorK = 0; hoverDoor = false;
          doorGlowMat.color.copy(doorBase); doorLight.color.copy(doorLightBase);
          const SH = { ilkbahar: ['#fff4d6', 10], yaz: ['#ffcf6a', 16], sonbahar: ['#f0b070', 9], kis: ['#9cb8f0', 8] }[season] || ['#ffd98a', 12];
          skyMat.color.set(SH[0]); shaftMat.uniforms.uCol.value.set(SH[0]); shaftSpot.color.set(SH[0]); shaftSpot.intensity = SH[1];
          look.yaw = 0; look.pitch = -0.05; look.zoom = look.zoomT = 0; enterT = 0; exiting = false; active = true;
          resize(); wrap.classList.add('show'); void wrap.offsetWidth; wrap.classList.add('in');
          setTimeout(() => opts.onCovered && opts.onCovered(), 650);
          last = performance.now(); if (!raf) raf = requestAnimationFrame(loop);
          save();
          if (focusId) setTimeout(() => this.focus(focusId), 900);
        },
        // kitaba dön, hafifçe yaklaş ve kartını aç (5. adımdan "Kovuk Kütüphanesinde Gör")
        focus(id) {
          const b = byId.get(id); if (!b || !b.real || !active) return;
          if (b.state !== 'shelf' && b.state !== 'floor') return;
          const p = b.mesh.position;
          look.yaw = Math.atan2(p.x, p.z); look.pitch = clamp(Math.atan2(p.y - EYE, Math.hypot(p.x, p.z)), -1.2, 1.0);
          look.vy = look.vp = 0; look.zoomT = 0.35;
          setTimeout(() => { if (active && !exiting) select(b); }, 450);
        },
        exit() { startExit(); },
        dispose() { active = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); },
      };
    },
  };
})();
