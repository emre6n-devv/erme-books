// scenery3d.js - Hayat Ağacı'nın manzarası (Three.js r158 + fauna2d.js).
// Coğrafya dört mevsim aynı yerde durur: solda kayalık yamaç, içi sıcak ışıklı mağara ve şelale;
// şelaleden akan dere sağ öndeki göleti besler; ufukta deniz ve yelkenli; köşelerde flu eğrelti otları.
// Mevsimle değişenler: su (kışın şelale buz sarkıtına, gölet kenardan ortaya buza döner), bitki renkleri,
// hava (yağmur, şimşek, gökkuşağı, sis) ve hayvan aileleri.
//   window.Scenery.create({ scene, r, hillH, glowTex, hollow, limbs, snowU }) -> { setSeason, update, env }
(function () {
  const T = window.THREE, F = window.Fauna;
  if (!T || !F) return;
  const DIM = { value: F.TINT || new T.Color(1, 1, 1) };   // gece/fırtına karartması: yapraklar, su, hayvanlar, sprite'lar
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const texOf = (c) => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; };

  // ---------- su: dalgacık, gökyüzü yansıması, halkalar, kenardan donma ----------
  function waterMat(deep, shallow, opts = {}) {
    return new T.ShaderMaterial({
      transparent: true, fog: true,
      uniforms: Object.assign(T.UniformsUtils.clone(T.UniformsLib.fog), {
        uTime: { value: 0 }, uDeep: { value: new T.Color(deep) }, uShallow: { value: new T.Color(shallow) }, uSky: { value: new T.Color('#f3efe4') },
        uOp: { value: 1 }, uIce: { value: 0 }, uFlow: { value: opts.flow ?? 0 }, uScale: { value: opts.scale ?? 1 }, uRadial: { value: opts.radial ? 1 : 0 }, uRing: { value: opts.rings ? 1 : 0 },
      }, { uDim: DIM }),
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 uDim; uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform float uOp; uniform float uIce; uniform float uFlow; uniform float uScale; uniform float uRadial; uniform float uRing;
        varying vec2 vUv; varying vec3 vW;
        #include <fog_pars_fragment>
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wave(vec2 p){ return sin(p.x*1.7 + uTime*1.1) * 0.5 + sin(p.y*2.3 - uTime*0.9 + p.x*0.7) * 0.35 + sin((p.x+p.y)*4.1 + uTime*1.7) * 0.15; }
        void main(){
          vec2 p = vW.xz * uScale + vec2(uFlow * uTime, 0.0);
          float w = wave(p * 2.0);
          float edge = uRadial > 0.5 ? 1.0 - length(vUv - 0.5) * 2.0 : (uRadial < -0.5 ? 1.0 : 1.0 - abs(vUv.y - 0.5) * 2.0);
          vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 0.7, edge) * 0.85 + w * 0.06);
          c = mix(c, uSky, 0.18 + 0.1 * w);
          if (uRing > 0.5) { for (int i = 0; i < 4; i++) { float fi = float(i); float cyc = floor(uTime*0.25 + fi*0.37);
            vec2 cc = vec2(h21(vec2(fi, cyc)), h21(vec2(fi+7.0, cyc))) - 0.5;
            float ph = fract(uTime*0.25 + fi*0.37); float d = length((vUv - 0.5 - cc*0.6) * vec2(2.0, 1.0)); c += vec3(1.0) * smoothstep(0.012, 0.0, abs(d - ph*0.35)) * (1.0 - ph) * 0.35; } }
          float glint = pow(max(0.0, sin(p.x * 9.0 + uTime * 2.0) * sin(p.y * 11.0 - uTime * 1.6)), 18.0);
          c += vec3(1.0, 0.97, 0.9) * glint * 0.8;
          float ice = smoothstep(uIce - 0.08, uIce + 0.02, 1.0 - edge) * step(0.01, uIce);
          ice = max(ice, step(0.97, uIce));
          vec3 iceC = mix(vec3(0.86, 0.93, 0.98), vec3(0.97, 0.99, 1.0), h21(floor(vW.xz * 6.0)) * 0.5);
          float crack = smoothstep(0.03, 0.0, abs(fract(vW.x * 1.3 + vW.z * 0.7 + sin(vW.z * 3.0) * 0.2) - 0.5)) * 0.25;
          c = mix(c, iceC - crack, ice);
          float a = uOp * mix(0.86 + 0.14 * smoothstep(0.0, 0.2, edge), 1.0, ice) * (uRadial < -0.5 ? 1.0 : smoothstep(0.0, 0.06, edge));
          gl_FragColor = vec4(c * uDim, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
  }
  // kar ve yosun: yukarı bakan yüzeylerde (kaya, taş, kıyı)
  function snowPatch(mat, snowU, mossAmt = 0.6) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snowU;
      sh.vertexShader = 'varying vec3 vWN2; varying vec3 vWP2;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWN2 = normalize(mat3(modelMatrix) * objectNormal); vWP2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uSnow; varying vec3 vWN2; varying vec3 vWP2;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float nz = fract(sin(dot(floor(vWP2.xz * 7.0), vec2(12.9898, 78.233))) * 43758.5453);
        float mossK = smoothstep(0.35, 0.8, vWN2.y) * (0.55 + 0.45 * nz) * ${mossAmt.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.43, 0.2), mossK * (1.0 - uSnow));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), smoothstep(0.3, 0.65, vWN2.y + nz * 0.15) * uSnow);`);
    };
    return mat;
  }
  function rockMesh(r, size, col, seed, snowU) {
    const g = new T.SphereGeometry(1, 64, 40), p = g.attributes.position, v = V();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 2) * Math.sin(v.z * 3.3 + seed * 3) + 0.35 * Math.sin(v.y * 9 + seed) * Math.sin(v.x * 7);
      v.multiplyScalar(1 + n * 0.2); if (v.y > 0.3) v.x *= 1 - (v.y - 0.3) * 0.15;
      v.y = Math.max(v.y, -0.25) + Math.round(v.y * 5) * 0.012;   // katmanlı, hafif basamaklı yamaç
      p.setXYZ(i, v.x * size.x, v.y * size.y, v.z * size.z);
    }
    g.computeVertexNormals();
    const m = new T.Mesh(g, snowPatch(new T.MeshStandardMaterial({ color: col, roughness: 0.95 }), snowU, 0.7));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  // ---------- elle boyanmış dokular ----------
  const pineTex = [];
  function pineTexture(k) {
    if (pineTex[k]) return pineTex[k];
    const W = 256, H = 512, c = mkCanvas(W, H), x = c.getContext('2d'); let sd = 17 + k * 31; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.fillStyle = '#4a3628'; x.fillRect(W / 2 - 9, H - 90, 18, 90);
    for (let i = 0; i < 7; i++) {
      const y = H - 70 - i * 58, w = (W * 0.48) * (1 - i / 7.6) + 10, h = 92;
      const g = x.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, '#41664f'); g.addColorStop(1, '#1f3a2c');
      x.fillStyle = g; x.beginPath(); x.moveTo(W / 2, y - h);
      x.quadraticCurveTo(W / 2 + w * 0.5, y - h * 0.45, W / 2 + w, y - 4); for (let j = 0; j < 6; j++) x.lineTo(W / 2 + w - j * (w / 3) - rr() * 8, y + (j % 2 ? -6 : 6));
      x.lineTo(W / 2 - w, y - 4); x.quadraticCurveTo(W / 2 - w * 0.5, y - h * 0.45, W / 2, y - h); x.fill();
      x.strokeStyle = 'rgba(15,30,22,.45)'; x.lineWidth = 2; x.stroke();
      x.fillStyle = 'rgba(250,252,255,.96)'; x.beginPath(); x.moveTo(W / 2, y - h + 4);
      x.quadraticCurveTo(W / 2 + w * 0.45, y - h * 0.5, W / 2 + w * 0.92, y - 16 - rr() * 6); x.quadraticCurveTo(W / 2 + w * 0.4, y - h * 0.32, W / 2, y - h * 0.52);
      x.quadraticCurveTo(W / 2 - w * 0.4, y - h * 0.32, W / 2 - w * 0.92, y - 16 - rr() * 6); x.quadraticCurveTo(W / 2 - w * 0.45, y - h * 0.5, W / 2, y - h + 4); x.fill();
      x.strokeStyle = 'rgba(150,175,205,.5)'; x.lineWidth = 1.5; x.stroke();
    }
    return (pineTex[k] = texOf(c));
  }
  // ön plan: eğrelti otu, çimen tutamı, yosunlu taş (alan derinliği için önceden bulanık)
  function fernTexture(seed, blur) {
    const W = 512, H = 640, c = mkCanvas(W, H), x = c.getContext('2d'); let sd = seed; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.filter = `blur(${blur}px)`;
    for (let f = 0; f < 7; f++) {
      const bx = W * (0.3 + rr() * 0.4), ang = -Math.PI / 2 + (rr() - 0.5) * 1.6, len = H * (0.55 + rr() * 0.4);
      const ex = bx + Math.cos(ang) * len, ey = H + Math.sin(ang) * len, cx = bx + Math.cos(ang) * len * 0.5 + (ex > bx ? 60 : -60), cy = H + Math.sin(ang) * len * 0.6;
      const col = ['#3f6a36', '#4f7c3e', '#365c2e', '#5c8a44'][f % 4];
      x.strokeStyle = '#2e4a26'; x.lineWidth = 6; x.beginPath(); x.moveTo(bx, H); x.quadraticCurveTo(cx, cy, ex, ey); x.stroke();
      for (let k = 2; k < 26; k++) {
        const t = k / 26, px = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * ex, py = (1 - t) * (1 - t) * H + 2 * (1 - t) * t * cy + t * t * ey;
        const tx = 2 * (1 - t) * (cx - bx) + 2 * t * (ex - cx), ty = 2 * (1 - t) * (cy - H) + 2 * t * (ey - cy), tl = Math.hypot(tx, ty);
        const nx = -ty / tl, ny = tx / tl, l = 70 * (1 - t * 0.85);
        for (const s of [-1, 1]) {
          x.fillStyle = col; x.beginPath(); x.moveTo(px, py);
          x.quadraticCurveTo(px + nx * s * l * 0.6 + tx / tl * 8, py + ny * s * l * 0.6 + ty / tl * 8, px + nx * s * l + tx / tl * 14, py + ny * s * l + ty / tl * 14);
          x.quadraticCurveTo(px + nx * s * l * 0.4 - tx / tl * 4, py + ny * s * l * 0.4 - ty / tl * 4, px, py); x.fill();
        }
      }
    }
    return texOf(c);
  }
  function grassTexture(seed, blur) {
    const W = 384, H = 384, c = mkCanvas(W, H), x = c.getContext('2d'); let sd = seed; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.filter = `blur(${blur}px)`;
    for (let i = 0; i < 70; i++) {
      const bx = W * (0.2 + rr() * 0.6), h = H * (0.45 + rr() * 0.5), lean = (rr() - 0.5) * 140;
      const g = x.createLinearGradient(0, H, 0, H - h); g.addColorStop(0, '#3a5a2a'); g.addColorStop(1, ['#8aa85a', '#a4bc6a', '#7c9a4c'][i % 3]);
      x.fillStyle = g; x.beginPath(); x.moveTo(bx - 5, H); x.quadraticCurveTo(bx + lean * 0.3, H - h * 0.6, bx + lean, H - h); x.quadraticCurveTo(bx + lean * 0.3 + 4, H - h * 0.55, bx + 5, H); x.fill();
    }
    return texOf(c);
  }
  function stoneTexture(seed, blur) {
    const W = 384, H = 256, c = mkCanvas(W, H), x = c.getContext('2d'); let sd = seed; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.filter = `blur(${blur}px)`;
    const g = x.createLinearGradient(0, 40, 0, H); g.addColorStop(0, '#9a9a90'); g.addColorStop(1, '#4e4e48');
    x.fillStyle = g; x.beginPath(); x.moveTo(20, H); x.quadraticCurveTo(10, 90, 140, 50); x.quadraticCurveTo(260, 20, 340, 90); x.quadraticCurveTo(380, 160, 370, H); x.fill();
    x.filter = `blur(${blur + 1}px)`; x.fillStyle = '#5f7a38';
    x.beginPath(); x.moveTo(40, 120); x.quadraticCurveTo(140, 40, 260, 45); x.quadraticCurveTo(340, 70, 352, 120); x.quadraticCurveTo(250, 95, 150, 110); x.quadraticCurveTo(80, 120, 40, 140); x.fill();
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${rr() < 0.5 ? '120,150,70' : '70,95,40'},.6)`; x.beginPath(); x.arc(60 + rr() * 280, 55 + rr() * 70, 3 + rr() * 6, 0, 6.283); x.fill(); }
    return texOf(c);
  }
  function fadeGroup(g, k) {
    g.visible = k > 0.003;
    g.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (m.userData.baseOp === undefined) { m.userData.baseOp = m.uniforms?.uOp ? 1 : m.opacity; if (!m.uniforms) m.transparent = true; }
        if (m.uniforms?.uOp) m.uniforms.uOp.value = k; else m.opacity = m.userData.baseOp * k;
      }
    });
  }
  function makeButterfly(col) {
    const g = new T.Group(), m = new T.MeshStandardMaterial({ color: col, roughness: 0.6, side: T.DoubleSide });
    const sh = new T.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.05, 0.06, 0.1, 0.05, 0.09, -0.01); sh.bezierCurveTo(0.08, -0.06, 0.03, -0.05, 0, 0);
    const wg = new T.ShapeGeometry(sh, 4); wg.rotateX(-Math.PI / 2);
    const L = new T.Mesh(wg, m), R = new T.Mesh(wg, m); R.scale.z = -1;
    const body = new T.Mesh(new T.CylinderGeometry(0.005, 0.005, 0.07, 4), new T.MeshStandardMaterial({ color: '#2a2420' })); body.rotation.z = Math.PI / 2;
    g.add(L, R, body); g.scale.setScalar(1.3);
    return { root: g, L, R };
  }

  function makeDragonfly(col) {
    const g = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(0.006, 0.004, 0.16, 6).rotateZ(Math.PI / 2), new T.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.3, emissive: col, emissiveIntensity: 0.25 }));
    body.position.x = -0.03; g.add(body);
    const head = new T.Mesh(new T.SphereGeometry(0.012, 8, 6), body.material); head.position.x = 0.055; g.add(head);
    const wm = new T.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false });
    const wings = [];
    for (const [x, s] of [[0.02, 1], [0.02, -1], [-0.005, 1], [-0.005, -1]]) { const w = new T.Mesh(new T.PlaneGeometry(0.025, 0.1).translate(0, 0.05, 0).rotateX(-Math.PI / 2 * s), wm); w.position.x = x; g.add(w); wings.push({ w, s }); }
    return { root: g, wings };
  }
  window.Scenery = {
    DIM,
    create({ scene, r, hillH, glowTex, hollow, limbs, snowU }) {
      const ground = (x, z) => hillH(x, z);
      const env = { rain: 0, flash: 0 }, OFF = 17;
      const geo = new T.Group(); scene.add(geo);

      // ================= SOL ARKA: kayalık yamaç, mağara, şelale =================
      const gy = ground(-6.5, -8.5);
      const rockGrp = new T.Group(), caveGrp = new T.Group(), streamGrp = new T.Group(); geo.add(rockGrp, caveGrp, streamGrp);
      const rocks = [
        rockMesh(r, V(3.0, 3.6, 2.2), '#8c8a80', 1.7, snowU), rockMesh(r, V(2.0, 2.6, 1.6), '#8f8c82', 3.1, snowU),
        rockMesh(r, V(2.8, 3.4, 2.1), '#85837a', 5.3, snowU), rockMesh(r, V(1.1, 0.9, 0.9), '#93908a', 7.9, snowU), rockMesh(r, V(1.6, 1.3, 1.2), '#8a877e', 9.4, snowU),
      ];
      [[-7.6, gy - 0.5, -9.2], [-5.1, gy - 0.3, -8.8], [-9.6, gy + 0.9, -10.8], [-3.9, gy - 0.25, -7.6], [-9.0, gy - 0.3, -7.2]].forEach((p, i) => { rocks[i].position.set(...p); rockGrp.add(rocks[i]); });
      const caveTex = (() => { const c = mkCanvas(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 170, 6, 128, 150, 140);
        g.addColorStop(0, 'rgba(255,190,110,1)'); g.addColorStop(0.18, 'rgba(200,110,50,1)'); g.addColorStop(0.5, 'rgba(60,32,18,1)'); g.addColorStop(1, 'rgba(18,12,8,1)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return texOf(c); })();
      // ağız: girintili çıkıntılı, yamuk bir yarık
      const cm = new T.Shape(), mp = [];
      for (let i = 0; i <= 14; i++) { const a = Math.PI * (i / 14), j = (i % 2 ? 0.035 : -0.02) + Math.sin(i * 2.3) * 0.025; mp.push([Math.cos(a) * (0.78 + j), Math.sin(a) * (1.15 + j * 1.2)]); }
      cm.moveTo(mp[0][0], 0); mp.forEach(([x, y]) => cm.lineTo(x, y)); cm.lineTo(mp[14][0], 0); cm.closePath();
      const mouthG = new T.ShapeGeometry(cm, 4);
      { const p = mouthG.attributes.position, uv = mouthG.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.9) / 1.8, p.getY(i) / 1.45); }
      const den = V(-6.75, 0, -6.55); den.y = ground(den.x, den.z);
      const caveRoot = new T.Group(); caveRoot.position.set(den.x, den.y - 0.08, den.z); caveRoot.rotation.y = 0.25; caveGrp.add(caveRoot);
      const mouth = new T.Mesh(mouthG, new T.MeshBasicMaterial({ map: caveTex, toneMapped: false })); caveRoot.add(mouth);
      // ağzı çevreleyen katman katman kaya blokları + üstte kalın bir lento
      [[-1.0, 0.3, 0.45, 0.5, 0.5, 0.8], [-0.98, 0.85, 0.4, 0.42, 0.45, 2.1], [-0.72, 1.25, 0.42, 0.38, 0.45, 3.3], [-0.25, 1.45, 0.48, 0.36, 0.5, 4.4], [0.3, 1.45, 0.5, 0.38, 0.5, 5.6],
       [0.78, 1.22, 0.42, 0.4, 0.45, 6.7], [1.0, 0.75, 0.4, 0.44, 0.45, 7.9], [1.05, 0.25, 0.46, 0.48, 0.5, 9.1], [0.05, 1.8, 1.0, 0.42, 0.62, 10.3], [-1.45, 0.45, 0.6, 0.75, 0.6, 11.5], [1.5, 0.4, 0.55, 0.68, 0.55, 12.7]].forEach(([x, y, sx, sy, sz, sd], k) => {
        const b = rockMesh(r, V(sx, sy, sz), ['#7e7a70', '#6f6b62', '#86827a'][k % 3], sd, snowU); b.position.set(x, y, -0.18 - (k % 3) * 0.04); b.rotation.z = (r() - 0.5) * 0.4; caveRoot.add(b); });
      const caveLight = new T.PointLight('#ffae5a', 2.4, 4.5, 1.6); caveLight.position.set(den.x + 0.1, den.y + 0.55, den.z + 0.45); caveGrp.add(caveLight);
      const caveGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#ffb066', transparent: true, depthWrite: false, opacity: 0.55, blending: T.AdditiveBlending })); caveGlow.scale.set(2.2, 1.6, 1); caveGlow.position.set(den.x, den.y + 0.45, den.z + 0.2); caveGrp.add(caveGlow);
      // şelale (akan) ve donmuş hali (buz perdesi + sarkıtlar)
      const fx = -4.95, ftop = gy + 2.55, fbot = ground(fx, -7.25) + 0.02;
      const fallMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uOp: { value: 1 }, uFlow: { value: 1 }, uDim: DIM },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 uDim; uniform float uTime; uniform float uOp; uniform float uFlow; varying vec2 vUv;
          float h(float x){ return fract(sin(x*91.7)*437.5); }
          void main(){ float col = floor(vUv.x*30.0); float s = fract(vUv.y*3.0 + uTime*(1.3 + h(col)*0.9) + h(col));
            float streak = smoothstep(0.0,0.4,s)*smoothstep(1.0,0.6,s);
            float side = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
            gl_FragColor = vec4(mix(vec3(0.72,0.86,0.94), vec3(1.0), streak) * uDim, (0.4 + 0.6*streak) * side * uOp * 0.92); }`,
      });
      const fall = new T.Mesh(new T.PlaneGeometry(0.75, ftop - fbot, 1, 8), fallMat); fall.position.set(fx, (ftop + fbot) / 2, -7.32); fall.rotation.y = 0.15; geo.add(fall);
      const foam = [];
      for (let k = 0; k < 7; k++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, opacity: 0.5 })); sp.position.set(fx + (r() - 0.5) * 0.9, fbot + 0.1, -7.1); sp.scale.setScalar(0.7); sp.material.color = DIM.value; geo.add(sp); foam.push({ sp, ph: r() * 6 }); }
      const iceTex = (() => { const c = mkCanvas(128, 256), x = c.getContext('2d'); x.fillStyle = '#d8ecf6'; x.fillRect(0, 0, 128, 256);
        for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; x.lineWidth = 1 + r() * 3; const xx = r() * 128; x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx + (r() - 0.5) * 10, 256); x.stroke(); } return texOf(c); })();
      const frozen = new T.Group(); geo.add(frozen);
      const sheet = new T.Mesh(new T.PlaneGeometry(0.8, ftop - fbot), new T.MeshStandardMaterial({ map: iceTex, transparent: true, opacity: 0.92, roughness: 0.15, metalness: 0.1 })); sheet.position.set(fx, (ftop + fbot) / 2, -7.3); sheet.rotation.y = 0.15; frozen.add(sheet);
      for (let k = 0; k < 11; k++) { const len = 0.25 + r() * 0.6; const ic = new T.Mesh(new T.ConeGeometry(0.035 + r() * 0.03, len, 6), new T.MeshStandardMaterial({ color: '#e6f4fb', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.95 }));
        ic.rotation.x = Math.PI; ic.position.set(fx - 0.6 + k * 0.12, ftop - len / 2 + 0.05, -7.15); frozen.add(ic); }

      // ================= DERE ve GÖLET =================
      const scurve = new T.CatmullRomCurve3([V(fx, 0, -7.1), V(-4.1, 0, -5.9), V(-2.7, 0, -5.0), V(-0.8, 0, -4.75), V(1.4, 0, -4.5), V(3.4, 0, -3.3), V(4.3, 0, -1.6), V(4.0, 0, -0.5), V(3.8, 0, 0.2)]);
      const sMat = waterMat('#4a86a0', '#a2d2da', { flow: -0.7, scale: 1.2 });
      { const N = 200, pos = [], uv = [], idx = [], t = V(), P = V();
        for (let i = 0; i <= N; i++) { const u = i / N; scurve.getPointAt(u, P); scurve.getTangentAt(u, t); const sx = -t.z, sz = t.x, w = lerp(0.28, 0.5, u) * (1 + 0.12 * Math.sin(u * 40));
          for (const s of [-1, 1]) { const x = P.x + sx * w * s, z = P.z + sz * w * s; pos.push(x, ground(x, z) + 0.03, z); uv.push(u, s > 0 ? 1 : 0); }
          if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        streamGrp.add(new T.Mesh(g, sMat)); }
      const pond = { x: 3.65, z: 0.75, rx: 1.9, rz: 1.0 }; pond.y = ground(pond.x, pond.z) + 0.035;
      const pMat = waterMat('#3c7a8c', '#9ccad0', { radial: true, rings: true, scale: 1.4 });
      const pg = new T.CircleGeometry(1, 72); pg.rotateX(-Math.PI / 2);
      { const uv = pg.attributes.uv, p = pg.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) * 0.5, 0.5 + p.getZ(i) * 0.5); }
      const pondMesh = new T.Mesh(pg, pMat); pondMesh.scale.set(pond.rx, 1, pond.rz); pondMesh.position.set(pond.x, pond.y, pond.z); geo.add(pondMesh);
      const shore = new T.Mesh(new T.RingGeometry(0.98, 1.12, 72).rotateX(-Math.PI / 2), snowPatch(new T.MeshStandardMaterial({ color: '#b9a77c', roughness: 1 }), snowU, 0.4)); shore.scale.copy(pondMesh.scale); shore.position.set(pond.x, pond.y - 0.006, pond.z); geo.add(shore);
      const reeds = new T.Group(), reedList = []; geo.add(reeds);
      for (let k = 0; k < 34; k++) {
        const a = r() * 6.283; if (Math.sin(a) > 0.1 && r() < 0.85) continue;
        const d = 1.02 + r() * 0.14, x = pond.x + Math.cos(a) * d * pond.rx, z = pond.z + Math.sin(a) * d * pond.rz, h = 0.4 + r() * 0.45;
        const rg = new T.Group(); rg.position.set(x, ground(x, z), z); reeds.add(rg); reedList.push({ g: rg, x, ph: r() * 6, base: (r() - 0.5) * 0.3, h });
        const reed = new T.Mesh(new T.CylinderGeometry(0.006, 0.011, h, 4).translate(0, h / 2, 0), new T.MeshStandardMaterial({ color: '#6a8a42' })); rg.add(reed);
        if (r() < 0.5) { const cat = new T.Mesh(new T.CapsuleGeometry(0.02, 0.08, 2, 6), new T.MeshStandardMaterial({ color: '#5a3a22' })); cat.position.set(0, h + 0.02, 0); rg.add(cat); }
      }
      const lilies = new T.Group(), blooms = new T.Group(); geo.add(lilies, blooms);
      const petalM = new T.MeshStandardMaterial({ color: '#f9cfe0', roughness: 0.5, side: T.DoubleSide, emissive: '#5a2a3a', emissiveIntensity: 0.15 }), heartM = new T.MeshStandardMaterial({ color: '#f2c94c', emissive: '#6a4a10', emissiveIntensity: 0.3 });
      const petalG = (() => { const sh = new T.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.05, 0.05, 0, 0.13); sh.quadraticCurveTo(-0.05, 0.05, 0, 0); return new T.ShapeGeometry(sh, 6); })();
      const lotus = () => { const g = new T.Group();
        for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) { const p = new T.Mesh(petalG, petalM); const a = (i / 8) * 6.283 + ring * 0.39;
          p.position.set(Math.cos(a) * 0.015, 0, Math.sin(a) * 0.015); p.rotation.set(0, -a + Math.PI / 2, 0); p.rotateX(-(ring ? 0.45 : 0.95)); p.scale.setScalar(ring ? 0.75 : 1); g.add(p); }
        const h = new T.Mesh(new T.SphereGeometry(0.028, 10, 8), heartM); h.position.y = 0.03; g.add(h); return g; };
      for (let k = 0; k < 7; k++) { const a = r() * 6.283, d = 0.3 + r() * 0.55; const lp = new T.Mesh(new T.CircleGeometry(0.13 + r() * 0.07, 16, 0.3, 5.9).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: '#4e7a3a', roughness: 0.6 }));
        lp.position.set(pond.x + Math.cos(a) * d * pond.rx, pond.y + 0.006, pond.z + Math.sin(a) * d * pond.rz); lp.rotation.y = r() * 6; lilies.add(lp);
        if (k % 2 === 0) { const fl = lotus(); fl.position.copy(lp.position).add(V(0.03, 0.005, 0)); fl.rotation.y = r() * 6; blooms.add(fl); } }
      for (let k = 0; k < 9; k++) { const a = 1.2 + k * 0.45 + r() * 0.2, x = pond.x + Math.cos(a) * pond.rx * 1.12, z = pond.z + Math.sin(a) * pond.rz * 1.12;
        const st = rockMesh(r, V(0.18 + r() * 0.15, 0.12 + r() * 0.1, 0.16 + r() * 0.12), '#8a8a80', r() * 9, snowU); st.position.set(x, ground(x, z) - 0.02, z); geo.add(st); }

      // ================= UFUK: deniz ve yelkenli =================
      const seaMat = waterMat('#2f6f8f', '#6fb3c4', { scale: 0.35 }); seaMat.uniforms.uRadial.value = -1;
      const sea = new T.Mesh(new T.PlaneGeometry(320, 150).rotateX(-Math.PI / 2), seaMat); sea.position.set(0, 1.05, -98); geo.add(sea);
      const beach = new T.Mesh(new T.PlaneGeometry(320, 3.5).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: '#e2d4b0', roughness: 1 })); beach.position.set(0, 1.04, -23.2); geo.add(beach);
      const boat = new T.Group(); geo.add(boat);
      const hull = new T.Mesh(new T.CylinderGeometry(0.35, 0.18, 1.6, 12, 1, false, 0, Math.PI), new T.MeshStandardMaterial({ color: '#7a4a2a', side: T.DoubleSide })); hull.rotation.set(Math.PI, 0, Math.PI / 2); boat.add(hull);
      const mast = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 2.2, 6), new T.MeshStandardMaterial({ color: '#5a3a22' })); mast.position.y = 1.1; boat.add(mast);
      const sailM = new T.MeshStandardMaterial({ color: '#fbf7ef', side: T.DoubleSide });
      for (const v of [[0, 0.25, 0, 0, 2.1, 0, -1.1, 0.3, 0], [0.05, 0.3, 0, 0.05, 1.8, 0, 0.8, 0.3, 0]]) { const sg = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(v, 3)); sg.computeVertexNormals(); boat.add(new T.Mesh(sg, sailM)); }
      boat.scale.setScalar(1.3); boat.position.set(-12, 1.15, -38);

      // ================= ÖN PLAN: flu eğrelti otları, çimen, yosunlu taşlar =================
      const fg = [];
      const addFg = (tex, x, y, z, w, h, sway) => { const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false })); sp.center.set(0.5, 0); sp.scale.set(w, h, 1); sp.position.set(x, y, z); sp.renderOrder = 5; geo.add(sp); fg.push({ sp, sway, ph: r() * 6 }); return sp; };
      addFg(fernTexture(3, 7), -2.9, 0.2, 10.4, 3.0, 3.6, 0.04); addFg(fernTexture(5, 6), 2.7, 0.2, 10.2, 3.0, 3.6, 0.04);
      addFg(fernTexture(9, 4), -4.6, 0.0, 7.6, 2.4, 2.9, 0.05); addFg(fernTexture(11, 4), 4.9, 0.0, 7.4, 2.4, 2.9, 0.05);
      addFg(grassTexture(13, 3), -5.6, -0.05, 5.4, 2.0, 1.6, 0.07); addFg(grassTexture(17, 3), 6.2, -0.05, 5.0, 2.0, 1.6, 0.07); addFg(grassTexture(19, 2), -1.9, -0.05, 6.4, 1.6, 1.3, 0.08);
      addFg(stoneTexture(21, 2), -4.4, -0.08, 4.4, 1.4, 0.9, 0); addFg(stoneTexture(23, 2), 5.4, -0.08, 4.1, 1.6, 1.0, 0);
      const fgTint = { ilkbahar: '#e6f6d0', yaz: '#ffffff', sonbahar: '#ffb878', kis: '#c8c4bc' };

      // ================= mevsime özel süsler =================
      const sets = {};
      { // ilkbahar: yağmurdan sonra ince gökkuşağı
        const g = new T.Group(); scene.add(g);
        const rbMat = new T.ShaderMaterial({
          transparent: true, depthWrite: false, fog: false, uniforms: { uOp: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: `uniform float uOp; varying vec2 vUv;
            vec3 hsv(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
            void main(){ float t = vUv.y; vec3 c = hsv(0.83 - t*0.83); float a = smoothstep(0.0,0.15,t)*smoothstep(1.0,0.85,t);
              float ends = smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x); gl_FragColor = vec4(mix(vec3(1.0), c, 0.75), a*ends*uOp); }`,
        });
        const rb = new T.Mesh(new T.RingGeometry(15, 16.6, 96, 1, 0.15 * Math.PI, 0.7 * Math.PI), rbMat);
        { const p = rb.geometry.attributes.position, uvA = rb.geometry.attributes.uv; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); uvA.setXY(i, (Math.atan2(y, x) - 0.15 * Math.PI) / (0.7 * Math.PI), (Math.hypot(x, y) - 15) / 1.6); } }
        rb.position.set(9, -3, -48); rb.renderOrder = -7; scene.add(rb);
        sets.ilkbahar = { g, weather: { rain: [10, 16], dry: [18, 30], max: 0.42 }, rb, rbMat, flyers: Array(12).fill('swallow'), butterflies: 8, bfZone: { x: 0, z: 1.4, w: 4.5, d: 1.2, y: 0.35, h: 0.9 }, fall: 1.25 };
      }
      { // yaz: güneş parlaması
        const g = new T.Group(); scene.add(g);
        const sun = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#fff1c4', transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, opacity: 0.85 }));
        sun.scale.set(26, 26, 1); sun.position.set(-16, 13, -45); sun.renderOrder = -8; g.add(sun);
        const isl = (w, h, x, z, col) => { const sh = new T.Shape(); sh.moveTo(-w / 2, 0);
          for (let i = 1; i <= 24; i++) { const u = i / 24; sh.lineTo(-w / 2 + u * w, Math.pow(Math.sin(u * Math.PI), 1.6) * h * (0.85 + 0.15 * Math.sin(u * 17))); }
          const m = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, fog: false, depthWrite: false })); m.position.set(x, 1.0, z); m.renderOrder = -7; g.add(m); };
        isl(26, 3.2, -24, -78, '#9db4bf'); isl(12, 1.6, -4, -84, '#b4c7cf'); isl(16, 2.2, 26, -80, '#a6bcc6');
        sets.yaz = { g, weather: null, flyers: Array(8).fill('gull'), butterflies: 5, dragonflies: 5, fall: 0 };
      }
      { // sonbahar: sis bantları
        const g = new T.Group(); scene.add(g); const mists = [];
        for (let k = 0; k < 7; k++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, opacity: 0.32 })); sp.scale.set(14, 1.8, 1); sp.position.set((r() - 0.5) * 40, 0.8 + r() * 1.2, -5 - r() * 12); g.add(sp); mists.push({ sp, v: 0.2 + r() * 0.2 }); }
        sets.sonbahar = { g, weather: { rain: [30, 48], dry: [8, 12], max: 1, lightning: true }, mists, flyers: Array(14).fill('goose'), butterflies: 0, fall: 1 };
      }
      { // kış: sık karlı çam ormanı, uzak karlı dağlar ve ay
        const g = new T.Group(); scene.add(g);
        const mountains = (z, base, amp, ph, snowLine, dark, snowC, ro) => {
          const P = [], C = [], idx = [], N = 140, cd = new T.Color(dark), cs = new T.Color(snowC);
          for (let i = 0; i <= N; i++) {
            const x = -120 + (i / N) * 240, h = base + amp * (0.5 * Math.abs(Math.sin(x * 0.05 + ph)) + 0.32 * Math.abs(Math.sin(x * 0.13 + ph * 2)) + 0.18 * Math.sin(x * 0.37 + ph * 3));
            const s1 = Math.min(h, snowLine - 0.6 * Math.sin(x * 0.9 + ph));
            P.push(x, -4, z, x, s1, z, x, s1, z, x, h, z);
            for (const c of [cd, cd, h > s1 + 0.02 ? cs : cd, h > s1 + 0.02 ? cs : cd]) C.push(c.r, c.g, c.b);
            if (i < N) { const a = i * 4; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7); }
          }
          const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(P, 3)); gg.setAttribute('color', new T.Float32BufferAttribute(C, 3)); gg.setIndex(idx);
          const m = new T.Mesh(gg, new T.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, depthWrite: false })); m.renderOrder = ro; g.add(m);
        };
        mountains(-70, 5.5, 6.5, 0.7, 8.2, '#26354f', '#b9c6dc', -9.6); mountains(-52, 2.6, 4.2, 2.9, 4.6, '#1d2a40', '#93a3bf', -9.4);
        const moon = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#cfdcff', transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, opacity: 0.8 }));
        moon.scale.set(9, 9, 1); moon.position.set(13, 12.5, -52); moon.renderOrder = -8; g.add(moon);
        const disc = new T.Mesh(new T.CircleGeometry(0.9, 40), new T.MeshBasicMaterial({ color: '#f4f6ff', fog: false, transparent: true })); disc.position.set(13, 12.5, -51.8); disc.renderOrder = -8; g.add(disc);
        for (let k = 0; k < 78; k++) {
          const side = k % 2 ? 1 : -1; let x = side * (4.5 + r() * 18); const z = -5.5 - r() * 17;
          if (x < -2.5 && z > -11.5) x -= 6;
          const sp = new T.Sprite(new T.SpriteMaterial({ map: pineTexture(k % 3), transparent: true, alphaTest: 0.05, toneMapped: false })); sp.material.color = DIM.value; const s = (0.9 + r() * 0.9) * (1 + (-z - 5.5) * 0.03);
          sp.center.set(0.5, 0.02); sp.scale.set(1.3 * s, 2.6 * s, 1); sp.position.set(x, ground(x, z) - 0.05, z); g.add(sp);
        }
        sets.kis = { g, weather: null, flyers: Array(6).fill('robin'), butterflies: 0, fall: 0, owls: true };
      }
      for (const k in sets) fadeGroup(sets[k].g, 0);
      const bolt = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#e4ebff', transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending, opacity: 0 }));
      bolt.scale.set(34, 20, 1); bolt.position.set(0, 12, -46); bolt.renderOrder = -8.5; scene.add(bolt);
      let boltT = 4, flicker = 0;
      // sabit coğrafyanın mevsimsel görünürlüğü (opaklık + yerden yükselme ile yumuşak geçiş)
      const GEO = { rocks: { ilkbahar: 1, sonbahar: 1, kis: 1 }, cave: { sonbahar: 1 }, stream: { ilkbahar: 1, sonbahar: 1, kis: 1 }, frz: { kis: 1 }, bloom: { yaz: 1 } };
      const SKY = { ilkbahar: '#e2f0f2', yaz: '#d3eef6', sonbahar: '#9c958a', kis: '#3a506b' };
      function geoFade(g, k, sink) {
        g.visible = k > 0.003; g.position.y = -(1 - smooth(k)) * sink;
        g.traverse((o) => { if (!o.material || o.isLight) return; const m = o.material;
          if (m.userData.gOp === undefined) m.userData.gOp = m.opacity;
          m.opacity = m.userData.gOp * k; const tr = m.userData.gOp < 1 || k < 0.995 || !!m.map; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } });
      }

      // ================= hava: yağmur ve şimşek =================
      const NR = 1800, rPos = new Float32Array(NR * 6), drops = [];
      for (let i = 0; i < NR; i++) drops.push({ x: (r() - 0.5) * 34, y: r() * 14, z: -18 + r() * 26, v: 9 + r() * 5 });
      const rainGeo = new T.BufferGeometry(); rainGeo.setAttribute('position', new T.BufferAttribute(rPos, 3));
      const rainMat = new T.LineBasicMaterial({ color: '#d9e2ea', transparent: true, opacity: 0, depthWrite: false });
      const rain = new T.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain);
      let wState = { raining: false, t: 8, level: 0, after: 0 };

      // ================= hayvanlar =================
      const inPond = (x, z, m = 0.25) => Math.pow((x - pond.x) / (pond.rx + m), 2) + Math.pow((z - pond.z) / (pond.rz + m), 2) < 1;
      const fixTarget = (t) => {
        if (inPond(t.x, t.z)) { const a = Math.atan2((t.z - pond.z) / pond.rz, (t.x - pond.x) / pond.rx); t.x = pond.x + Math.cos(a) * (pond.rx + 0.35); t.z = pond.z + Math.sin(a) * (pond.rz + 0.35); }
        if (t.x < -4.2 && t.z < -6.2) t.z = -6.2;
      };
      const mover = (a, opts) => { const m = new F.Mover(a, opts); const pt = m.pickTarget.bind(m); m.pickTarget = (rr) => { pt(rr); fixTarget(m.target); }; return m; };
      // Derinlik katmanları: ön (sol ön çayır, kökler), orta (gölet kıyısı, arka tarla), arka (orman kenarı, uzak tepeler)
      const RG = {
        lf: { x0: -6.6, x1: -2.6, z0: 1.8, z1: 4.4 },                 // sol ön çayır (kameraya yakın)
        roots: { x0: -3.8, x1: 2.6, z0: 0.6, z1: 3.0, avoid: 2.3 },   // köklerin çevresi
        pond: { x0: 1.9, x1: 5.8, z0: -0.9, z1: 1.9, avoid: 2.6 },    // gölet kıyısı
        mid: { x0: -5.5, x1: 6.5, z0: -5.6, z1: -2.4 },               // arka tarla
        rb: { x0: 4.2, x1: 8.8, z0: -7.2, z1: -4.2 },                 // sağ arka orman kenarı
        far: { x0: -1.5, x1: 9, z0: -12.5, z1: -9.5 },                // uzak tepeler
      };
      const FRONT = 1.35, FAR = 1.3;   // perspektifi güçlendiren ölçekler
      // aile: lider + yavrular; sc tüm grubun ölçeği
      const family = (lead, kid, n, o, kidSc = 0.6, sc = 1, chain = false) => {
        const out = [], L = mover(lead(), o); L.a.root.scale.setScalar(sc); out.push(L); let prev = L;
        for (let k = 0; k < n; k++) { const c = mover(kid(k), { walk: o.walk * 1.1, run: o.run, playful: !chain && o.playful !== false, region: o.region }); c.a.root.scale.setScalar(kidSc * sc);
          c.leader = chain ? prev : L; c.offset = chain ? V(-0.85 * sc, 0, k % 2 ? 0.08 : -0.08) : V(-(0.45 + (k % 2) * 0.3) * sc, 0, (k - (n - 1) / 2) * 0.38 * sc); out.push(c); prev = c; }
        return out;
      };
      const solo = (make, o, sc = 1) => { const m = mover(make(), o); m.a.root.scale.setScalar(sc); return [m]; };
      const Q = (k) => () => F.quad(k), H = (k, e) => () => F.hopper(k, e);
      const wolfCoat = (k) => F.quad('wolf', { coat: { back: ['#8a8c90', '#5e6064', '#9a9894', '#74767c', '#6a6c70'][k % 5], belly: '#e4e0d8' } });
      // her mevsim: sırayla (karelere yayılarak) kurulan gruplar
      const SPAWN = {
        ilkbahar: () => [
          () => family(Q('deer'), () => F.quad('fawn'), 2, { walk: 0.45, run: 2.4, grazer: true, region: RG.pond }, 1),          // gölette su içen anne + 2 yavru
          () => family(Q('deer'), () => F.quad('fawn'), 1, { walk: 0.4, run: 2.4, grazer: true, region: RG.rb }, 1),            // orman kenarında ikinci geyik ailesi
          () => [...solo(Q('stag'), { walk: 0.35, run: 2, grazer: true, region: RG.far }, FAR), ...solo(Q('deer'), { walk: 0.35, run: 2, grazer: true, region: RG.far }, FAR), ...solo(Q('deer'), { walk: 0.35, run: 2, grazer: true, region: RG.far }, FAR)],
          () => family(H('rabbit'), () => F.hopper('rabbit'), 4, { walk: 0.35, run: 1.8, sitter: true, grazer: true, region: RG.roots }, 0.6),
          () => family(H('rabbit'), () => F.hopper('rabbit'), 3, { walk: 0.4, run: 1.9, sitter: true, grazer: true, region: RG.lf }, 0.6, FRONT),   // sol ön çayırda zıplayanlar
        ],
        yaz: () => [
          () => family(Q('fox'), () => F.quad('fox'), 2, { walk: 0.45, run: 2.6, sitter: true, region: RG.roots }, 0.6),
          () => family(Q('fox'), () => F.quad('fox'), 2, { walk: 0.55, run: 2.8, region: { x0: -6.6, x1: -1.4, z0: 1.0, z1: 4.4, avoid: 2.0 } }, 0.6, FRONT),   // sol çayırdan köklere koşturan yavrular
          () => family(Q('deer'), () => F.quad('fawn'), 1, { walk: 0.4, run: 2.4, grazer: true, region: RG.rb }, 1),
          () => [...solo(H('rabbit'), { walk: 0.35, run: 1.8, sitter: true, grazer: true, region: RG.mid }), ...solo(H('rabbit'), { walk: 0.35, run: 1.8, sitter: true, grazer: true, region: RG.mid })],
        ],
        sonbahar: () => [
          () => family(Q('bear'), () => F.quad('bear'), 2, { walk: 0.38, run: 2.0, grazer: true, den, region: { x0: -7.0, x1: -1.6, z0: -5.8, z1: -2.2 } }, 0.5),   // mağaraya sığınan aile
          () => family(Q('bear'), () => F.quad('bear'), 1, { walk: 0.35, run: 2.0, grazer: true, region: RG.rb }, 0.5),
          () => [...solo(H('squirrel', { acorn: true }), { walk: 0.5, run: 2.2, sitter: true, region: RG.lf }, FRONT), ...solo(H('squirrel', { acorn: true }), { walk: 0.5, run: 2.2, sitter: true, region: RG.lf }, FRONT), ...solo(Q('fox'), { walk: 0.45, run: 2.6, sitter: true, region: RG.lf }, FRONT * 0.95)],
          () => [...solo(Q('stag'), { walk: 0.35, run: 2, grazer: true, region: RG.far }, FAR), ...solo(Q('deer'), { walk: 0.35, run: 2, grazer: true, region: RG.far }, FAR)],
          () => [...solo(H('rabbit'), { walk: 0.35, run: 1.8, sitter: true, grazer: true, region: RG.roots }), ...solo(H('rabbit'), { walk: 0.35, run: 1.8, sitter: true, grazer: true, region: RG.roots })],
        ],
        kis: () => [
          () => family(Q('wolf'), wolfCoat, 4, { walk: 0.65, run: 2.8, region: { x0: -1.5, x1: 7.5, z0: -6.5, z1: -2.6 } }, 1, 1, true),   // sağ arkadan çıkıp merkeze ilerleyen sürü
          () => family(Q('wolf'), wolfCoat, 2, { walk: 0.6, run: 2.8, region: RG.far }, 1, FAR, true),
          () => [-3.2, -1.4, 1.4, 3.0].flatMap((x0) => solo(H('hare'), { walk: 0.45, run: 2.4, sitter: true, region: { x0: x0 - 0.9, x1: x0 + 0.9, z0: 0.5, z1: 2.8, avoid: 2.3 } })),
          () => [0, 1, 2].flatMap(() => solo(H('hare'), { walk: 0.45, run: 2.4, sitter: true, region: RG.lf }, FRONT)),
          () => solo(Q('fox'), { walk: 0.45, run: 2.6, sitter: true, region: RG.mid }),
        ],
      };
      let spawnQ = [];

      let season = '', active = [], leaving = [], swims = [], flyers = [], flies = [], owls = [], climbers = [], drags = [], spawnT = -1;
      const perchPt = () => { const L = limbs[Math.floor(r() * 5)], u = 0.4 + r() * 0.5; return L.path(u).add(V(0, 0.07, 0.12)); };
      const setK = {};
      const G = { fall: 1, ice: 0, lily: 1, bloom: 0, rocks: 1, cave: 0, stream: 1, frz: 0, tint: new T.Color('#ffffff') }, GT = { fall: 1, ice: 0, lily: 1, bloom: 0, rocks: 1, cave: 0, stream: 1, frz: 0, tint: new T.Color('#ffffff') };
      const fauna = () => (window.ErmeQuality ? window.ErmeQuality.p.fauna : 1);   // kalite ön ayarına göre hayvan yoğunluğu
      function spawnSeason(s) {
        const S = sets[s], k = fauna();
        spawnQ = SPAWN[s]().filter((_, i) => k >= 1 || ((i * 0.618034) % 1) < k);
        extrasFor(s, S);
      }
      function spawnGroup(movers) {
        movers.forEach((m) => {
          const L = m.leader || m, side = (L.region.x0 + L.region.x1) / 2 >= 0 ? 1 : -1;
          const fromCave = !!L.opts.den;   // ayılar mağaradan çıkar; diğerleri en yakın kenardan gelir
          if (!m.leader) {
            m.pickTarget(r);
            if (fromCave) m.enterFrom(den.x, den.z + 0.1, m.target.x, m.target.z); else m.enterFrom(side * OFF, m.target.z + (r() - 0.5), m.target.x, m.target.z);
          } else {
            if (fromCave) m.place(den.x - 0.3, den.z + m.offset.z * 0.5, 0); else m.place(side * (OFF + 0.8 + r()), L.z + m.offset.z, side > 0 ? Math.PI : 0);
            m.state = 'follow';
          }
          scene.add(m.a.root); active.push(m);
        });
      }
      function extrasFor(s, S) {
        if (s === 'yaz') {   // ördek anne ve 4 yavrusu gölette sıra halinde
          [[4, -0.35, 0.3, 0.42, 0.3, 1], [3, 0.6, 0.38, 0.28, 0.26, -1]].forEach(([n, cx, cz, rx, rz, dir], fi) => {
            const list = [{ a: F.bird('duck'), lag: 0, ph: fi * 3 }]; for (let k = 1; k <= n; k++) list.push({ a: F.bird('duckling'), lag: k * 0.22, ph: k + fi * 3 });
            const sw = { list, u: -1.5 + fi * 2, k: 0, cx, cz, rx, rz, dir }; list.forEach((d) => { scene.add(d.a.root); d.a.root.userData.base = d.a.root.scale.x * 1.15; d.a.root.scale.setScalar(0.001); }); swims.push(sw); });
        }
        if (s === 'sonbahar' && limbs) {   // farklı dallarda birbirinden bağımsız koşturan dört sincap
          const trunk = { path: (u) => V(-0.17 + Math.sin(u * 5) * 0.03, 0.55 + u * 1.9, 0.44) };   // gövdede tırmanan
          [limbs[0], limbs[1], limbs[4], trunk].forEach((limb, k) => { const a = F.hopper('squirrel', { acorn: k % 2 === 0 }); scene.add(a.root); climbers.push({ a, u: 0.12 + r() * 0.6, dir: r() < 0.5 ? 1 : -1, limb, pause: r() * 2, sp: (k === 3 ? 0.14 : 0.09) + r() * 0.08, k: 0 }); }); }
        drags = Array.from({ length: S.dragonflies || 0 }, (_, i) => { const d = makeDragonfly(['#2a7a9a', '#3a8a4a', '#8a3a7a', '#2a5aa0'][i % 4]); scene.add(d.root);
          const p = V(pond.x + (r() - 0.5) * pond.rx, pond.y + 0.3 + r() * 0.3, pond.z + (r() - 0.5) * pond.rz); d.root.position.copy(p); return { d, p, from: p.clone(), to: p.clone(), mode: 'hover', w: r() * 2, k: 0, ph: r() * 6 }; });
        if (S.owls && hollow) {   // gövde kovuğuna yerleşmiş baykuş ailesi
          [[-0.05, 0, 1], [0.12, -0.05, 0.66]].forEach(([dx, dy, sc], k) => { const o = F.bird('owl'); o.root.scale.setScalar(0.95 * sc); scene.add(o.root); owls.push({ a: o, dx, dy, k: 0, look: 0, lookT: 1 + k }); });
        }
        flyers = (S.flyers || []).slice(0, Math.ceil((S.flyers || []).length * fauna())).map((kind, i) => { const b = F.bird(kind); b.root.scale.setScalar(kind === 'gull' ? 1.8 : kind === 'goose' ? 1.6 : kind === 'robin' ? 2.3 : kind === 'swallow' ? 1.3 : 1); scene.add(b.root);
          const f = { a: b, kind, i, ph: r() * 6, enter: 0 };
          if (kind === 'robin' && limbs) { f.to = perchPt(); f.from = V((i % 2 ? 1 : -1) * 9, 6 + r() * 2, -2); f.mode = 'fly'; f.ft = -i * 0.6; f.wait = 0; b.root.position.copy(f.from); }
          return f; });
        const Z = S.bfZone || { x: 0, z: 1.3, w: 9, d: 2.2, y: 0.6, h: 2.2 };
        flies = Array.from({ length: Math.round((S.butterflies || 0) * fauna()) }, (_, i) => { const b = makeButterfly(['#f2c14e', '#ffffff', '#e98ab0', '#8fc0e8', '#f39a4a', '#c5e07a'][i % 6]); scene.add(b.root); return { b, c: V(Z.x + (r() - 0.5) * Z.w * 2, Z.y + r() * Z.h, Z.z + (r() - 0.5) * Z.d * 2), ph: r() * 6, sp: 0.35 + r() * 0.4, k: 0 }; });
      }
      function setSeason(s) {
        if (!sets[s] || s === season) return;
        const first = !season, prev = season; season = s;
        // çıkış: kayalık tarafındakiler mağaraya koşar, diğerleri en yakın kenardan; kuşlar uçar
        for (const m of active) { if (prev === 'sonbahar' && m.x < -2.5 && m.z < -1.5) { m.leave(0); m.target = V(den.x, 0, den.z); m.intoCave = true; } else m.leave(m.x >= 0 ? OFF + 2 : -OFF - 2); leaving.push(m); }
        active = [];
        swims.forEach((sw) => leaving.push({ swim: sw })); swims = []; spawnQ = [];
        climbers.forEach((c) => leaving.push({ climber: c })); climbers = [];
        drags.forEach((d) => leaving.push({ drag: d })); drags = [];
        owls.forEach((o) => leaving.push({ owl: o })); owls = [];
        flyers.forEach((f) => leaving.push({ fly: f })); flyers = [];
        flies.forEach((f) => leaving.push({ flutter: f })); flies = [];
        spawnT = first ? 0.01 : 2.4;
        wState = { raining: false, t: 6 + r() * 6, level: wState.level, after: 0 };
        GT.fall = sets[s].fall; GT.ice = s === 'kis' ? 0.78 : 0; GT.lily = s === 'yaz' || s === 'ilkbahar' ? 1 : 0; GT.tint.set(fgTint[s]);
        for (const key in GEO) GT[key] = GEO[key][s] || 0;
        for (const m of [sMat, pMat, seaMat]) m.uniforms.uSky.value.set(SKY[s]);
        if (first) { G.fall = GT.fall; G.ice = GT.ice; G.lily = GT.lily; G.tint.copy(GT.tint); for (const key in GEO) G[key] = GT[key]; }
      }
      const tmp = V();
      function update(dt, t, gust) {
        // sabit coğrafyanın mevsimsel hali
        const k = 1 - Math.exp(-dt * 0.8);
        G.fall = lerp(G.fall, GT.fall, k); G.ice = lerp(G.ice, GT.ice, k); G.lily = lerp(G.lily, GT.lily, k); G.tint.lerp(GT.tint, k);
        for (const key in GEO) G[key] = lerp(G[key], GT[key], k * 1.2);
        geoFade(rockGrp, G.rocks, 2.2); geoFade(caveGrp, G.cave, 1.6); sMat.uniforms.uOp.value = G.stream;
        streamGrp.visible = G.stream > 0.01; caveLight.intensity = 0;
        fallMat.uniforms.uTime.value = t; fallMat.uniforms.uOp.value = clamp(G.fall); fall.scale.x = 0.8 + G.fall * 0.25;
        foam.forEach((f) => { f.sp.material.opacity = 0.5 * clamp(G.fall); f.sp.scale.setScalar((0.6 + Math.sin(t * 3 + f.ph) * 0.12) * (0.7 + G.fall * 0.4)); });
        frozen.visible = G.frz > 0.02; frozen.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.95 * clamp(G.frz); } });
        for (const m of [sMat, pMat, seaMat]) m.uniforms.uTime.value = t;
        sMat.uniforms.uIce.value = G.ice > 0.05 ? 1 : 0; pMat.uniforms.uIce.value = G.ice;
        lilies.visible = G.lily > 0.05; lilies.children.forEach((c) => c.scale.setScalar(Math.max(0.001, G.lily)));
        blooms.visible = G.bloom > 0.02; blooms.children.forEach((c, i) => { c.scale.setScalar(Math.max(0.001, smooth(G.bloom * 1.4 - i * 0.08)) * (1.25 + Math.sin(t * 0.8 + i) * 0.03)); });
        boat.position.x += dt * 0.35; if (boat.position.x > 28) boat.position.x = -28; boat.rotation.z = Math.sin(t * 0.9) * 0.04; boat.position.y = 1.15 + Math.sin(t * 1.2) * 0.03;
        caveGlow.material.opacity = (0.5 + Math.sin(t * 2.3) * 0.05 + Math.sin(t * 7.1) * 0.03) * G.cave; caveLight.intensity = (2.4 + Math.sin(t * 5.3) * 0.25) * G.cave;
        for (const rd of reedList) { const w = Math.sin(t * 1.15 - rd.x * 0.2 + rd.ph * 0.25); rd.g.rotation.z = rd.base * 0.5 + w * 0.045 - gust * 0.13; rd.g.rotation.x = Math.sin(t * 0.9 - rd.x * 0.2 + rd.ph) * 0.025; }
        for (const f of fg) { f.sp.material.rotation = Math.sin(t * 0.9 - f.sp.position.x * 0.18 + f.ph * 0.3) * f.sway - gust * f.sway * 1.4; f.sp.material.color.copy(G.tint).multiply(DIM.value); }
        for (const key in sets) { setK[key] = lerp(setK[key] ?? 0, key === season ? 1 : 0, 1 - Math.exp(-dt * 1.3)); fadeGroup(sets[key].g, setK[key]); }
        sets.sonbahar.mists.forEach((m) => { m.sp.position.x += m.v * dt; if (m.sp.position.x > 24) m.sp.position.x = -24; });
        if (spawnT > 0) { spawnT -= dt; if (spawnT <= 0) spawnSeason(season); }
        // hava
        const W = sets[season]?.weather;
        if (W) { wState.t -= dt; if (wState.t <= 0) { wState.raining = !wState.raining; const [a, b] = wState.raining ? W.rain : W.dry; wState.t = a + r() * (b - a); if (!wState.raining) wState.after = 1; } }
        else wState.raining = false;
        wState.level = lerp(wState.level, wState.raining ? W.max : 0, 1 - Math.exp(-dt * 0.6));
        env.rain = wState.level; rainMat.opacity = env.rain * 0.55; rain.visible = env.rain > 0.02;
        if (rain.visible) {
          const lean = 0.08 + gust * 0.12, n = Math.floor(NR * clamp(env.rain * 1.2));
          for (let i = 0; i < NR; i++) {
            const d = drops[i]; d.y -= d.v * dt; d.x += lean * d.v * dt;
            if (d.y < ground(d.x, d.z)) { d.y = 12 + r() * 3; d.x = (r() - 0.5) * 34; }
            const on = i < n ? 1 : 0, q = i * 6;
            rPos[q] = d.x; rPos[q + 1] = d.y * on - (1 - on) * 50; rPos[q + 2] = d.z; rPos[q + 3] = d.x - lean * 0.35; rPos[q + 4] = (d.y + 0.35) * on - (1 - on) * 50; rPos[q + 5] = d.z;
          }
          rainGeo.attributes.position.needsUpdate = true;
        }
        env.flash = Math.max(0, env.flash - dt * 3.5);
        if (W?.lightning && env.rain > 0.3) { boltT -= dt; if (boltT <= 0) { boltT = 8 + r() * 4; env.flash = 0.85; flicker = 0.16 + r() * 0.08; bolt.position.x = (r() - 0.5) * 50; bolt.position.y = 10 + r() * 4; } }
        if (flicker > 0) { flicker -= dt; if (flicker <= 0) env.flash = Math.max(env.flash, 0.65); }
        bolt.material.opacity = env.flash * 0.9; bolt.visible = env.flash > 0.01;
        wState.after = Math.max(0, wState.after - dt / 28);
        const rbx = sets.ilkbahar.rbMat; rbx.uniforms.uOp.value = lerp(rbx.uniforms.uOp.value, season === 'ilkbahar' ? 0.08 + wState.after * 0.5 * (1 - env.rain) : 0, 1 - Math.exp(-dt));
        sets.ilkbahar.rb.visible = rbx.uniforms.uOp.value > 0.01;

        // yerdeki hayvanlar
        for (const m of active) {
          if (m.opts.den && !m.leader) {   // ayı: yağmur başlayınca mağaraya sığınır, dinince çıkar
            if (m.state !== 'inside' && !m.denTrip && (env.rain > 0.35 || r() < dt * 0.01)) { m.denTrip = true; m.state = 'walk'; m.target = V(den.x, 0, den.z); }
            if (m.denTrip && Math.hypot(m.x - den.x, m.z - den.z) < 0.4) { m.state = 'inside'; m.inside = 10 + r() * 8; m.denTrip = false; }
            if (m.state === 'inside') { m.speed = 0; m.inside -= dt; if (m.inside <= 0 && env.rain < 0.3) { m.state = 'walk'; m.pickTarget(r); } }
          }
          if (m.state === 'inside') { m.a.root.visible = false; continue; }
          m.update(dt, t, r, ground);
          const L = m.leader || m, hide = L.state === 'inside' && Math.hypot(m.x - den.x, m.z - den.z) < 1.4;
          m.a.root.visible = !hide;
        }
        for (let i = leaving.length - 1; i >= 0; i--) {
          const L = leaving[i];
          if (L.a) { L.update(dt, t, r, ground); L.leaveT = (L.leaveT || 0) + dt; if (L.done || L.leaveT > 9 || (L.intoCave && Math.hypot(L.x - den.x, L.z - den.z) < 0.5)) { scene.remove(L.a.root); leaving.splice(i, 1); } continue; }
          if (L.swim) { L.swim.k = Math.max(0, L.swim.k - dt * 0.8); L.swim.list.forEach((d) => d.a.root.scale.setScalar(Math.max(0.001, d.a.root.userData.base * L.swim.k))); if (L.swim.k <= 0) { L.swim.list.forEach((d) => scene.remove(d.a.root)); leaving.splice(i, 1); } continue; }
          if (L.climber) { const c = L.climber; c.a.root.position.y += dt * 1.5; c.a.root.position.x += dt * 2; c.out = (c.out || 0) + dt; c.a.animate(dt, t, 1, {}); if (c.out > 2.5) { scene.remove(c.a.root); leaving.splice(i, 1); } continue; }
          if (L.fly) { const f = L.fly, o = f.a.root; o.position.y += dt * 3; o.position.x += dt * 6 * (o.position.x >= 0 ? 1 : -1); f.a.animate(dt, t, 1, { ph: f.ph }); if (Math.abs(o.position.x) > 30) { scene.remove(o); leaving.splice(i, 1); } continue; }
          if (L.flutter) { const f = L.flutter; f.b.root.position.y += dt * 1.5; f.k += dt; if (f.k > 3) { scene.remove(f.b.root); leaving.splice(i, 1); } continue; }
          if (L.drag) { const d = L.drag.d.root; d.position.y += dt * 1.2; d.position.x += dt * 2.5; L.drag.out = (L.drag.out || 0) + dt; if (L.drag.out > 3) { scene.remove(d); leaving.splice(i, 1); } continue; }
          if (L.owl) { const o = L.owl; o.out = (o.out || 0) + dt; o.a.root.position.add(V(dt * 3.5 * (o.dx >= 0 ? 1 : -1), dt * 2.4, dt)); o.a.animate(dt, t, 1, {}); if (o.out > 4) { scene.remove(o.a.root); leaving.splice(i, 1); } continue; }
        }
        if (spawnQ.length) spawnGroup(spawnQ.shift()());   // her karede bir grup: mevsim geçişinde takılma olmasın
        for (const sw of swims) {   // ördek aileleri: göletin ön yarısında, anne önde yavrular sıra halinde
          sw.k = Math.min(1, sw.k + dt * 0.6); sw.u += dt * 0.12 * sw.dir;
          const path = (u) => V(pond.x + sw.cx + Math.cos(u) * pond.rx * sw.rx, pond.y + 0.01, pond.z + sw.cz + Math.sin(u) * pond.rz * sw.rz);
          sw.list.forEach((d, j) => {
            const uu = sw.u - d.lag * sw.dir, p = path(uu), p2 = path(uu + 0.02 * sw.dir);
            d.a.root.position.copy(p); d.a.root.rotation.y = Math.atan2(-(p2.z - p.z), p2.x - p.x);
            d.a.root.scale.setScalar(Math.max(0.001, d.a.root.userData.base * smooth(sw.k * 1.5 - j * 0.1)));
            d.a.animate(dt, t, 0.2, { dab: j === 0 && Math.sin(t * 0.35 + sw.cx) > 0.93, ph: j * 0.7 });
          });
        }
        for (const c of climbers) {   // dallarda koşturan sincaplar: hızlanır, durup oturur, döner
          c.k = Math.min(1, c.k + dt * 0.7);
          if (c.pause > 0) { c.pause -= dt; c.v = lerp(c.v || 0, 0, 1 - Math.exp(-dt * 6)); c.a.animate(dt, t, 0, { sit: c.pause > 0.6, alert: c.pause < 0.6 }); }
          else { c.v = lerp(c.v || 0, c.sp, 1 - Math.exp(-dt * 3)); c.u += c.dir * dt * c.v; if (c.u > 0.86 || c.u < 0.08) { c.dir *= -1; c.u = clamp(c.u, 0.08, 0.86); c.pause = 1.2 + r() * 2.8; } else if (r() < dt * 0.15) c.pause = 0.8 + r() * 1.5; c.a.animate(dt, t, 0.4 + c.v * 4, {}); }
          const p = c.limb.path(c.u), p2 = c.limb.path(c.u + 0.01 * c.dir);
          c.a.root.position.copy(p).add(V(0, 0.06 + gust * 0.01, 0.16)); c.a.root.rotation.y = Math.abs(p2.x - p.x) < 0.002 ? (c.dir > 0 ? 0 : Math.PI) : Math.atan2(-(p2.z - p.z), p2.x - p.x); c.a.root.scale.setScalar(Math.max(0.001, smooth(c.k)) * 1.35);
        }
        for (const D of drags) {   // yusufçuklar: havada asılı durur, sonra kısa ve hızlı bir atılışla yer değiştirir
          D.k = Math.min(1, D.k + dt * 0.5); D.w -= dt; const o = D.d.root;
          if (D.mode === 'hover') { o.position.set(D.p.x + Math.sin(t * 2.3 + D.ph) * 0.03, D.p.y + Math.sin(t * 3.1 + D.ph) * 0.02, D.p.z + Math.cos(t * 1.9 + D.ph) * 0.03);
            if (D.w < 0) { D.mode = 'dart'; D.ft = 0; D.from.copy(o.position); D.to.set(pond.x + (r() - 0.5) * pond.rx * 1.5, pond.y + 0.2 + r() * 0.45, pond.z + (r() - 0.5) * pond.rz * 1.4); o.rotation.y = Math.atan2(-(D.to.z - D.from.z), D.to.x - D.from.x); } }
          else { D.ft += dt / 0.45; const e = smooth(D.ft); o.position.lerpVectors(D.from, D.to, e); o.position.y += Math.sin(e * Math.PI) * 0.08; if (D.ft >= 1) { D.mode = 'hover'; D.p.copy(D.to); D.w = 0.8 + r() * 2.5; } }
          o.scale.setScalar(smooth(D.k) * 1.4); D.d.wings.forEach((w, j) => (w.w.rotation.y = Math.sin(t * 55 + j * 1.6) * 0.35));
        }
        for (const o of owls) {   // kovuktaki baykuşlar: etrafı izler, göz kırpar
          o.k = Math.min(1, o.k + dt * 0.5);
          o.a.root.position.set(hollow.x + o.dx, hollow.y - 0.2 + o.dy - (1 - smooth(o.k)) * 0.25, hollow.z + 0.14 + Math.abs(o.dx) * -0.3);
          o.lookT -= dt; if (o.lookT <= 0) { o.look = (r() - 0.5) * 2.4; o.lookT = 2 + r() * 4; }
          o.a.animate(dt, t, 0, { yaw: o.look });
        }
        for (const f of flyers) {
          f.enter = Math.min(1, f.enter + dt * 0.25);
          if (f.kind === 'robin') {   // kış kuşları: çıplak dallara konar, ara sıra başka bir dala uçar
            const o = f.a.root;
            if (f.mode === 'perch') { o.position.copy(f.to); f.wait -= dt; f.a.animate(dt, t, 0, { perch: true, ph: f.ph }); if (f.wait < 0) { f.mode = 'fly'; f.ft = 0; f.from = o.position.clone(); f.to = perchPt(); } }
            else { f.ft += dt / 1.5; const e = smooth(Math.max(0, f.ft)), pr = o.position.clone();
              o.position.lerpVectors(f.from, f.to, e); o.position.y += Math.sin(e * Math.PI) * 0.7;
              tmp.subVectors(o.position, pr); if (tmp.lengthSq() > 1e-7) o.rotation.y = Math.atan2(-tmp.z, tmp.x);
              f.a.animate(dt, t, 1, { ph: f.ph, glide: e > 0.75, pitch: clamp(tmp.y * 30, -0.4, 0.4) });
              if (f.ft >= 1) { f.mode = 'perch'; f.wait = 4 + r() * 8; o.rotation.y = r() < 0.5 ? 0 : Math.PI; } }
            continue;
          }
          let x, y, z, glide = false;
          if (f.kind === 'swallow') {   // dalgalı, birlikte kıvrılan kırlangıç sürüsü
            const a = (t - f.i * 0.1) * 0.28; const cx = Math.sin(a) * 8 + Math.sin(a * 2.1) * 2, cy = 6.7 + Math.sin(a * 1.4) * 0.6, cz = -3.5 + Math.cos(a) * 2.5;
            x = cx + Math.cos(f.i * 2.4) * 1.0; y = cy + Math.sin(f.i * 1.9) * 0.45 + Math.sin(t * 1.6 + f.i * 0.8) * 0.25; z = cz + Math.sin(f.i * 2.4) * 0.8;
            glide = Math.sin(t * 0.9 + f.i * 0.7) > 0.35;
          } else if (f.kind === 'gull') {   // deniz ufkunda geniş kavislerle süzülen martılar
            const a = t * 0.11 + f.i * 0.45; x = Math.cos(a) * 13 + Math.sin(t * 0.07 + f.i) * 3; y = 5.9 + Math.sin(a * 2 + f.i) * 0.5 + (f.i % 4) * 0.25; z = -19 + Math.sin(a) * 4 + (f.i % 3) * 0.9;
            glide = Math.sin(t * 0.45 + f.ph) > -0.55;
          } else {   // göçmen kuşlar: V düzeninde, hafif dalgalanarak
            const lead = ((t * 1.4) % 90) - 45, row = Math.ceil(f.i / 2), sd = f.i % 2 ? 1 : -1;
            x = lead - row * 0.95; y = 7.4 + Math.sin(t * 0.4 + row * 0.35) * 0.3 - row * 0.04 + Math.sin(lead * 0.06) * 0.5; z = -11 + sd * row * 0.8;
            glide = Math.sin(t * 0.6 + row * 0.45) > 0.25;
          }
          const pr = f.a.root.position.clone(), ex = (1 - smooth(f.enter)) * (x >= 0 ? 20 : -20);
          f.a.root.position.set(x + ex, y + (1 - smooth(f.enter)) * 3, z);
          tmp.subVectors(f.a.root.position, pr);
          let pitch = 0; if (tmp.lengthSq() > 1e-6) { const goal = Math.atan2(-tmp.z, tmp.x); let dy = goal - f.a.root.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; f.a.root.rotation.y += dy * (1 - Math.exp(-dt * 6)); pitch = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.5, 0.5); }
          f.a.animate(dt, t, 1, { glide, ph: f.ph, pitch });
        }
        for (const f of flies) {
          f.k = Math.min(1, f.k + dt * 0.4);
          const q = t * f.sp + f.ph;
          f.b.root.position.set(f.c.x + Math.sin(q * 0.9) * 1.4 + Math.sin(q * 2.3) * 0.3, f.c.y + Math.sin(q * 1.3) * 0.5, f.c.z + Math.cos(q * 0.7) * 1.0);
          f.b.root.rotation.y = Math.atan2(0.7 * Math.cos(q * 0.7), 1.26 * Math.cos(q * 0.9)); f.b.root.scale.setScalar(1.3 * f.k);
          const gl = Math.sin(t * 0.8 + f.ph) > 0.55 ? 0.25 : 1, fl = (Math.sin(t * 18 + f.ph) * 0.9 + 0.2) * gl + (1 - gl) * 0.5; f.b.L.rotation.x = fl; f.b.R.rotation.x = -fl;
        }
      }
      // kalite değişince mevsimin hayvanlarını yeni yoğunlukla yeniden yerleştir
      function refresh() { const s = season; if (!s) return; season = ''; setSeason(s); }
      return { setSeason, refresh, update, env, den, pond };
    },
  };
})();
