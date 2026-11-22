// tree3d.js - Ana sayfa: HAYAT AĞACI (Three.js r158, global THREE + book3d.js'deki window.Book3D).
// Pastel, sisli bir tepede birbirine sarılmış iki ince gövde; taç on binlerce minik parçacıktan
// oluşan pamuk gibi kabarık kümeler. Dallardan 5 adımın kitabı ipe asılı; tıklanınca o adıma gidilir.
// Mevsim değişince renkler soldan sağa bir dalga gibi geçer. İlk açılışta ağaç büyüyerek belirir.
//   window.TreeHome.attach(wrapEl, { onPick(tab) }) -> { setSeason(s), setState({done,next,running}), reset(), grow(), dispose() }
(function () {
  const T = window.THREE, B = window.Book3D;
  if (!T || !B) return;
  const { Book, makeStage, rng, canvas, clamp, lerp, spring, leafGeo } = B;

  const STEPS = [
    { tab: 'ocr', title: 'OCR', sub: '1. adım', color: '#a4592f', name: 'OCR Tarama' },
    { tab: 'editor', title: 'DÜZELTME', sub: '2. adım', color: '#2e7d50', name: 'Düzeltme' },
    { tab: 'structure', title: 'YAPI', sub: '3. adım', color: '#1f4a7a', name: 'Yapı & Dizgi' },
    { tab: 'cover', title: 'KAPAK', sub: '4. adım', color: '#8b2028', name: 'Kapak' },
    { tab: 'epub', title: 'EPUB', sub: '5. adım', color: '#b7862a', name: 'EPUB' },
  ];
  // mevsim paletleri: taç (açık/orta/gölge), gövde, zemin, gökyüzü, parçacık
  // Renk takımları. acc: tacın bir kısmına serpilen ikinci renk (ilkbaharda yeşil yaprak, sonbaharda kırmızı vb.)
  const PALETTES = {
    // Hayat Ağacı: adaçayı yeşili, krem gökyüzü; gövde renkleri liflerden gelir (bark = çarpan)
    hayat: {
      ilkbahar: { hi: '#f5e3e6', mid: '#b9cf86', sh: '#5f7d45', acc: '#f0a9bf', accAmt: 0.32, bark: '#f2f2f2', ground: '#7d9a5a', skyTop: '#CFE8F3', skyHz: '#F4F9F4', fog: '#e6efec', hemi: '#f6fbff', light: { k: 1.0, h: 1.0, kc: '#fff8ec', dim: '#ffffff', glow: 'rgba(255,255,255,.55)', near: 15, far: 58 }, part: ['#f6c6d4', '#fde4ec', '#ffffff'], kind: 'petal' },
      yaz: { hi: '#dbe5a6', mid: '#93ab5e', sh: '#465f35', acc: '#c5d684', accAmt: 0.15, bark: '#ffffff', ground: '#5f7c45', skyTop: '#AEE2F5', skyHz: '#FFF6E0', fog: '#fbf1da', hemi: '#fff8e6', light: { k: 1.3, h: 1.05, kc: '#ffe7b8', dim: '#ffffff', glow: 'rgba(255,240,200,.7)', near: 20, far: 70 }, part: ['#ffffff', '#f4f7d8'], kind: 'pollen' },
      sonbahar: { hi: '#f3d27e', mid: '#c98b3c', sh: '#764624', acc: '#b4502e', accAmt: 0.25, bark: '#f4ece2', ground: '#8a7a45', skyTop: '#6E737B', skyHz: '#C89D6C', fog: '#b0937a', hemi: '#e6d6c4', light: { k: 0.62, h: 0.72, kc: '#f2cf9e', dim: '#c8b9a6', glow: 'rgba(255,210,150,.22)', near: 12, far: 52 }, part: ['#d98a3a', '#b4502e', '#e8b84a', '#8a4a26'], kind: 'leaf' },
      kis: { hi: '#ffffff', mid: '#dde4e2', sh: '#8a9998', acc: '#a2aea6', accAmt: 0.18, bark: '#dfe2e8', ground: '#e8ecec', skyTop: '#162238', skyHz: '#3A506B', fog: '#33475f', hemi: '#8ea4c8', light: { k: 0.34, h: 0.46, kc: '#a9bde6', dim: '#7c8cab', glow: 'rgba(170,195,255,.16)', near: 14, far: 60 }, part: ['#ffffff'], kind: 'snow' },
    },
    pastel: {
      ilkbahar: { hi: '#ffe3ea', mid: '#f0a6bb', sh: '#a9577a', acc: '#ffffff', accAmt: 0, bark: '#bfaab8', ground: '#f5e3e8', skyTop: '#f4dbe5', skyHz: '#fbf0f2', hemi: '#fff2f6', part: ['#f6c6d4', '#fde4ec', '#ffffff'], kind: 'petal' },
      yaz: { hi: '#d7efd2', mid: '#73b282', sh: '#2c6a4e', acc: '#ffffff', accAmt: 0, bark: '#6f8079', ground: '#e2eee5', skyTop: '#dde9e2', skyHz: '#f1f6f2', hemi: '#f3fbf4', part: ['#ffffff', '#f4f7d8'], kind: 'pollen' },
      sonbahar: { hi: '#ffe1a6', mid: '#e99447', sh: '#93442a', acc: '#ffffff', accAmt: 0, bark: '#8a7262', ground: '#f1e1cf', skyTop: '#f3e1d0', skyHz: '#fbf2e8', hemi: '#fff4e6', part: ['#e9954a', '#c9542f', '#f1bd4e', '#a7482a'], kind: 'leaf' },
      kis: { hi: '#f6f3ff', mid: '#b9b1e8', sh: '#6a62a6', acc: '#ffffff', accAmt: 0, bark: '#a7a1c4', ground: '#ebe9f7', skyTop: '#e2e1f4', skyHz: '#f4f3fb', hemi: '#f3f2ff', part: ['#ffffff'], kind: 'snow' },
    },
    dogal: {
      ilkbahar: { hi: '#fff0f4', mid: '#f3a7bf', sh: '#b05578', acc: '#8cc866', accAmt: 0.3, bark: '#6d5446', ground: '#cfe2b4', skyTop: '#d9e7f5', skyHz: '#f5f8fb', hemi: '#f4f8ff', part: ['#f6c6d4', '#fde4ec', '#ffffff'], kind: 'petal' },
      yaz: { hi: '#bde28c', mid: '#4f9a3c', sh: '#1c5528', acc: '#d9ea72', accAmt: 0.1, bark: '#5b4636', ground: '#a8cf86', skyTop: '#cbe1f6', skyHz: '#eef6fc', hemi: '#f2f8ff', part: ['#ffffff', '#f6f9d0'], kind: 'pollen' },
      sonbahar: { hi: '#ffd166', mid: '#e2772a', sh: '#8a2c1a', acc: '#c23a2a', accAmt: 0.3, bark: '#5e4535', ground: '#d8b98a', skyTop: '#f0dcc2', skyHz: '#fbf0e3', hemi: '#fff2e2', part: ['#e2772a', '#c23a2a', '#f2b84a', '#9a3d22'], kind: 'leaf' },
      kis: { hi: '#ffffff', mid: '#dde7f2', sh: '#8299b4', acc: '#6b5a52', accAmt: 0.1, bark: '#4f4440', ground: '#f3f6fa', skyTop: '#d7e3f1', skyHz: '#f3f6fa', hemi: '#eef4ff', part: ['#ffffff'], kind: 'snow' },
    },
    canli: {
      ilkbahar: { hi: '#ffd9ea', mid: '#ff7fb2', sh: '#c22f6e', acc: '#ffe56e', accAmt: 0.1, bark: '#5b3f3a', ground: '#bfe39a', skyTop: '#ffe3ef', skyHz: '#fff6fa', hemi: '#fff4fa', part: ['#ff9cc4', '#ffd2e6', '#ffffff'], kind: 'petal' },
      yaz: { hi: '#ccf76a', mid: '#3cbf4e', sh: '#0e6a39', acc: '#ffd84d', accAmt: 0.08, bark: '#4f3a2c', ground: '#8fd16c', skyTop: '#c4e9ff', skyHz: '#effaff', hemi: '#f0fbff', part: ['#ffffff', '#fff6b0'], kind: 'pollen' },
      sonbahar: { hi: '#ffd23d', mid: '#ff6a1a', sh: '#b01e18', acc: '#ff3a3a', accAmt: 0.25, bark: '#4f3427', ground: '#e8b76a', skyTop: '#ffdcbc', skyHz: '#fff3e5', hemi: '#fff1e0', part: ['#ff6a1a', '#ff3a3a', '#ffc23d', '#c0301c'], kind: 'leaf' },
      kis: { hi: '#ffffff', mid: '#bfe2ff', sh: '#3f78c2', acc: '#e6f5ff', accAmt: 0.2, bark: '#3d3a48', ground: '#eef7ff', skyTop: '#d1eaff', skyHz: '#f1f8ff', hemi: '#eef7ff', part: ['#ffffff'], kind: 'snow' },
    },
  };
  let PAL = PALETTES.hayat;


  // ---------- ortak uniform'lar ----------
  const U = {
    uTime: { value: 0 }, uGust: { value: 0 }, uGrow: { value: 1.5 }, uGrowY: { value: 99 }, uWipe: { value: 9 }, uScale: { value: 600 },
    uHiA: { value: new T.Color() }, uMidA: { value: new T.Color() }, uShA: { value: new T.Color() },
    uHiB: { value: new T.Color() }, uMidB: { value: new T.Color() }, uShB: { value: new T.Color() },
    uAccA: { value: new T.Color() }, uAccB: { value: new T.Color() }, uAccAmtA: { value: 0 }, uAccAmtB: { value: 0 },
    uLight: { value: new T.Vector3(-0.45, 0.8, 0.4).normalize() },
    uSnow: { value: 0 }, uMoss: { value: 1 }, uBare: { value: 0 },
    uDim: (window.Scenery && window.Scenery.DIM) || { value: new T.Color(1, 1, 1) },
    uLamp: { value: [0, 1, 2, 3, 4, 5].map(() => new T.Vector3(0, -99, 0)) }, uLampI: { value: [0, 0, 0, 0, 0, 0] },
  };
  const SWAY_GLSL = `
    uniform float uTime; uniform float uGust;
    vec3 treeSway(vec3 p) {
      float h = max(0.0, p.y - 1.2);
      float k = h * h * 0.009;
      return vec3(sin(uTime * 0.8 + p.y * 0.45 + p.x * 0.2) * k + uGust * h * h * 0.01, 0.0, cos(uTime * 0.62 + p.x * 0.35) * k * 0.7);
    }
  `;
  function swayJS(p, t, gust, out) {
    const h = Math.max(0, p.y - 1.2), k = h * h * 0.009;
    return out.set(Math.sin(t * 0.8 + p.y * 0.45 + p.x * 0.2) * k + gust * h * h * 0.01, 0, Math.cos(t * 0.62 + p.x * 0.35) * k * 0.7);
  }
  // gövde/dal malzemesi: rüzgârla sallanır, büyüme sırasında aşağıdan yukarı belirir
  function barkPatch(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uGust = U.uGust; sh.uniforms.uGrowY = U.uGrowY; sh.uniforms.uSnow = U.uSnow; sh.uniforms.uMoss = U.uMoss;
      sh.vertexShader = SWAY_GLSL + 'varying float vGrowY; varying vec3 vWN; varying vec3 vWP;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        vGrowY = mvPosition.y; vWP = mvPosition.xyz; vWN = normalize(objectNormal);
        mvPosition.xyz += treeSway(mvPosition.xyz);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = 'uniform float uGrowY; uniform float uSnow; uniform float uMoss;\nvarying float vGrowY; varying vec3 vWN; varying vec3 vWP;\n' + sh.fragmentShader
        .replace('void main() {', 'void main() {\n  if (vGrowY > uGrowY) discard;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float nz = fract(sin(dot(floor(vWP.xz * 9.0) + floor(vWP.y * 9.0), vec2(12.9898, 78.233))) * 43758.5453);
          float moss = smoothstep(0.15, 0.7, vWN.y) * (1.0 - smoothstep(0.7, 1.7, vWP.y)) * (0.45 + 0.55 * nz) * uMoss;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.42, 0.18), moss * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), smoothstep(0.3, 0.68, vWN.y + nz * 0.12) * uSnow);`);
    };
    return mat;
  }

  // ---------- taç: kabarık parçacık kümeleri ----------
  const FOLIAGE_VS = SWAY_GLSL + `
    attribute vec3 aNormal; attribute float aSize; attribute float aRand; attribute float aDelay; attribute float aShade; attribute float aTone;
    uniform float uGrow; uniform float uWipe; uniform float uScale; uniform vec3 uLight;
    uniform vec3 uHiA; uniform vec3 uMidA; uniform vec3 uShA; uniform vec3 uHiB; uniform vec3 uMidB; uniform vec3 uShB;
    uniform vec3 uAccA; uniform vec3 uAccB; uniform float uAccAmtA; uniform float uAccAmtB;
    uniform float uBare; uniform vec3 uDim; uniform vec3 uLamp[6]; uniform float uLampI[6];
    varying vec3 vCol;
    #include <fog_pars_vertex>
    void main() {
      float g = clamp((uGrow - aDelay) / 0.38, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
      vec3 p = position;
      p += aNormal * (sin(uTime * 1.3 + aRand * 31.0) * 0.006 - (1.0 - g) * 0.25);   // nefes alır; büyürken içten dışa açılır
      p += treeSway(p);
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      float bare = ((aTone < 0.25 || (aTone < 0.75 && fract(aRand * 5.3) < 0.75)) && fract(aRand * 13.7) < uBare * 1.02) ? 0.0 : 1.0;   // kışın taç tamamen dökülür
      gl_PointSize = aSize * g * bare * uScale / -mvPosition.z;
      if (bare * g < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // dökülen yaprak hiç çizilmez (1 piksellik iz kalmasın)
      vec3 n = normalize(aNormal);
      float diff = dot(n, uLight) * 0.5 + 0.5;
      float l = diff * mix(0.42, 1.0, aShade) + (n.y < 0.0 ? n.y * 0.16 : 0.0);
      float f = smoothstep(position.x - 0.9, position.x + 0.9, uWipe);
      vec3 hi = mix(uHiA, uHiB, f), mid = mix(uMidA, uMidB, f), sh = mix(uShA, uShB, f);
      vec3 c = l < 0.55 ? mix(sh, mid, clamp(l / 0.55, 0.0, 1.0)) : mix(mid, hi, (l - 0.55) / 0.45);
      float r2 = fract(aRand * 7.31 + aDelay * 3.7);
      if (r2 < mix(uAccAmtA, uAccAmtB, f)) c = mix(uAccA, uAccB, f) * (0.5 + l * 0.65);
      c = mix(c, sh * (0.55 + l * 0.6), aTone > 0.75 ? 0.75 : 0.0);          // çalılar: koyu yeşil
      c = mix(c, mix(mid, hi, 0.6), aTone > 0.25 && aTone < 0.75 ? 0.45 : 0.0); // uzak ağaçlar: açık, sisli
      vCol = c * (0.9 + aRand * 0.18) * uDim;
      float lamp = 0.0; for (int i = 0; i < 6; i++) { vec3 d = p - uLamp[i]; lamp += uLampI[i] * exp(-dot(d, d) * 2.4); }
      vCol += vec3(1.0, 0.7, 0.32) * min(lamp, 1.2) * (0.55 + (1.0 - uDim.g) * 0.6);   // gece fener ışığı daha belirgin
      #include <fog_vertex>
    }`;
  const FOLIAGE_FS = `
    varying vec3 vCol;
    #include <fog_pars_fragment>
    void main() {
      vec2 d = gl_PointCoord - 0.5; float r = length(d);
      if (r > 0.5) discard;
      gl_FragColor = vec4(vCol * (1.0 - r * 0.25), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;

  // ---------- yaprak kümeleri (taç, çalılar, arkadaki ağaçlar) ----------
  // clusters: [{ c: Vector3, r, tone (0 taç, 1 çalı, 0.5 uzak ağaç), delay, n }]
  function buildFoliage(clusters, r) {
    const P = [], N = [], S = [], R = [], D = [], A = [], O = [];
    const v = new T.Vector3(), dir = new T.Vector3(), cn = new T.Vector3();
    for (const cl of clusters) {
      const C = cl.c, cr = cl.r;
      const blobs = [];
      const nb = 4 + Math.floor(r() * 4);
      for (let b = 0; b < nb; b++) {
        dir.set(r() - 0.5, (r() - 0.3) * 0.8, r() - 0.5).normalize();
        blobs.push({ c: C.clone().addScaledVector(dir, cr * (0.2 + r() * 0.45)), r: cr * (0.45 + r() * 0.3) });
      }
      blobs.push({ c: C.clone(), r: cr * 0.6 });
      const count = Math.floor((cl.n || 9000) * Math.pow(cr / 0.75, 2));
      for (let i = 0; i < count; i++) {
        const b = blobs[Math.floor(r() * blobs.length)];
        dir.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); if (dir.lengthSq() < 1e-4) continue; dir.normalize();
        v.copy(b.c).addScaledVector(dir, b.r * (1 - Math.pow(r(), 2.5) * 0.4));
        let hidden = false;
        for (const o of blobs) if (o !== b && v.distanceTo(o.c) < o.r * 0.84) { hidden = true; break; }
        if (hidden) continue;
        cn.subVectors(v, C).normalize().multiplyScalar(0.55).addScaledVector(dir, 0.45).normalize();
        P.push(v.x, v.y, v.z); N.push(cn.x, cn.y, cn.z);
        S.push((cl.size || 0.026) + r() * (cl.size || 0.026) * 0.8); R.push(r()); D.push(cl.delay + r() * 0.05);
        A.push(clamp(v.distanceTo(C) / (cr * 1.05))); O.push(cl.tone || 0);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('aNormal', new T.Float32BufferAttribute(N, 3));
    g.setAttribute('aSize', new T.Float32BufferAttribute(S, 1));
    g.setAttribute('aRand', new T.Float32BufferAttribute(R, 1));
    g.setAttribute('aDelay', new T.Float32BufferAttribute(D, 1));
    g.setAttribute('aShade', new T.Float32BufferAttribute(A, 1));
    g.setAttribute('aTone', new T.Float32BufferAttribute(O, 1));
    const mat = new T.ShaderMaterial({ vertexShader: FOLIAGE_VS, fragmentShader: FOLIAGE_FS, fog: true, uniforms: Object.assign(T.UniformsUtils.clone(T.UniformsLib.fog), U) });
    const pts = new T.Points(g, mat); pts.frustumCulled = false;
    return pts;
  }

  // ---------- dallar, gövde lifleri, kökler ----------
  function taperTube(curve, r0, r1, segs, radial, col) {
    const g = new T.TubeGeometry(curve, segs, 1, radial, false), pa = g.attributes.position, c = new T.Vector3();
    const colors = new Float32Array(pa.count * 3), cc = new T.Color();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, c);
      const u = i / segs, rr = lerp(r0, r1, Math.pow(u, 0.8));
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        pa.setXYZ(k, c.x + (pa.getX(k) - c.x) * rr, c.y + (pa.getY(k) - c.y) * rr, c.z + (pa.getZ(k) - c.z) * rr);
        cc.copy(col).multiplyScalar(0.86 + 0.14 * Math.sin(u * 9 + j));     // lif boyunca hafif ton oynaması
        colors.set([cc.r, cc.g, cc.b], k * 3);
      }
    }
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    return g;
  }
  function mergeGeos(geos) {
    let nv = 0, ni = 0;
    for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); uv.set(g.attributes.uv.array, ov * 2); col.set(g.attributes.color.array, ov * 3);
      const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov;
      ov += g.attributes.position.count; oi += ia.length; g.dispose();
    }
    const m = new T.BufferGeometry();
    m.setAttribute('position', new T.BufferAttribute(pos, 3)); m.setAttribute('normal', new T.BufferAttribute(nor, 3));
    m.setAttribute('uv', new T.BufferAttribute(uv, 2)); m.setAttribute('color', new T.BufferAttribute(col, 3)); m.setIndex(new T.BufferAttribute(idx, 1));
    return m;
  }
  // tepe: ağacın oturduğu geniş, yuvarlak höyük
  function hillH(x, z) {
    const mound = 1.0 * Math.exp(-(x * x * 0.09 + z * z * 0.28));
    const ripple = 0.05 * Math.sin(x * 1.3 + z * 0.9) * Math.exp(-(x * x + z * z) * 0.03);
    const far = Math.min(1, Math.max(0, (-z - 4.5) / 9));
    const hills = far * far * (0.7 + 0.6 * Math.sin(x * 0.17 + 1.3) + 0.35 * Math.sin(x * 0.41 + 0.4) + 0.3 * Math.sin(z * 0.3 + x * 0.1));
    return mound + ripple - 0.08 + hills;
  }
  // lif renkleri: altın-zeytin, kahve ve mavi-gri damarlar
  const STRAND_COLS = ['#b9a46a', '#d2bd80', '#9a9580', '#8c98a0', '#a88c5e', '#e0cc8e', '#b29e72', '#93a08a'];

  // kubbe taç: merkezi ve yarıçapları
  const DOME = { c: new T.Vector3(0, 4.55, -0.15), rx: 3.35, ry: 2.35, rz: 2.0 };
  function domePoint(dir, k = 1) {
    const d = dir.clone().normalize();
    return new T.Vector3(DOME.c.x + d.x * DOME.rx * k, DOME.c.y + d.y * DOME.ry * k, DOME.c.z + d.z * DOME.rz * k);
  }

  function buildTree(r) {
    const geos = [], V = (x, y, z) => new T.Vector3(x, y, z), cols = STRAND_COLS.map((c) => new T.Color(c));
    const clusters = [], anchors = [];
    const base = hillH(0, 0) - 0.15, fork = 3.0;
    const NS = 14;
    // gövde: 14 lif birbirine sarılarak yükselir; dipte genişleyip köklere, tepede ana dallara ayrılır
    const strands = [];
    for (let i = 0; i < NS; i++) {
      const ph = (i / NS) * Math.PI * 2 + (r() - 0.5) * 0.3, k = 0.6 + r() * 0.4, tw = 1.1 + r() * 0.5;
      strands.push({ ph, k, tw, col: cols[i % cols.length], rad: 0.085 + r() * 0.05, limb: i % 6 });
    }
    const trunkPt = (s, t) => {
      const a = s.ph + t * Math.PI * s.tw + Math.sin(t * 5 + s.ph * 2) * 0.25;
      const flare = Math.pow(Math.max(0, 1 - t / 0.22), 2) * 0.55;
      const R = (lerp(0.42, 0.26, t) + flare) * s.k;
      return V(Math.cos(a) * R, base + t * (fork - base), Math.sin(a) * R * 0.85);
    };
    // ana dallar (6): yelpaze gibi yukarı-dışa; ön tarafa bakan 5'inin ucuna adım küresi gelir
    const limbDirs = [V(-1, 0.55, 0.35), V(-0.55, 1, 0.45), V(0.05, 1, 0.55), V(0.6, 1, 0.42), V(1, 0.55, 0.32), V(0.1, 0.8, -1)];
    const limbs = limbDirs.map((d, g) => {
      const F = V(d.x * 0.15, fork, d.z * 0.1);
      const len = g === 5 ? 1.6 : 2.0 + r() * 0.3;
      const end = F.clone().addScaledVector(d.clone().normalize(), len);
      const side = V(-d.z, 0, d.x).normalize();
      const path = (s) => F.clone().lerp(end, s).addScaledVector(side, Math.sin(s * Math.PI * 1.6 + g) * 0.32 * Math.sin(s * Math.PI)).add(V(0, Math.sin(s * Math.PI) * 0.25, 0));
      return { d, F, end, side, path };
    });
    for (const s of strands) {
      // gövde kısmı
      const pts = []; for (let i = 0; i <= 10; i++) pts.push(trunkPt(s, i / 10));
      // ana dala devam: lif kendi dalının yolunu biraz yanından, etrafında burularak izler
      const L = limbs[s.limb], top = pts[pts.length - 1];
      for (let i = 1; i <= 8; i++) {
        const u = i / 8, p = L.path(u), w = (1 - u) * 0.5 + 0.06;
        const a = s.ph + u * 6;
        pts.push(p.addScaledVector(L.side, Math.cos(a) * w * 0.35).add(V(0, Math.sin(a) * w * 0.25, Math.sin(a) * w * 0.2)).lerp(top, Math.pow(1 - u, 6) * 0.0));
      }
      geos.push(taperTube(new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.4), s.rad * 1.15, 0.028, 110, 8, s.col));
      // kök: dipten dışarı, tepenin üstünde kıvrılarak
      const a0 = s.ph, Lr = 1.8 + r() * 1.6, rp = [trunkPt(s, 0.08)];
      for (let i = 1; i <= 9; i++) {
        const u = i / 9, a = a0 + Math.sin(u * 4 + s.ph * 3) * 0.35 * u, d = 0.45 + u * Lr;
        const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d * (Math.sin(a) > 0 ? 0.5 : 0.8);
        rp.push(V(x, hillH(x, z) + 0.05 * Math.sin(u * Math.PI) + 0.02 - u * 0.06, z));
      }
      geos.push(taperTube(new T.CatmullRomCurve3(rp), s.rad * 1.2, 0.012, 60, 8, s.col));
      // yan kökçük
      if (r() < 0.7) {
        const u0 = 0.35 + r() * 0.3, p0 = new T.CatmullRomCurve3(rp).getPointAt(u0), a = a0 + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5), d0 = Math.hypot(p0.x, p0.z);
        const sp = [p0]; for (let i = 1; i <= 5; i++) { const d = d0 + i * 0.28, x = Math.cos(a + i * 0.05) * d, z = Math.sin(a + i * 0.05) * d * 0.9; sp.push(V(x, hillH(x, z) + 0.015, z)); }
        geos.push(taperTube(new T.CatmullRomCurve3(sp), s.rad * 0.55, 0.008, 24, 6, s.col));
      }
    }
    // alt dallar: her ana dalın ucundan kıvrımlı dallar kubbenin kabuğuna uzanır, uçlarında yaprak kümeleri
    const branch = (from, to, r0, r1, col, wig) => {
      const mid = from.clone().lerp(to, 0.5), side = to.clone().sub(from).cross(V(0, 1, 0.3)).normalize();
      const p1 = from.clone().lerp(to, 0.33).addScaledVector(side, wig * (r() - 0.5) * 2), p2 = mid.clone().addScaledVector(side, -wig * (r() - 0.3)).add(V(0, wig * 0.6, 0));
      const c = new T.CatmullRomCurve3([from.clone(), p1, p2, from.clone().lerp(to, 0.78).add(V(0, 0.05, 0)), to.clone()]);
      geos.push(taperTube(c, r0, r1, 30, 7, col));
      return c;
    };
    limbs.forEach((L, g) => {
      const col = cols[(g * 3) % cols.length];
      const nb = g === 5 ? 3 : 4;
      for (let b = 0; b < nb; b++) {
        const dir = L.d.clone().normalize().add(V((r() - 0.5) * 1.1, (r() - 0.2) * 0.9, (r() - 0.5) * 1.0)).normalize();
        const tip = domePoint(dir.add(V(0, 0.15, 0)), 0.92 + r() * 0.08);
        const c = branch(L.end, tip, 0.06, 0.012, col, 0.35);
        clusters.push({ c: tip.clone(), r: 0.5 + r() * 0.2, tone: 0, delay: 0.45 + (tip.y - 3) / 3.5 * 0.5 });
        for (let k = 0; k < 3; k++) {
          const s0 = c.getPointAt(0.4 + k * 0.18);
          const d2 = s0.clone().sub(DOME.c).normalize().add(V((r() - 0.5) * 0.8, (r() - 0.3) * 0.6, (r() - 0.5) * 0.8));
          const t2 = domePoint(d2, 0.88 + r() * 0.1);
          branch(s0, t2, 0.022, 0.006, col, 0.15);
          clusters.push({ c: t2, r: 0.32 + r() * 0.18, tone: 0, delay: 0.5 + (t2.y - 3) / 3.5 * 0.5 });
        }
      }
      if (g < 5) anchors.push(L.end.clone().add(V(0, -0.02, 0.12)));
    });
    // kubbeyi tamamla: arka ve yanlarda boşluk kalmasın; ön yüz seyrek kalsın ki içteki dallar görünsün
    for (let i = 0; i < 70; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 1.15);   // üst yarıküre ağırlıklı
      const dir = V(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
      if (dir.z > 0.35 && dir.y < 0.55 && r() < 0.85) continue;
      const p = domePoint(dir, 0.95);
      clusters.push({ c: p, r: 0.34 + r() * 0.22, tone: 0, delay: 0.55 + (p.y - 3) / 3.5 * 0.5 });
    }
    // tepedeki çalılar (köklerin arasında koyu yeşil öbekler)
    const bushes = [];
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = 1.3 + Math.pow(r(), 0.7) * 3.2, x = Math.cos(a) * d * 1.25, z = Math.sin(a) * d * (Math.sin(a) > 0 ? 0.35 : 0.8) - 0.2;
      bushes.push({ c: V(x, hillH(x, z) + 0.06, z), r: 0.22 + r() * 0.2, tone: 1, delay: 0.1 + r() * 0.3, n: 6500, size: 0.024 });
    }
    // arkadaki küçük ağaçlar
    const bg = [], bgGeos = [];
    [[-14, -12, 0.9], [-12, -16, 0.75], [5.6, -12, 0.85], [8.4, -14, 0.7], [1.8, -15, 0.6], [11, -17, 0.7]].forEach(([x, z, s]) => {
      const y0 = hillH(x, z) - 0.3, c = cols[2];
      const tr = new T.CatmullRomCurve3([V(x, y0, z), V(x + 0.1 * s, y0 + 0.9 * s, z), V(x - 0.05 * s, y0 + 1.6 * s, z)]);
      bgGeos.push(taperTube(tr, 0.1 * s, 0.04 * s, 12, 6, c));
      for (let k = 0; k < 6; k++) {
        const p = V(x + (r() - 0.5) * 1.6 * s, y0 + (1.7 + r() * 0.7) * s, z + (r() - 0.5) * 0.6 * s);
        bgGeos.push(taperTube(new T.CatmullRomCurve3([V(x - 0.05 * s, y0 + 1.5 * s, z), p]), 0.04 * s, 0.01 * s, 8, 5, c));
        bg.push({ c: p, r: (0.35 + r() * 0.2) * s, tone: 0.5, delay: 0.2 + r() * 0.2, n: 5000, size: 0.03 });
      }
    });
    return { geo: mergeGeos(geos), bgGeo: mergeGeos(bgGeos), anchors, clusters, bushes, bg, limbs };
  }

  function hillGeometry() {
    const g = new T.PlaneGeometry(90, 90, 320, 320); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, hillH(p.getX(i), p.getZ(i)));
    g.computeVertexNormals(); return g;
  }
  function canopyShadowTex() {
    const c = canvas(512, 512), x = c.getContext('2d');
    const g = x.createRadialGradient(256, 256, 10, 256, 256, 256);
    g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(0.5, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    return new T.CanvasTexture(c);
  }
  function glowTexture() {
    const c = canvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.4, 'rgba(255,240,215,.45)'); g.addColorStop(1, 'rgba(255,235,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(c);
  }
  // kabuk dokusu: liflerin boyunca ince çizgiler (renk tepe noktalarından gelir)
  function barkTexture() {
    // asırlık kabuk: lif boyunca derin yarıklar, aralarında kabarık sırtlar, enine kırıklar
    const c = canvas(1024, 256), x = c.getContext('2d'), rr = rng(21);
    x.fillStyle = '#ece6dc'; x.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 90; i++) {
      const y = rr() * 256, x0 = rr() * 1024, len = 120 + rr() * 520, w = 2 + rr() * 5;
      x.strokeStyle = `rgba(30,20,12,${0.35 + rr() * 0.3})`; x.lineWidth = w; x.beginPath(); x.moveTo(x0, y);
      let yy = y; for (let k = 1; k <= 10; k++) { yy += (rr() - 0.5) * 7; x.lineTo(x0 + (len * k) / 10, yy); } x.stroke();
      x.strokeStyle = `rgba(255,250,238,${0.25 + rr() * 0.2})`; x.lineWidth = w * 0.6; x.beginPath(); x.moveTo(x0, y - w); yy = y - w;
      for (let k = 1; k <= 10; k++) { yy += (rr() - 0.5) * 6; x.lineTo(x0 + (len * k) / 10, yy); } x.stroke();
    }
    for (let i = 0; i < 160; i++) { const x0 = rr() * 1024, y0 = rr() * 256; x.strokeStyle = `rgba(30,20,12,${0.25 + rr() * 0.2})`; x.lineWidth = 1 + rr() * 2; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + (rr() - 0.5) * 6, y0 + 6 + rr() * 14); x.stroke(); }
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${rr() < 0.5 ? '40,30,20' : '255,250,240'},${rr() * 0.15})`; x.fillRect(rr() * 1024, rr() * 256, 2 + rr() * 6, 1 + rr() * 2); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(4, 1); t.anisotropy = 8;
    return t;
  }

  // =====================================================================
  // ARKA PLAN DÜNYASI: orman, dağlar, bulutlar, hayvanlar, mevsim olayları
  // Hepsi sisle yumuşar; odak ortadaki ağaçta kalır.
  // =====================================================================
  function cloudTexture(r) {
    const c = canvas(256, 128), x = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const cx = 40 + r() * 176, cy = 60 + (r() - 0.5) * 34, rad = 18 + r() * 30;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, 6.283); x.fill();
    }
    return new T.CanvasTexture(c);
  }
  function buildWorld(scene, r, barkMat) {
    const V = (x, y, z) => new T.Vector3(x, y, z), out = { clusters: [], items: [] };
    const cols = STRAND_COLS.map((c) => new T.Color(c));
    // --- orman: tepelerin üstünde, uzaklaştıkça küçülen onlarca ağaç ---
    const geos = [];
    for (let i = 0; i < 46; i++) {
      const z = -7 - Math.pow(r(), 0.8) * 22, spread = 8 + (-z) * 0.9;
      let x = (r() - 0.5) * 2 * spread;
      if (Math.abs(x) < 4.5 && z > -12) x += Math.sign(x || 1) * 5;      // ağacın hemen arkası boş kalsın
      if (x < -2.5 && x > -12.5 && z > -14) x -= 10;                    // soldaki kayalık ve mağaranın önü açık kalsın
      const s = (0.6 + r() * 0.6) * (1 + (-z - 7) * 0.02), y0 = hillH(x, z) - 0.2;
      const top = V(x + (r() - 0.5) * 0.3 * s, y0 + (1.4 + r() * 0.6) * s, z);
      geos.push(taperTube(new T.CatmullRomCurve3([V(x, y0, z), V(x + (r() - 0.5) * 0.2 * s, y0 + 0.8 * s, z), top]), 0.11 * s, 0.05 * s, 8, 5, cols[i % cols.length]));
      const nc = 3 + Math.floor(r() * 3);
      for (let k = 0; k < nc; k++) {
        const p = top.clone().add(V((r() - 0.5) * 1.3 * s, (r() * 0.9 + 0.2) * s, (r() - 0.5) * 0.8 * s));
        geos.push(taperTube(new T.CatmullRomCurve3([top.clone().add(V(0, -0.2 * s, 0)), p]), 0.04 * s, 0.012 * s, 6, 4, cols[i % cols.length]));
        out.clusters.push({ c: p, r: (0.36 + r() * 0.22) * s, tone: 0.5, delay: 0.15 + r() * 0.2, n: 2600, size: 0.034 * Math.max(1, s * 0.8) });
      }
    }
    // çerçeveleyen iki orta mesafe ağacı (sol ve sağ)
    [[-8.2, -3.5, 1.5], [8.8, -4.5, 1.6]].forEach(([x, z, s], i) => {
      const y0 = hillH(x, z) - 0.25, top = V(x + 0.2 * (i ? -1 : 1), y0 + 1.9 * s, z);
      geos.push(taperTube(new T.CatmullRomCurve3([V(x, y0, z), V(x - 0.15, y0 + 1.0 * s, z), top]), 0.16 * s, 0.07 * s, 12, 6, cols[3]));
      for (let k = 0; k < 7; k++) {
        const p = top.clone().add(V((r() - 0.5) * 1.8 * s, (r() * 1.1 + 0.2) * s, (r() - 0.5) * 1.0 * s));
        geos.push(taperTube(new T.CatmullRomCurve3([top.clone().add(V(0, -0.3 * s, 0)), p]), 0.05 * s, 0.012 * s, 8, 4, cols[3]));
        out.clusters.push({ c: p, r: (0.42 + r() * 0.22) * s, tone: 0.5, delay: 0.2 + r() * 0.2, n: 4200, size: 0.03 });
      }
    });
    const forest = new T.Mesh(mergeGeos(geos), barkMat); scene.add(forest);

    // --- dağlar: iki sıra, sis rengine yakın silüetler ---
    const ridge = (z, base, amp, ph, col) => {
      const P = [], N = 160;
      for (let i = 0; i <= N; i++) {
        const x = -140 + (i / N) * 280;
        const h = base + amp * (0.55 * Math.sin(x * 0.045 + ph) + 0.3 * Math.sin(x * 0.11 + ph * 2) + 0.15 * Math.sin(x * 0.29 + ph * 3));
        P.push(x, -4, z, x, h, z);
      }
      const idx = []; for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setIndex(idx);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
      m.renderOrder = -10; scene.add(m); return m;
    };
    const mtnFar = ridge(-70, 9, 5, 1.3, '#c9cfc8'), mtnNear = ridge(-55, 5.5, 3.5, 4.1, '#b7bfb4');

    // --- bulutlar ---
    const ctex = cloudTexture(r), clouds = [];
    for (let i = 0; i < 9; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, fog: false, opacity: 0.75 }));
      const s = 6 + r() * 8; sp.scale.set(s, s * 0.45, 1); sp.position.set((r() - 0.5) * 70, 9 + r() * 5, -30 - r() * 15); sp.renderOrder = -9;
      scene.add(sp); clouds.push({ sp, v: 0.15 + r() * 0.25 });
    }
    out.setSeason = (s, p) => {
      const mt = new T.Color(p.skyHz), dark = new T.Color(s === 'kis' ? '#9aa6b4' : s === 'sonbahar' ? '#b49a84' : s === 'ilkbahar' ? '#a9b8a8' : '#9fb0a0');
      mtnFar.material.color.copy(mt).lerp(dark, 0.35); mtnNear.material.color.copy(mt).lerp(dark, 0.55);
      if (s === 'kis') { mtnFar.material.color.set('#2a3b55'); mtnNear.material.color.set('#22314a'); }
      const cc = { ilkbahar: ['#ffffff', 0.75], yaz: ['#ffffff', 0.55], sonbahar: ['#6c6e74', 0.95], kis: ['#34445e', 0.55] }[s] || ['#ffffff', 0.75];
      for (const c of clouds) { c.sp.material.color.set(cc[0]); c.sp.material.opacity = cc[1]; }
    };
    out.update = (dt) => {
      for (const c of clouds) { c.sp.position.x += c.v * dt; if (c.sp.position.x > 45) c.sp.position.x = -45; }
    };
    return out;
  }

  window.TreeHome = {
    attach(wrap, opts = {}) {
      const cv = wrap.querySelector('canvas'), labelsEl = wrap.querySelector('.tree-labels');
      const EQ = window.ErmeQuality;   // uyarlanır kalite (quality.js)
      let st;
      try { st = makeStage(cv, { fov: 33 }); } catch (e) { console.warn('WebGL yok', e); return null; }
      const { renderer, scene, cam, resize: baseResize, ground, key, rim } = st;
      ground.visible = false; cam.far = 150; cam.updateProjectionMatrix();   // uzak dağlar, adalar ve deniz ufku
      renderer.toneMappingExposure = 1.02; renderer.setPixelRatio(EQ ? EQ.dpr(1.5) : Math.min(window.devicePixelRatio || 1, 1.5));
      const resize = () => { baseResize(); U.uScale.value = renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360)); };
      resize();
      key.position.set(-6, 12, 8); key.target.position.set(0, 3, 0); scene.add(key.target); key.intensity = 1.35; key.color.set('#fff6ea');
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -7, right: 7, top: 8, bottom: -3, near: 1, far: 34 }); key.shadow.camera.updateProjectionMatrix();
      rim.position.set(5, 4, -5); rim.intensity = 0.5; rim.color.set('#ffffff');
      const hemi = scene.children.find((o) => o.isHemisphereLight); hemi.intensity = 1.45;
      scene.fog = new T.Fog("#f3efe9", 17, 62);

      const r = rng(7);
      // tepecik + uzaktaki ipeksi zemin
      const hillMat = new T.MeshStandardMaterial({ color: '#efe7de', roughness: 0.62, envMapIntensity: 0.25 });
      const hill = new T.Mesh(hillGeometry(), hillMat); hill.receiveShadow = true; scene.add(hill);
      const csMat = new T.MeshBasicMaterial({ map: canopyShadowTex(), transparent: true, depthWrite: false, color: '#5a4a60', polygonOffset: true, polygonOffsetFactor: -2 });
      const cs = new T.Mesh(new T.PlaneGeometry(6.5, 3.4, 40, 20).rotateX(-Math.PI / 2), csMat);
      { const p = cs.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hillH(p.getX(i) + 0.9, p.getZ(i) - 0.2) + 0.015); }
      cs.scale.set(1.5, 1, 1.4); cs.position.set(1.2, 0, -0.3); scene.add(cs);
      // ağaç
      const tree = buildTree(r);
      const barkTex = barkTexture();
      const barkMat = barkPatch(new T.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, map: barkTex, bumpMap: barkTex, bumpScale: 3.2, roughness: 0.82, envMapIntensity: 0.45 }));
      const wood = new T.Mesh(tree.geo, barkMat); wood.receiveShadow = true; scene.add(wood);
      const bgWood = new T.Mesh(tree.bgGeo, barkMat); scene.add(bgWood);
      const world = buildWorld(scene, r, barkMat);
      // gövdenin ortasında sıcak ışıklı kovuk
      const hollow = new T.Vector3(0.03, 1.82, 0.4);
      const hollowTex = (() => { const c = canvas(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 150, 4, 128, 128, 128);
        g.addColorStop(0, 'rgba(255,196,120,1)'); g.addColorStop(0.25, 'rgba(190,104,46,1)'); g.addColorStop(0.62, 'rgba(52,30,16,1)'); g.addColorStop(1, 'rgba(20,12,6,1)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
        const tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace; return tx; })();
      const hole = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshBasicMaterial({ map: hollowTex, toneMapped: false })); hole.scale.set(0.19, 0.28, 1); hole.position.copy(hollow); scene.add(hole);
      const lip = new T.Mesh(new T.TorusGeometry(1, 0.32, 12, 40), barkPatch(new T.MeshStandardMaterial({ color: '#8a7656', map: barkTex, bumpMap: barkTex, bumpScale: 3, roughness: 0.85 })));
      lip.scale.set(0.2, 0.29, 0.16); lip.position.copy(hollow).add(new T.Vector3(0, 0, 0.012)); lip.castShadow = true; scene.add(lip);
      const hollowHit = new T.Mesh(new T.SphereGeometry(0.3, 12, 8), new T.MeshBasicMaterial({ visible: false })); hollowHit.scale.set(0.9, 1.15, 0.5); hollowHit.position.copy(hollow).add(new T.Vector3(0, 0, 0.05)); hollowHit.userData.idx = 'hollow'; scene.add(hollowHit);
      const hollowLight = new T.PointLight('#ffb764', 1.4, 2.4, 1.8); hollowLight.position.copy(hollow).add(new T.Vector3(0, 0, 0.35)); scene.add(hollowLight);
      // fenerlerin sıcak ışığı (kabuğa ve yapraklara vurur)
      const lampLights = [0, 1, 2, 3, 4].map(() => { const l = new T.PointLight('#ffbe6a', 0.6, 2.4, 1.8); scene.add(l); return l; });
      // yaprakların arasından süzülen güneş hüzmeleri
      const rayTex = (() => { const c = canvas(64, 512), x = c.getContext('2d');
        for (let yy = 0; yy < 512; yy++) for (let xx = 0; xx < 64; xx++) { const a = Math.exp(-Math.pow((xx - 32) / 14, 2)) * Math.pow(1 - yy / 512, 1.4) * (0.75 + 0.25 * Math.sin(yy * 0.05 + xx * 0.2)); x.fillStyle = `rgba(255,255,255,${a})`; x.fillRect(xx, yy, 1, 1); }
        return new T.CanvasTexture(c); })();
      const rays = [-2.2, -1.2, -0.3, 0.6, 1.5, 2.4].map((x0, i) => {
        const m = new T.Mesh(new T.PlaneGeometry(0.55 + (i % 3) * 0.25, 7.5), new T.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, fog: false, color: '#ffe2a0' }));
        m.geometry.translate(0, -3.75, 0); m.position.set(x0, 6.6, 1.3 + (i % 2) * 0.7); m.rotation.z = 0.42; m.renderOrder = 4; scene.add(m); return { m, ph: r() * 6 };
      });
      const RAY = { ilkbahar: ['#fff4dc', 0.18], yaz: ['#ffcf6a', 0.48], sonbahar: ['#ffc880', 0.1], kis: ['#9fb6e6', 0.05] };
      const SEASON_TGT = { snow: 0, moss: 1, bare: 0, rayI: 0.3, rayC: new T.Color('#ffe2a0'), k: 1, h: 1, kc: new T.Color('#fff6ea'), dim: new T.Color(1, 1, 1), near: 17, far: 62 };
      const LM = { k: 1, h: 1 };
      const scenery = window.Scenery ? window.Scenery.create({ scene, r, hillH, glowTex: glowTexture(), hollow, limbs: tree.limbs, snowU: U.uSnow }) : null;
      const foliage = buildFoliage([...tree.clusters, ...tree.bushes, ...tree.bg, ...world.clusters], r); scene.add(foliage);

      // ---------- asılı adım kitapları ----------
      const glowTex = glowTexture();
      // ---------- ADIM İŞARETLERİ: 5 farklı biçim (orb | journey | medal | lantern | bird) ----------
      const raycastables = [];
      let hover = -1, zoom = null, markerStyle = 'orb';
      const V3 = (x, y, z) => new T.Vector3(x, y, z);
      // adım simgeleri (oyma, fener, ışık için ortak)
      function drawIcon(x, kind, cx, cy, s, col, lw) {
        x.save(); x.translate(cx, cy); x.scale(s / 100, s / 100); x.strokeStyle = col; x.fillStyle = col; x.lineWidth = lw || 7; x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath();
        if (kind === 'ocr') {            // tarama çerçevesi + göz
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { x.moveTo(a * 40, b * 22); x.lineTo(a * 40, b * 40); x.lineTo(a * 22, b * 40); }
          x.moveTo(-26, 0); x.quadraticCurveTo(0, -24, 26, 0); x.quadraticCurveTo(0, 24, -26, 0); x.stroke(); x.beginPath(); x.arc(0, 0, 8, 0, 6.283); x.fill();
        } else if (kind === 'editor') {  // kalem
          x.moveTo(-30, 32); x.lineTo(-22, 8); x.lineTo(20, -34); x.lineTo(34, -20); x.lineTo(-8, 22); x.closePath(); x.moveTo(12, -26); x.lineTo(26, -12); x.stroke();
        } else if (kind === 'structure') { // içindekiler
          for (const y of [-26, 0, 26]) { x.moveTo(-34, y); x.arc(-34, y, 3, 0, 6.283); x.moveTo(-18, y); x.lineTo(34, y); }
          x.stroke();
        } else if (kind === 'cover') {   // fırça
          x.moveTo(30, -34); x.lineTo(-4, 4); x.stroke(); x.beginPath(); x.moveTo(-6, 2); x.quadraticCurveTo(-30, 2, -32, 34); x.quadraticCurveTo(-8, 30, 0, 10); x.closePath(); x.fill();
        } else if (kind === 'epub') {    // açık kitap
          x.moveTo(0, -22); x.quadraticCurveTo(-18, -32, -38, -26); x.lineTo(-38, 26); x.quadraticCurveTo(-18, 20, 0, 30); x.quadraticCurveTo(18, 20, 38, 26); x.lineTo(38, -26); x.quadraticCurveTo(18, -32, 0, -22); x.lineTo(0, 30); x.stroke();
        } else if (kind === 'lib') { for (const xx of [-28, -10, 8]) { x.rect(xx, -30, 12, 60); } x.moveTo(24, -28); x.lineTo(38, 30); x.stroke(); }
        x.restore();
      }
      const iconTex = (kind, { bg, fg, carve, w = 256, h = 256, rep = 1 }) => {
        const c = canvas(w, h), x = c.getContext('2d');
        x.fillStyle = bg; x.fillRect(0, 0, w, h);
        if (carve) {   // ahşap halkaları + oyulmuş simge
          for (let k = 0; k < 9; k++) { x.strokeStyle = `rgba(60,40,20,${0.08 + (k % 2) * 0.06})`; x.lineWidth = 3; x.beginPath(); x.arc(w / 2, h / 2, 18 + k * 13, 0, 6.283); x.stroke(); }
          drawIcon(x, kind, w / 2 + 2, h / 2 + 3, 120, 'rgba(255,240,210,.35)', 10);
          drawIcon(x, kind, w / 2, h / 2, 120, 'rgba(45,28,14,.85)', 9);
        } else for (let k = 0; k < rep; k++) drawIcon(x, kind, (w / rep) * (k + 0.5), h * 0.52, h * 0.5, fg, 7);
        const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
      };
      // konumlar
      const L = tree.limbs;
      const POS = {
        orb: (i) => tree.anchors[i],
        lantern: (i) => tree.anchors[i],
        bird: (i) => tree.anchors[i].clone().add(V3(0, 0.07, -0.03)),
        journey: (i) => [V3(1.0, hillH(1.0, 1.2) + 0.2, 1.2), V3(0.0, 1.75, 0.62), V3(0.08, 3.15, 0.6), V3(-0.9, 4.3, 1.55), V3(0.3, 5.75, 1.6)][i],
        medal: (i) => [V3(0.02, 1.2, 0.6), V3(0.06, 2.12, 0.5), V3(0.08, 3.1, 0.5), L[1].path(0.42).add(V3(0, 0, 0.14)), L[3].path(0.42).add(V3(0, 0, 0.14))][i],
      };
      // ışık yolu (yolculuk biçimi): kökten tepeye; biten kısım parlar, üstünde bir kıvılcım akar
      const pathCurve = new T.CatmullRomCurve3([0, 1, 2, 3, 4].map((i) => POS.journey(i)), false, 'catmullrom', 0.35);
      const pathMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { uProg: { value: 0 }, uTime: U.uTime, uCol: { value: new T.Color('#ffd98a') } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uProg; uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
          void main(){ float on = step(vUv.x, uProg + 0.001); float sp = exp(-pow((fract(uTime * 0.12) * max(uProg, 0.05) - vUv.x) * 30.0, 2.0)) * on;
            float dash = 0.35 + 0.65 * step(0.5, fract(vUv.x * 60.0));
            gl_FragColor = vec4(uCol * (on * 0.9 + sp * 2.5 + (1.0 - on) * 0.18 * dash), 0.5 * on + sp + (1.0 - on) * 0.25 * dash); }`,
      });
      const pathMesh = new T.Mesh(new T.TubeGeometry(pathCurve, 240, 0.02, 6, false), pathMat); pathMesh.visible = false; scene.add(pathMesh);

      const BASE = { orb: 1.25, journey: 1.8, medal: 1.3, lantern: 1.45, bird: 2.0 };
      const BUILD = {
        orb(it, S, col) {
          const orb = new T.Mesh(new T.SphereGeometry(0.115, 48, 32), new T.MeshStandardMaterial({ color: col, roughness: 0.22, envMapIntensity: 0.9, emissive: col, emissiveIntensity: 0.18 }));
          orb.castShadow = true; it.inner.add(orb);
          const ring = new T.Mesh(new T.TorusGeometry(0.15, 0.006, 10, 64), new T.MeshStandardMaterial({ color: '#d8b25a', roughness: 0.3, metalness: 0.7 })); it.inner.add(ring);
          const stem = new T.Mesh(new T.CylinderGeometry(0.008, 0.012, 0.09, 8), barkMat); stem.position.y = 0.155; it.inner.add(stem);
          return { drop: 0.12, glowZ: -0.05, glowS: 0.75, hit: 0.24, setDone(d) { ring.visible = d; },
            update(dt, t, h) { it.inner.rotation.y = spring(it.rot, h ? Math.PI * 2 : 0, dt, 3.2) + Math.sin(t * 0.7 + it.ph) * 0.15; ring.rotation.y = -it.inner.rotation.y;
              orb.material.emissiveIntensity = lerp(orb.material.emissiveIntensity, h ? 0.4 : 0.18, 1 - Math.exp(-dt * 8)); } };
        },
        journey(it, S, col) {   // ışıktan tohum: biten adım parlak, bekleyen sönük
          const m = new T.MeshStandardMaterial({ color: '#fff3d6', emissive: new T.Color('#ffcf6a'), emissiveIntensity: 0.3, roughness: 0.3 });
          const seed = new T.Mesh(new T.SphereGeometry(0.085, 32, 24), m); it.inner.add(seed);
          const halo = new T.Mesh(new T.RingGeometry(0.115, 0.125, 48), new T.MeshBasicMaterial({ color: S.color, transparent: true, opacity: 0.9, side: T.DoubleSide })); it.inner.add(halo);
          const ic = new T.Mesh(new T.PlaneGeometry(0.11, 0.11), new T.MeshBasicMaterial({ map: iconTex(S.tab, { bg: 'rgba(0,0,0,0)', fg: '#5a3d1a' }), transparent: true, depthWrite: false }));
          ic.position.z = 0.088; it.inner.add(ic);
          let done = false;
          return { drop: 0.1, glowZ: -0.02, glowS: 0.9, hit: 0.22, setDone(d) { done = d; },
            update(dt, t, h) { m.emissiveIntensity = lerp(m.emissiveIntensity, (done ? 1.1 : 0.25) + (h ? 0.6 : 0) + Math.sin(t * 2 + it.ph) * 0.1, 1 - Math.exp(-dt * 5)); halo.rotation.z = t * 0.3; it.inner.lookAt(cam.position); } };
        },
        medal(it, S) {   // gövdeye gömülü ahşap madalyon, oyma simge
          const face = iconTex(S.tab, { bg: '#b08a5a', carve: true });
          const side = new T.MeshStandardMaterial({ color: '#7a5a38', roughness: 0.8 });
          const disc = new T.Mesh(new T.CylinderGeometry(0.17, 0.18, 0.06, 48), [side, new T.MeshStandardMaterial({ map: face, bumpMap: face, bumpScale: 3, roughness: 0.75 }), side]);
          disc.rotation.x = Math.PI / 2; disc.castShadow = true; it.inner.add(disc);
          const rim = new T.Mesh(new T.TorusGeometry(0.175, 0.016, 10, 48), new T.MeshStandardMaterial({ color: '#5e4228', roughness: 0.7 })); it.inner.add(rim);
          const gold = new T.Mesh(new T.TorusGeometry(0.2, 0.007, 8, 64), new T.MeshStandardMaterial({ color: '#d8b25a', metalness: 0.7, roughness: 0.3 })); it.inner.add(gold);
          return { drop: 0.2, glowZ: -0.06, glowS: 0.9, hit: 0.22, setDone(d) { gold.visible = d; },
            update(dt, t, h) { it.inner.rotation.set(0, spring(it.rot, h ? 0.35 : 0, dt, 5) - 0.1, 0); } };
        },
        lantern(it, S) {   // ipe asılı kâğıt fener, içi ışıklı
          const prof = []; for (let k = 0; k <= 16; k++) { const y = k / 16; prof.push(new T.Vector2(0.025 + Math.sin(y * Math.PI) * 0.1, -y * 0.27)); }
          const paper = new T.MeshStandardMaterial({ color: new T.Color(S.color).lerp(new T.Color('#fff1d6'), 0.55), emissive: new T.Color(S.color).lerp(new T.Color('#ffd27a'), 0.6), emissiveIntensity: 0.2,
            emissiveMap: iconTex(S.tab, { bg: '#ffffff', fg: '#7a4a1a', w: 512, h: 256, rep: 2 }), roughness: 0.9, side: T.DoubleSide });
          const body = new T.Mesh(new T.LatheGeometry(prof, 32), paper); body.position.y = -0.16; it.inner.add(body);
          const cap = new T.MeshStandardMaterial({ color: '#4a3424', roughness: 0.6 });
          const c1 = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.03, 16), cap); c1.position.y = -0.155; it.inner.add(c1);
          const c2 = c1.clone(); c2.position.y = -0.43; it.inner.add(c2);
          const str = new T.Mesh(new T.CylinderGeometry(0.003, 0.003, 0.16, 5), cap); str.position.y = -0.08; it.inner.add(str);
          const tassel = new T.Mesh(new T.ConeGeometry(0.015, 0.07, 6), new T.MeshStandardMaterial({ color: S.color })); tassel.position.y = -0.48; it.inner.add(tassel);
          let done = false;
          return { drop: 0.52, glowZ: 0, glowY: -0.29, glowS: 1.0, hit: 0.24, hitY: -0.29, setDone(d) { done = d; },
            update(dt, t, h) { paper.emissiveIntensity = lerp(paper.emissiveIntensity, (done ? 1.0 : 0.15) + (h ? 0.5 : 0) + (done ? Math.sin(t * 7 + it.ph) * 0.06 : 0), 1 - Math.exp(-dt * 5));
              const wx = it.grp.position.x, wnd = U.uGust.value; it.inner.rotation.z = Math.sin(t * 1.1 - wx * 0.35) * (0.035 + Math.abs(wnd) * 0.05) - wnd * 0.16 + it.swing.x; it.inner.rotation.x = Math.sin(t * 0.8 - wx * 0.35 + 1.3) * 0.025; it.inner.rotation.y = Math.sin(t * 0.25 + it.ph) * 0.5; it.swing.x = spring(it.swing, 0, dt, 4); } };
        },
        bird(it, S, col) {   // dala tünemiş kuş
          const m = new T.MeshStandardMaterial({ color: col, roughness: 0.6, flatShading: true }), belly = new T.MeshStandardMaterial({ color: '#f4ead8', roughness: 0.7, flatShading: true });
          const body = new T.Mesh(new T.SphereGeometry(0.08, 10, 8), m); body.scale.set(1.25, 1, 0.95); it.inner.add(body);
          const b2 = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), belly); b2.position.set(0.02, -0.02, 0.035); it.inner.add(b2);
          const head = new T.Group(); head.position.set(0.075, 0.07, 0); it.inner.add(head);
          head.add(new T.Mesh(new T.SphereGeometry(0.052, 10, 8), m));
          const beak = new T.Mesh(new T.ConeGeometry(0.016, 0.05, 6), new T.MeshStandardMaterial({ color: '#e0a23a' })); beak.rotation.z = -Math.PI / 2; beak.position.set(0.06, -0.005, 0); head.add(beak);
          for (const s of [-1, 1]) { const e = new T.Mesh(new T.SphereGeometry(0.009, 6, 4), new T.MeshBasicMaterial({ color: '#1a1410' })); e.position.set(0.03, 0.015, 0.042 * s); head.add(e); }
          const tail = new T.Mesh(new T.ConeGeometry(0.03, 0.12, 4), m); tail.rotation.z = Math.PI / 2 + 0.5; tail.position.set(-0.12, 0.03, 0); it.inner.add(tail);
          const wings = [-1, 1].map((s) => { const w = new T.Group(); w.position.set(0, 0.03, 0.06 * s); const wm = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), m); wm.scale.set(1.3, 0.35, 0.7); wm.position.set(-0.03, 0, 0.02 * s); w.add(wm); it.inner.add(w); return w; });
          const crown = new T.Mesh(new T.ConeGeometry(0.025, 0.05, 5), new T.MeshStandardMaterial({ color: '#d8b25a', metalness: 0.6, roughness: 0.3 })); crown.position.set(0, 0.06, 0); head.add(crown);
          it.inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          let nextLook = 0, look = 0, hop = 0;
          return { drop: 0.11, glowZ: -0.05, glowS: 0.7, hit: 0.2, setDone(d) { crown.visible = d; },
            update(dt, t, h) {
              nextLook -= dt; if (nextLook <= 0) { look = (r() - 0.5) * 1.6; nextLook = 1 + r() * 2.5; if (r() < 0.25) hop = 1; }
              head.rotation.y = lerp(head.rotation.y, h ? 0.9 : look, 1 - Math.exp(-dt * 6));
              hop = Math.max(0, hop - dt * 3); it.inner.position.y = Math.sin(hop * Math.PI) * 0.05 + (h ? Math.abs(Math.sin(t * 9)) * 0.03 : 0);
              const f = h ? Math.sin(t * 28) * 0.9 : 0; wings[0].rotation.x = -f; wings[1].rotation.x = f;
              it.inner.rotation.y = lerp(it.inner.rotation.y, h ? -0.6 : 0.6 * Math.sign(it.anchor.x || 1) * -1 - 0.4, 1 - Math.exp(-dt * 3)); } };
        },
      };
      const items = STEPS.map((S, i) => {
        const grp = new T.Group(); scene.add(grp);
        const inner = new T.Group(); grp.add(inner);
        const el = document.createElement('button');
        el.className = 'tree-label orb-label lamp-card';
        el.innerHTML = `<div class="lc-cover"><span>${i + 1}</span></div><div class="lc-body"><span class="lc-step">ADIM ${i + 1} / 5</span><b>${S.name}</b><small></small>
          <span class="lc-detail"></span><div class="lc-bar"><i></i><em></em></div><span class="lc-go">Devam et →</span></div>`;
        el.addEventListener('click', () => pick(i)); el.addEventListener('mouseenter', () => (hover = i)); el.addEventListener('mouseleave', () => (hover = -1));
        labelsEl.appendChild(el);
        return { S, i, grp, inner, el, anchor: null, m: null, glow: null, hit: null, done: false, scl: { x: 0, v: 0 }, rot: { x: 0, v: 0 }, swing: { x: 0, v: 0 }, state: '', ph: r() * 6 };
      });
      function setMarkerStyle(name) {
        if (!BUILD[name]) return;
        markerStyle = name; raycastables.length = 0;
        for (const it of items) {
          it.inner.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
          it.inner.clear(); it.inner.rotation.set(0, 0, 0); it.inner.position.set(0, 0, 0);
          it.anchor = POS[name](it.i);
          const col = new T.Color(it.S.color).lerp(new T.Color('#ffffff'), 0.12);
          it.m = BUILD[name](it, it.S, col);
          it.glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: '#FFB74D', transparent: true, depthWrite: false, opacity: 0, fog: false, blending: T.AdditiveBlending }));
          it.glow.scale.set(it.m.glowS, it.m.glowS, 1); it.glow.position.set(0, it.m.glowY || 0, it.m.glowZ); it.inner.add(it.glow);
          it.hit = new T.Mesh(new T.SphereGeometry(it.m.hit, 12, 8), new T.MeshBasicMaterial({ visible: false })); it.hit.position.y = it.m.hitY || 0;
          it.hit.userData.idx = it.i; it.inner.add(it.hit); raycastables.push(it.hit);
          it.m.setDone(it.done);
        }
        pathMesh.visible = name === 'journey';
        raycastables.push(libHit, hollowHit);
        try { localStorage.setItem('treeMarkers', name); } catch {}
      }

      // ---------- tepecikteki kitap yığını: Kitaplık ----------
      const lib = new T.Group(); const lx = 1.7, lz = 1.55; lib.position.set(lx, hillH(lx, lz) - 0.01, lz); lib.rotation.y = -0.55; scene.add(lib);
      ['#3c5a3a', '#7a3b2a', '#2c3e5c'].forEach((col, k) => {
        const b = new Book({ title: k === 2 ? 'KİTAPLIK' : '', author: '', color: col });
        b.group.scale.setScalar(0.22 - k * 0.012); b.group.rotation.x = -Math.PI / 2; b.group.rotation.z = (k - 1) * 0.35 + 0.1;
        b.group.position.y = 0.022 + k * 0.045; b.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        lib.add(b.group);
      });
      const lean = new Book({ title: '', author: '', color: '#8b6a2a' });
      lean.group.scale.setScalar(0.23); lean.group.position.set(-0.3, 0.165, -0.1); lean.group.rotation.set(-0.15, 0.6, 0.32);
      lean.group.traverse((o) => { if (o.isMesh) o.castShadow = true; }); lib.add(lean.group);
      const libHit = new T.Mesh(new T.BoxGeometry(0.85, 0.45, 0.55), new T.MeshBasicMaterial({ visible: false }));
      libHit.position.set(-0.1, 0.2, 0); libHit.userData.idx = 'lib'; lib.add(libHit);
      setMarkerStyle('lantern');   // seçilen biçim: dallarda fenerler
      const libEl = document.createElement('button');
      libEl.className = 'tree-label lib'; libEl.innerHTML = `<span class="tl-n"><svg class="ico" viewBox="0 0 24 24"><path d="M4 4v16"/><path d="M9 4v16"/><path d="m14 4 4 16"/><path d="M2 20h20"/></svg></span><span class="tl-t"><b>Kitaplık</b><small>biten kitaplar</small></span>`;
      libEl.addEventListener('click', () => pick('lib')); libEl.addEventListener('mouseenter', () => (hover = 'lib')); libEl.addEventListener('mouseleave', () => (hover = -1));
      labelsEl.appendChild(libEl);
      const libScale = { x: 1, v: 0 };
      // mevsimin gizli geçidi üstüne gelince küçük bir ipucu
      const portalEl = document.createElement('div'); portalEl.className = 'portal-tip'; portalEl.setAttribute('aria-hidden', 'true');
      portalEl.innerHTML = '<b>✦ Gizli Geçit</b><small>tıkla</small>'; labelsEl.appendChild(portalEl);

      // ---------- düşen parçacıklar ----------
      const NP = 90, fall = new T.InstancedMesh(leafGeo(0.085), new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 0.7 }), NP);
      fall.frustumCulled = false; scene.add(fall);
      for (let i = 0; i < NP; i++) fall.setColorAt(i, new T.Color('#ffffff'));
      const NS = 1100, snow = new T.InstancedMesh(new T.IcosahedronGeometry(0.016, 1), new T.MeshBasicMaterial({ color: '#dfe7f5' }), NS);
      snow.frustumCulled = false; scene.add(snow);
      const NF = 60, flyGeo = new T.BufferGeometry(), flyPos = new Float32Array(NF * 3);
      flyGeo.setAttribute('position', new T.BufferAttribute(flyPos, 3));
      const flies = new T.Points(flyGeo, new T.PointsMaterial({ map: glowTex, color: '#ffffff', size: 0.09, transparent: true, depthWrite: false, opacity: 0.9 }));
      flies.frustumCulled = false; scene.add(flies);
      // kalite ön ayarı: çözünürlük, gölge ve parçacık/hayvan yoğunluğu
      let flyN = NF;
      function applyQuality(p, refreshFauna) {
        renderer.setPixelRatio(EQ ? EQ.dpr(1.5) : Math.min(window.devicePixelRatio || 1, 1.5)); resize();
        if (!p) return;
        key.castShadow = p.shadows;
        if (key.shadow.mapSize.x !== p.shadowSize) { key.shadow.mapSize.set(p.shadowSize, p.shadowSize); if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; } }
        fall.count = Math.max(10, Math.round(NP * p.particles)); snow.count = Math.max(80, Math.round(NS * p.particles));
        flyN = Math.max(8, Math.round(NF * p.particles)); flyGeo.setDrawRange(0, flyN);
        if (refreshFauna && scenery && scenery.refresh) scenery.refresh();
      }
      if (EQ) { applyQuality(EQ.p, false); EQ.on((p) => applyQuality(p, true)); }
      const PP = Array.from({ length: NS }, () => ({}));
      const respawn = (o, top, wide) => { o.x = (r() - 0.5) * (wide ? 26 : 6.5); o.z = wide ? -9 + r() * 15 : (r() - 0.5) * 2.8; o.y = top ? (wide ? 7 + r() * 2 : 3.4 + r() * 2.2) : 0.4 + r() * (wide ? 8 : 5);
        o.vy = 0.16 + r() * 0.28; o.ph = r() * 6.283; o.sw = 0.2 + r() * 0.5; o.e = new T.Euler(r() * 6, r() * 6, r() * 6); o.rs = (r() - 0.5) * 3; o.c = r();
      };
      PP.forEach((o) => respawn(o, false));

      // ---------- mevsim: soldan sağa renk dalgası ----------
      let season = '', wipe = null;
      const tw = { bark: new T.Color(), ground: new T.Color(), fog: new T.Color(), hemi: new T.Color() };
      function setSeason(s, force) {
        const p = PAL[s];
        if (!p || (s === season && !force)) return;
        const first = !season; season = s;
        if (first) {
          U.uHiA.value.set(p.hi); U.uMidA.value.set(p.mid); U.uShA.value.set(p.sh); U.uAccA.value.set(p.acc); U.uAccAmtA.value = p.accAmt;
          U.uHiB.value.set(p.hi); U.uMidB.value.set(p.mid); U.uShB.value.set(p.sh); U.uAccB.value.set(p.acc); U.uAccAmtB.value = p.accAmt;
          barkMat.color.set(p.bark); hillMat.color.set(p.ground); scene.fog.color.set(p.fog || p.skyHz); hemi.color.set(p.hemi);
          wipe = null; U.uWipe.value = 9;
        } else {
          U.uHiA.value.copy(U.uHiB.value); U.uMidA.value.copy(U.uMidB.value); U.uShA.value.copy(U.uShB.value); U.uAccA.value.copy(U.uAccB.value); U.uAccAmtA.value = U.uAccAmtB.value;
          U.uHiB.value.set(p.hi); U.uMidB.value.set(p.mid); U.uShB.value.set(p.sh); U.uAccB.value.set(p.acc); U.uAccAmtB.value = p.accAmt;
          U.uWipe.value = -5; wipe = { t: 0, from: { bark: barkMat.color.clone(), ground: hillMat.color.clone(), fog: scene.fog.color.clone(), hemi: hemi.color.clone() } };
        }
        world.setSeason(s, p); if (scenery) scenery.setSeason(s);
        SEASON_TGT.snow = s === 'kis' ? 1 : 0; SEASON_TGT.moss = s === 'kis' ? 0.35 : 1; SEASON_TGT.bare = s === 'kis' ? 1 : 0;
        SEASON_TGT.rayI = RAY[s][1]; SEASON_TGT.rayC.set(RAY[s][0]);
        if (first) { U.uSnow.value = SEASON_TGT.snow; U.uMoss.value = SEASON_TGT.moss; U.uBare.value = SEASON_TGT.bare; }
        tw.bark.set(p.bark); tw.ground.set(p.ground); tw.fog.set(p.fog || p.skyHz); tw.hemi.set(p.hemi);
        const Lp = p.light || { k: 1, h: 1, kc: '#fff6ea', dim: '#ffffff', near: 17, far: 62 };
        SEASON_TGT.k = Lp.k; SEASON_TGT.h = Lp.h; SEASON_TGT.kc.set(Lp.kc); SEASON_TGT.dim.set(Lp.dim); SEASON_TGT.near = Lp.near; SEASON_TGT.far = Lp.far;
        if (first) { LM.k = Lp.k; LM.h = Lp.h; key.color.set(Lp.kc); U.uDim.value.set(Lp.dim); scene.fog.near = Lp.near; scene.fog.far = Lp.far; }
        wrap.style.setProperty('--sky-glow', Lp.glow || 'rgba(255,255,255,.55)');
        wrap.dataset.sky = s === 'kis' || s === 'sonbahar' ? 'dark' : 'light';
        wrap.style.setProperty('--sky-top', p.skyTop); wrap.style.setProperty('--sky-hz', p.skyHz);
        hemi.groundColor.set(p.ground);
        fall.visible = p.kind === 'leaf' || p.kind === 'petal'; snow.visible = p.kind === 'snow'; flies.visible = p.kind === 'pollen';
        if (snow.visible) PP.forEach((o) => respawn(o, false, true)); else PP.forEach((o) => respawn(o, false, false));
        if (fall.visible) { const c = new T.Color(); for (let i = 0; i < NP; i++) fall.setColorAt(i, c.set(p.part[i % p.part.length])); fall.instanceColor.needsUpdate = true; }
      }

      // ---------- etkileşim ----------
      const ray = new T.Raycaster(), mouse = new T.Vector2(-9, -9), par = { x: 0, y: 0 };
      const HOME = { pos: [0.2, 3.6, 15.2], look: [-0.9, 3.45, 0] };
      const camPos = { x: { x: HOME.pos[0], v: 0 }, y: { x: HOME.pos[1], v: 0 }, z: { x: HOME.pos[2], v: 0 } };
      const look = { x: { x: HOME.look[0], v: 0 }, y: { x: HOME.look[1], v: 0 }, z: { x: 0, v: 0 } };
      cv.addEventListener('pointermove', (e) => {
        const b = cv.getBoundingClientRect();
        mouse.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        par.x = mouse.x; par.y = mouse.y;
      });
      cv.addEventListener('pointerleave', () => { mouse.set(-9, -9); hover = -1; par.x = par.y = 0; });
      cv.addEventListener('click', () => { if (hover !== -1) pick(hover); });
      function pick(i) {
        if (zoom || growT < 1.2) return;
        zoom = { i, t: 0 };
        if (typeof i === 'string' && i.startsWith('portal:')) {   // mevsimin gizli geçidi: kamera yaklaşır, sonra Keşif Geçidi açılır
          const season = i.slice(7); zoom.portal = season; portalEl.classList.remove('show');
          setTimeout(() => { if (zoom && zoom.portal === season) opts.onPortal ? opts.onPortal({ season }) : (zoom = null); }, 950); return;
        }
        if (i === 'hollow') { setTimeout(() => opts.onHollow && opts.onHollow(), 950); return; }   // kovuktan içeri: kütüphane
        setTimeout(() => opts.onPick && opts.onPick(i === 'lib' ? 'library' : items[i].S.tab), i === 'lib' ? 600 : 780);
      }

      // ---------- döngü ----------
      let raf = 0, last = performance.now(), time = 0, visible = true, gust = 0, gustT = 0, growT = 0;
      const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible && !raf && !paused) { last = performance.now(); raf = requestAnimationFrame(loop); } });
      io.observe(cv);
      const ro = new ResizeObserver(resize); ro.observe(cv);
      const tmp = new T.Vector3(), off = new T.Vector3(), m4 = new T.Matrix4(), q = new T.Quaternion(), sv = new T.Vector3();
      const smooth = (x) => x * x * (3 - 2 * x);
      function loop(now) {
        raf = 0;
        if (EQ) EQ.frame(now);
        const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000)); last = now; time += dt;
        // büyüme: gövde aşağıdan yukarı, sonra kümeler içten dışa kabarır, en son kitaplar sarkar
        growT = Math.min(growT + dt / 2.8, 1.5);
        U.uGrow.value = growT;
        U.uGrowY.value = lerp(0.25, 6.2, smooth(clamp(growT / 0.85)));
        wood.castShadow = growT > 0.9;
        csMat.opacity = smooth(clamp((growT - 0.6) / 0.7));
        // rüzgâr
        gustT -= dt; if (gustT <= 0) { gustT = 3 + r() * 5; gust = (r() - 0.35) * 1.2; }
        U.uGust.value = lerp(U.uGust.value, 0.28 * Math.sin(time * 0.31) + 0.14 * Math.sin(time * 0.73 + 1.7) + gust * 0.55 * (0.5 + 0.5 * Math.sin(time * 0.8)), 1 - Math.exp(-dt * 0.9));   // ortak rüzgâr vektörü
        U.uTime.value = time;
        const g = U.uGust.value;
        // mevsim dalgası
        if (wipe) {
          wipe.t += dt / 1.7; const k = smooth(clamp(wipe.t));
          U.uWipe.value = lerp(-5, 5, k);
          barkMat.color.copy(wipe.from.bark).lerp(tw.bark, k); hillMat.color.copy(wipe.from.ground).lerp(tw.ground, k);
          scene.fog.color.copy(wipe.from.fog).lerp(tw.fog, k); hemi.color.copy(wipe.from.hemi).lerp(tw.hemi, k);
          if (wipe.t >= 1) { wipe = null; U.uWipe.value = 9; U.uHiA.value.copy(U.uHiB.value); U.uMidA.value.copy(U.uMidB.value); U.uShA.value.copy(U.uShB.value); U.uAccA.value.copy(U.uAccB.value); U.uAccAmtA.value = U.uAccAmtB.value; }
        }
        world.update(dt, time);
        if (scenery) {
          scenery.update(dt, time, U.uGust.value);
          // yağmurda ışık kısılır, şimşekte bir an parlar
          const rain = scenery.env.rain, fl = scenery.env.flash;
          key.intensity = 1.35 * LM.k * (1 - rain * 0.5) + fl * 2.5; hemi.intensity = 1.45 * LM.h * (1 - rain * 0.3) + fl * 1.2;
          wrap.style.setProperty('--rain', rain.toFixed(3)); wrap.style.setProperty('--flash', fl.toFixed(3));
        }
        // fare üstündeki kitap
        if (mouse.x > -2 && growT > 1.2) {
          ray.setFromCamera(mouse, cam);
          const hits = scenery && scenery.portalHits ? scenery.portalHits() : [];
          const hit = ray.intersectObjects(hits.length ? raycastables.concat(hits) : raycastables, false)[0];
          const h = hit ? hit.object.userData.idx : -1;
          hover = h;
        }
        const hp = typeof hover === 'string' && hover.startsWith('portal:') && !zoom ? hover.slice(7) : null;
        if (scenery && scenery.portalHover) scenery.portalHover(hp || (zoom && zoom.portal) || null);
        if (hp) { const v = scenery.portalView(hp); tmp.copy(v.at); tmp.y += 0.45; tmp.project(cam); portalEl.style.transform = `translate(${((tmp.x + 1) / 2) * cv.clientWidth}px, ${((1 - tmp.y) / 2) * cv.clientHeight}px) translate(-50%, -100%)`; }
        portalEl.classList.toggle('show', !!hp);
        cv.style.cursor = hover !== -1 ? 'pointer' : 'default';
        // mevsimsel ağaç hali: kar, yosun, yaprak dökümü, güneş hüzmeleri
        { const k = 1 - Math.exp(-dt * 0.7); const rain = scenery ? scenery.env.rain : 0;
          LM.k = lerp(LM.k, SEASON_TGT.k, k); LM.h = lerp(LM.h, SEASON_TGT.h, k); key.color.lerp(SEASON_TGT.kc, k); U.uDim.value.lerp(SEASON_TGT.dim, k);
          scene.fog.near = lerp(scene.fog.near, SEASON_TGT.near, k); scene.fog.far = lerp(scene.fog.far, SEASON_TGT.far, k);
          U.uSnow.value = lerp(U.uSnow.value, SEASON_TGT.snow, k); U.uMoss.value = lerp(U.uMoss.value, SEASON_TGT.moss, k); U.uBare.value = lerp(U.uBare.value, SEASON_TGT.bare, k * 0.8);
          rays.forEach((ry, i) => { ry.m.material.color.lerp(SEASON_TGT.rayC, k); ry.m.material.opacity = lerp(ry.m.material.opacity, SEASON_TGT.rayI * (1 - rain * 0.85) * (0.6 + 0.4 * Math.sin(time * 0.35 + ry.ph)) * smooth(clamp((growT - 1) * 2)), k * 2); }); }
        // fener ve kovuk ışıkları
        items.forEach((it, i) => {
          it.grp.getWorldPosition(tmp); if (markerStyle === 'lantern') tmp.y -= 0.29 * it.inner.scale.y;
          lampLights[i].position.copy(tmp).add(new T.Vector3(0, 0, 0.15));
          const lit = (it.done ? 1.0 : 0.35) + (it.state === 'next' ? 0.35 + 0.25 * Math.sin(time * 2.2) : 0) + (hover === it.i ? 0.6 : 0);
          lampLights[i].intensity = lerp(lampLights[i].intensity, lit * 1.6 * (growT > 1.1 ? 1 : 0), 1 - Math.exp(-dt * 5));
          U.uLamp.value[i].copy(tmp); U.uLampI.value[i] = lampLights[i].intensity / 1.6;
        });
        U.uLamp.value[5].copy(hollow); U.uLampI.value[5] = 0.6;
        hollowLight.intensity = (1.3 + Math.sin(time * 3.1) * 0.12 + Math.sin(time * 7.7) * 0.06) * (hover === 'hollow' ? 1.9 : 1) + (zoom && zoom.i === 'hollow' ? 2 : 0);
        cv.title = hover === 'hollow' ? 'Kovuktaki kütüphaneye gir' : '';
        const camW = zoom && zoom.portal ? 1.6 : 0;   // geçide yaklaşma biraz daha yumuşak
        // adım işaretleri
        const done = items.filter((x) => x.done).length;
        let lastDone = -1; items.forEach((x, k) => { if (x.done) lastDone = k; });
        pathMat.uniforms.uProg.value = lerp(pathMat.uniforms.uProg.value, Math.max(0, lastDone) / 4 * (lastDone >= 0 ? 1 : 0), 1 - Math.exp(-dt * 2));
        for (const it of items) {
          const movesWithTree = markerStyle !== 'medal' || it.i > 2;
          if (movesWithTree) { swayJS(it.anchor, time, g, off); it.grp.position.copy(it.anchor).add(off); } else it.grp.position.copy(it.anchor);
          if (markerStyle === 'orb' || markerStyle === 'journey') it.grp.position.y += 0.02 + Math.sin(time * 1.1 + it.ph) * 0.012;
          const isHover = hover === it.i, isZoom = zoom && zoom.i === it.i;
          const appear = growT > 1.05 + it.i * 0.06 ? 1 : 0;
          it.inner.scale.setScalar(Math.max(0.001, BASE[markerStyle] * spring(it.scl, appear * (isZoom ? 1.8 : isHover ? 1.5 : 1), dt, isHover ? 9 : 7)));
          it.m.update(dt, time, isHover);
          const pulse = it.state === 'next' ? 0.55 + 0.35 * Math.sin(time * 1.6) : it.state === 'run' ? 0.6 + 0.35 * Math.sin(time * 6) : isHover ? 0.55 : 0;
          it.glow.material.opacity = lerp(it.glow.material.opacity, pulse, 1 - Math.exp(-dt * 6));
        }
        lib.scale.setScalar(spring(libScale, hover === 'lib' ? 1.1 : 1, dt, 8));
        // kamera
        let tp = [HOME.pos[0] + par.x * 0.95, HOME.pos[1] + par.y * 0.42, HOME.pos[2]], tl = [HOME.look[0] + par.x * 0.28, HOME.look[1] + par.y * 0.1, 0];   // fareye göre katmanlı paralaks
        if (zoom) {
          if (zoom.portal) { const v = scenery && scenery.portalView(zoom.portal); if (v) { tp = v.pos; tl = v.look; } zoom.t = (zoom.t || 0) + dt; }
          else if (zoom.i === 'hollow') { tp = [hollow.x, hollow.y + 0.02, hollow.z + 0.5 - smooth(clamp((zoom.t || 0) / 1.1)) * 0.45]; tl = [hollow.x, hollow.y, hollow.z - 1]; zoom.t = (zoom.t || 0) + dt; }
          else if (zoom.i === 'lib') { lib.getWorldPosition(tmp); tp = [tmp.x + 0.2, tmp.y + 0.9, tmp.z + 2.6]; tl = [tmp.x, tmp.y + 0.15, tmp.z]; }
          else { items[zoom.i].grp.getWorldPosition(tmp); tp = [tmp.x * 0.8, tmp.y + 0.1, tmp.z + 2.6]; tl = [tmp.x, tmp.y, tmp.z]; }
        }
        const w = zoom ? (camW || 4.2) : 2.0;
        cam.position.set(spring(camPos.x, tp[0], dt, w), spring(camPos.y, tp[1], dt, w), spring(camPos.z, tp[2], dt, w));
        cam.lookAt(spring(look.x, tl[0], dt, w), spring(look.y, tl[1], dt, w), spring(look.z, tl[2], dt, w));
        // parçacıklar
        if (fall.visible) {
          for (let i = 0; i < fall.count; i++) {
            const o = PP[i]; o.y -= o.vy * dt; o.x += (Math.sin(time * o.sw + o.ph) * 0.25 + g * 0.35) * dt; o.z += Math.cos(time * 0.6 + o.ph) * 0.06 * dt;
            o.e.x += o.rs * dt; o.e.z += o.rs * 0.7 * dt;
            const floor = hillH(o.x, o.z);
            if (o.y < floor) respawn(o, true);
            q.setFromEuler(o.e); sv.setScalar(o.y - floor < 0.2 ? Math.max(0, (o.y - floor) * 5) : 1); m4.compose(tmp.set(o.x, o.y, o.z), q, sv); fall.setMatrixAt(i, m4);
          }
          fall.instanceMatrix.needsUpdate = true;
        }
        if (snow.visible) {
          for (let i = 0; i < snow.count; i++) {
            const o = PP[i]; o.y -= o.vy * 0.75 * dt; o.x += (Math.sin(time * o.sw + o.ph) * 0.12 + g * 0.2) * dt;
            if (o.y < hillH(o.x, o.z)) respawn(o, true, true);
            m4.makeTranslation(o.x, o.y, o.z); snow.setMatrixAt(i, m4);
          }
          snow.instanceMatrix.needsUpdate = true;
        }
        if (flies.visible) {
          for (let i = 0; i < flyN; i++) {
            const o = PP[i];
            flyPos[i * 3] = Math.sin(time * 0.12 * (1 + o.c) + o.ph) * 3 + Math.sin(time * 0.7 + o.ph) * 0.15;
            flyPos[i * 3 + 1] = 0.8 + o.c * 4.4 + Math.sin(time * 0.4 + o.ph * 2) * 0.25;
            flyPos[i * 3 + 2] = Math.cos(time * 0.1 + o.ph) * 1.4 + 0.5;
          }
          flyGeo.attributes.position.needsUpdate = true;
        }
        // etiketler
        const W = cv.clientWidth, H = cv.clientHeight;
        for (const it of items) {
          it.grp.getWorldPosition(tmp); tmp.y -= it.m.drop * 0.55 * it.inner.scale.y;
          tmp.project(cam);
          const sx = ((tmp.x + 1) / 2) * W, right = sx < W * 0.62;
          it.el.style.transform = `translate(${sx}px, ${((1 - tmp.y) / 2) * H}px) translate(${right ? '22px' : 'calc(-100% - 22px)'}, -78%)`;
          it.el.classList.toggle('hover', hover === it.i);
          it.el.classList.toggle('shown', hover === it.i || !!(zoom && zoom.i === it.i));
        }
        lib.getWorldPosition(tmp); tmp.y += 0.5; tmp.project(cam);
        libEl.style.transform = `translate(${((tmp.x + 1) / 2) * W}px, ${((1 - tmp.y) / 2) * H}px) translate(-50%, -100%)`;
        libEl.classList.toggle('hover', hover === 'lib'); libEl.classList.toggle('shown', hover === 'lib' || (zoom && zoom.i === 'lib'));
        wrap.classList.toggle('zooming', !!zoom);
        wrap.classList.toggle('focus', typeof hover === 'number' && hover >= 0 && !zoom);   // önizlemede arka plan hafifçe yumuşar

        renderer.render(scene, cam);
        if (visible && !paused) raf = requestAnimationFrame(loop);
      }
      let paused = false;

      setSeason(document.body.dataset.season || 'sonbahar');
      raf = requestAnimationFrame(loop);

      return {
        setSeason,
        // renk takımı: 'pastel' | 'dogal' | 'canli'
        setPalette(name, instant) {
          if (!PALETTES[name]) return;
          PAL = PALETTES[name]; try { localStorage.setItem('treePalette', name); } catch {}
          if (instant) { const s0 = season; season = ''; setSeason(s0); } else setSeason(season, true);
        },
        setState({ done = {}, next = null, running = null } = {}) {
          for (const it of items) {
            const d = !!done[it.S.tab];
            it.state = running === it.S.tab ? 'run' : next === it.S.tab ? 'next' : d ? 'done' : '';
            it.done = d; it.m.setDone(d);
            it.el.classList.toggle('done', d); it.el.classList.toggle('next', it.state === 'next'); it.el.classList.toggle('run', it.state === 'run');
            it.el.querySelector('small').textContent = it.state === 'run' ? 'çalışıyor…' : d ? 'tamamlandı' : it.state === 'next' ? 'sıradaki' : 'bekliyor';
          }
        },
        reset() { zoom = null; },
        // kütüphane açıkken dış sahne çizilmez (iki sahne aynı anda GPU'yu paylaşmasın)
        setPaused(p) { paused = !!p; if (!paused && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } if (paused && raf) { cancelAnimationFrame(raf); raf = 0; } },
        // önizleme kartlarının bilgisi: { cover, pct, details: { ocr: '...', ... } }
        setInfo({ cover = null, pct = 0, details = {} } = {}) {
          for (const it of items) {
            const cv = it.el.querySelector('.lc-cover'); cv.style.backgroundImage = cover ? `url("${cover}")` : ''; cv.classList.toggle('has', !!cover);
            it.el.querySelector('.lc-detail').textContent = details[it.S.tab] || '';
            it.el.querySelector('.lc-bar i').style.width = Math.round(pct * 100) + '%';
            it.el.querySelector('.lc-bar em').textContent = `kitap %${Math.round(pct * 100)}`;
            it.el.querySelector('.lc-go').textContent = it.done ? 'Aç →' : 'Devam et →';
          }
        },
        setMarkerStyle,
        grow() { growT = 0; for (const it of items) { it.scl.x = 0; it.scl.v = 0; } },
        dispose() { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); renderer.dispose(); labelsEl.innerHTML = ''; },
      };
    },
  };
})();
