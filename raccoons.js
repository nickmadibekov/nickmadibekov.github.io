(() => {
  const canvas = document.getElementById('raccoon-canvas');
  const ctx = canvas.getContext('2d');
  const cursorEl = document.getElementById('cursorCookie');
  const cardEl = document.querySelector('.card');

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let cardRect = { left: -9999, top: -9999, right: -9999, bottom: -9999 };

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    updateCardRect();
  }

  // Tight box around the card as drawn (border + hard offset shadow), used to
  // keep raccoons from standing behind it.
  let cardBox = { left: -9999, top: -9999, right: -9999, bottom: -9999 };

  function updateCardRect() {
    if (!cardEl) return;
    const r = cardEl.getBoundingClientRect();
    const pad = 26;
    cardRect = {
      left: r.left - pad,
      top: r.top - pad,
      right: r.right + pad,
      bottom: r.bottom + pad,
    };
    cardBox = { left: r.left - 10, top: r.top - 6, right: r.right + 18, bottom: r.bottom + 18 };
    // A card taller than the window makes the page scroll, and the fixed
    // canvas does not scroll with it. Then the card could be anywhere
    // vertically, so keep the whole column under it clear.
    if (document.documentElement.scrollHeight > window.innerHeight + 1) {
      cardBox.top = -1e4;
      cardBox.bottom = 1e4;
    }
  }

  // A raccoon is anchored at its feet and draws about 112*scale tall and
  // 124*scale wide, so a spot is "behind the card" whenever that sprite box
  // touches the card, not only when the feet point is inside it.
  function overlapsCard(x, y, scale, pad) {
    const p = pad || 0;
    const halfW = 62 * scale + p;
    const h = 112 * scale + p;
    return x + halfW > cardBox.left - p && x - halfW < cardBox.right + p && y + p > cardBox.top && y - h < cardBox.bottom + p;
  }

  // True if walking in a straight line from A to B would pass behind the card.
  function pathHitsCard(x0, y0, x1, y1, scale) {
    // A small safety margin stops a sprite corner clipping the card between
    // samples. But if we already stand within that margin, using it would
    // reject every path (that is what left raccoons hopping on the spot at
    // the card), so then only reject paths that really go behind it.
    const pad = overlapsCard(x0, y0, scale, 6) ? 0 : 6;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (overlapsCard(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, scale, pad)) return true;
    }
    return false;
  }

  function inCard(x, y, margin) {
    const m = margin || 0;
    return x > cardRect.left - m && x < cardRect.right + m && y > cardRect.top - m && y < cardRect.bottom + m;
  }

  // Keeps raccoons from picking a spot right on top of another raccoon.
  // `raccoons` is assigned further down but this is only ever called after
  // it's populated, so the closure resolves fine.
  function tooCloseToOthers(x, y, minDist, self) {
    for (const other of raccoons) {
      if (other === self) continue;
      if (Math.hypot(other.x - x, other.y - y) < minDist) return true;
    }
    return false;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  // --- asset loading -------------------------------------------------

  const ASSET_FILES = {
    idle: 'assets/raccoon-jump-1.png',
    crouch: 'assets/raccoon-jump-3.png',
    air: 'assets/raccoon-jump-2.png',
    land: 'assets/raccoon-jump-4.png',
    eat1: 'assets/raccoon-eat-1.png',
    eat2: 'assets/raccoon-eat-2.png',
    eat3: 'assets/raccoon-eat-3.png',
    eat4: 'assets/raccoon-eat-4.png',
    crumb1: 'assets/crumb-1.png',
    crumb2: 'assets/crumb-2.png',
    heart1: 'assets/heart-1.png',
    heart2: 'assets/heart-2.png',
    heart3: 'assets/heart-3.png',
  };

  // Where the cookie sits in the eating frames (source-pixel space, same
  // across eat1-4 since they were edited from one another to keep the paw
  // position fixed) — this is where crumb particles spawn from.
  const MOUTH_ANCHOR = { x: 347, y: 271 };

  // Precomputed alpha bounding boxes for each asset (content bounds within
  // its 500x500 or 80x80 canvas). These used to be computed at load time via
  // canvas.getImageData, but some browsers block that when the page is
  // opened directly from disk (file://) rather than through a server, which
  // silently broke character grounding and shrank crumbs to invisibility.
  // Hardcoding them removes that dependency entirely — works identically
  // whether the page is served or just double-clicked.
  const BBOX_DATA = {
    idle: { minX: 19, minY: 45, maxX: 468, maxY: 447 },
    crouch: { minX: 15, minY: 110, maxX: 473, maxY: 406 },
    air: { minX: 24, minY: 33, maxX: 465, maxY: 446 },
    land: { minX: 24, minY: 107, maxX: 469, maxY: 405 },
    eat1: { minX: 18, minY: 43, maxX: 457, maxY: 430 },
    eat2: { minX: 18, minY: 43, maxX: 458, maxY: 431 },
    eat3: { minX: 17, minY: 43, maxX: 458, maxY: 432 },
    eat4: { minX: 18, minY: 43, maxX: 458, maxY: 431 },
    crumb1: { minX: 242, minY: 239, maxX: 258, maxY: 253 },
    crumb2: { minX: 243, minY: 242, maxX: 257, maxY: 254 },
    heart1: { minX: 56, minY: 29, maxX: 214, maxY: 205 },
    heart2: { minX: 91, minY: 76, maxX: 171, maxY: 166 },
    heart3: { minX: 72, minY: 41, maxX: 197, maxY: 213 },
  };

  function bboxFromData(d) {
    return {
      minX: d.minX, minY: d.minY, maxX: d.maxX, maxY: d.maxY,
      width: d.maxX - d.minX,
      height: d.maxY - d.minY,
      centerX: (d.minX + d.maxX) / 2,
      centerY: (d.minY + d.maxY) / 2,
      bottom: d.maxY,
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  let ASSETS = null;
  let BBOXES = null;

  async function loadAssets() {
    const keys = Object.keys(ASSET_FILES);
    const imgs = await Promise.all(keys.map((k) => loadImage(ASSET_FILES[k])));
    const assets = {};
    keys.forEach((k, i) => { assets[k] = imgs[i]; });
    const bboxes = {};
    keys.forEach((k) => { bboxes[k] = bboxFromData(BBOX_DATA[k]); });
    return { assets, bboxes };
  }

  // --- scenery (grass, bushes, flowers) -----------------------------------

  // Target on-screen size of each piece in CSS px: `w` or `h`, the other side
  // follows the image's aspect. Raccoons are ~70-145px tall, so flowers and
  // grass stay well below knee height and bushes are about raccoon-sized.
  const SCENERY = {
    'bush-1': { kind: 'bush', w: 120 },
    'bush-2': { kind: 'bush', w: 100 },
    'bush-3': { kind: 'bush', w: 118 },
    'grass-1': { kind: 'grass', h: 26 },
    'grass-2': { kind: 'grass', h: 26 },
    'grass-3': { kind: 'grass', h: 30 },
    'grass-4': { kind: 'grass', h: 46 },
    'grass-5': { kind: 'grass', h: 24 },
    'grass-6': { kind: 'grass', h: 18 },
    'flower-daisy': { kind: 'flower', h: 38 },
    'flower-coral': { kind: 'flower', h: 34 },
    'flower-yellow': { kind: 'flower', h: 30 },
    'flower-pink': { kind: 'flower', h: 36 },
    'flower-tulip': { kind: 'flower', h: 34 },
    'flower-tiny': { kind: 'flower', h: 33 },
  };

  const SCENERY_IMAGES = {};
  let sceneryBack = null; // offscreen canvas: bushes, always drawn behind raccoons
  let sceneryFront = []; // small pieces, depth-sorted with the raccoons

  // Scenery is decoration: a missing file just means that piece is skipped.
  function loadScenery() {
    return Promise.all(
      Object.keys(SCENERY).map((name) =>
        loadImage(`assets/bg/${name}.png`)
          .then((img) => { SCENERY_IMAGES[name] = img; })
          .catch(() => {})
      )
    );
  }

  // Pre-shrinks an image to its exact on-screen device-pixel size by halving
  // step by step, so small pieces stay crisp instead of aliasing when a
  // ~300px source is drawn at ~30px.
  function makeSprite(img, tw, th) {
    let src = img;
    let cw = img.naturalWidth;
    let ch = img.naturalHeight;
    while (cw / 2 > tw) {
      cw = Math.round(cw / 2);
      ch = Math.round(ch / 2);
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, cw, ch);
      src = c;
    }
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(tw));
    out.height = Math.max(1, Math.round(th));
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  function drawScenery(c, it) {
    c.save();
    c.translate(it.x, it.by);
    if (it.flip) c.scale(-1, 1);
    c.drawImage(it.sprite, -it.w / 2, -it.h, it.w, it.h);
    c.restore();
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // The meadow is a list of placed pieces scattered over the whole screen, so
  // it can be saved and kept across tab switches. Whatever the card covers at
  // the moment is simply not drawn; when the card shrinks again (a short tab
  // after a long one) those pieces are there waiting, so no area is left bare.
  let sceneryItems = [];

  // Does a piece standing at (x, by) with size w x h poke behind the card?
  // The margin also keeps pieces off the grass/flowers growing from its edge.
  function pieceHitsCard(x, by, w, h) {
    const m = 28;
    return x + w / 2 > cardBox.left - m && x - w / 2 < cardBox.right + m && by > cardBox.top - m && by - h < cardBox.bottom + m;
  }

  function makeItem(name, x, by, w, h, flip) {
    return { name, kind: SCENERY[name].kind, x, by, w, h, flip, sprite: makeSprite(SCENERY_IMAGES[name], w * DPR, h * DPR) };
  }

  function sizeFor(name) {
    const spec = SCENERY[name];
    const img = SCENERY_IMAGES[name];
    const jitter = rand(0.85, 1.15);
    if (spec.w) {
      const w = spec.w * jitter;
      return { w, h: (w * img.naturalHeight) / img.naturalWidth };
    }
    const h = spec.h * jitter;
    return { w: (h * img.naturalWidth) / img.naturalHeight, h };
  }

  // Tries a handful of random spots and keeps the one
  // farthest from everything already placed, so the meadow spreads out evenly
  // instead of clumping.
  // With sideOnly the spot is limited to the strips left and right of the
  // card, which stay on show whatever tab (and card height) is open.
  function pickSpot(w, h, items, sideOnly) {
    let best = null;
    let bestScore = -1;
    for (let t = 0; t < 18; t++) {
      let x = rand(w / 2 + 4, Math.max(w / 2 + 5, W - w / 2 - 4));
      if (sideOnly) {
        const m = 28 + w / 2;
        const leftMax = cardBox.left - m;
        const rightMin = cardBox.right + m;
        const canL = leftMax > w / 2 + 4;
        const canR = rightMin < W - w / 2 - 4;
        if (!canL && !canR) return null;
        x = (canL && !canR) || (canL && Math.random() < 0.5) ? rand(w / 2 + 4, leftMax) : rand(rightMin, W - w / 2 - 4);
      }
      const by = rand(Math.min(h + 6, H - 4), H - 4); // baseline (feet) of the piece
      let nearest = Infinity;
      for (const p of items) nearest = Math.min(nearest, Math.hypot(p.x - x, p.by - p.h / 2 - (by - h / 2)));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, by };
      }
    }
    return best;
  }

  function rebuildSceneryLayers() {
    const shown = sceneryItems.filter((i) => !pieceHitsCard(i.x, i.by, i.w, i.h));
    sceneryFront = shown.filter((i) => i.kind !== 'bush').sort((a, b) => a.by - b.by);
    // Bushes never move, so draw them once into an offscreen layer.
    const bushes = shown.filter((i) => i.kind === 'bush').sort((a, b) => a.by - b.by);
    if (!W || !H) return;
    sceneryBack = document.createElement('canvas');
    sceneryBack.width = W * DPR;
    sceneryBack.height = H * DPR;
    const g = sceneryBack.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const b of bushes) drawScenery(g, b);
  }

  // Scatters a fresh meadow across the whole screen. Called on first load and
  // (debounced) when the window is resized.
  function layoutScenery() {
    sceneryItems = [];
    const names = Object.keys(SCENERY_IMAGES);
    if (names.length) {
      const area = W * H;
      const plan = [
        ['bush', clamp(Math.round(area / 150000), 4, 9)],
        ['flower', clamp(Math.round(area / 48000), 8, 32)],
        ['grass', clamp(Math.round(area / 25000), 14, 58)],
      ];
      for (const [kind, count] of plan) {
        const pool = names.filter((n) => SCENERY[n].kind === kind);
        if (!pool.length) continue;
        for (let i = 0; i < count; i++) {
          const name = pool[Math.floor(Math.random() * pool.length)];
          const { w, h } = sizeFor(name);
          const spot = pickSpot(w, h, sceneryItems);
          if (spot) sceneryItems.push(makeItem(name, spot.x, spot.by, w, h, Math.random() < 0.5));
        }
      }
    }
    // The card hides whatever it covers, and a long page (a tall card) hides
    // everything in the middle, so also fill the side strips, which are always
    // visible, to keep them from looking bare.
    if (names.length) {
      const sideW = Math.max(0, cardBox.left - 28) + Math.max(0, W - cardBox.right - 28);
      const extra = Math.round((sideW * H) / 38000);
      const mix = [['grass', 0.55], ['flower', 0.35], ['bush', 0.1]];
      for (let i = 0; i < extra; i++) {
        let roll = Math.random();
        let kind = 'grass';
        for (const [k, p] of mix) {
          if (roll < p) { kind = k; break; }
          roll -= p;
        }
        const pool = names.filter((n) => SCENERY[n].kind === kind);
        if (!pool.length) continue;
        const name = pool[Math.floor(Math.random() * pool.length)];
        const { w, h } = sizeFor(name);
        const spot = pickSpot(w, h, sceneryItems, true);
        if (spot) sceneryItems.push(makeItem(name, spot.x, spot.by, w, h, Math.random() < 0.5));
      }
    }
    rebuildSceneryLayers();
  }

  // --- raccoon ---------------------------------------------------------

  const BASE_HEIGHT_PX = 110; // on-screen character height at scale = 1
  const CROUCH_DURATION = 0.12;
  const AIR_DURATION = 0.32;
  const LAND_DURATION = 0.12;

  // Eating: fixed-length rather than random, with one baked-in-cookie frame
  // (eat1-4) per bite — the cookie shrinking is drawn directly into the art,
  // so this just picks which frame to show as time passes.
  const EAT_CYCLE_MS = 300; // one bite
  const EAT_BITES = 4;
  const EAT_DURATION = EAT_CYCLE_MS * EAT_BITES; // 1200ms total

  class Raccoon {
    constructor(saved) {
      this.scale = saved ? saved.scale : rand(0.62, 1.32);
      this.pixelScale = (BASE_HEIGHT_PX * this.scale) / BBOXES.idle.height;
      const spawnSpacing = 85;
      this.x = rand(40, W - 40);
      this.y = rand(90, H - 40);
      let placed = false;
      for (let i = 0; i < 30 && !placed; i++) {
        const nx = rand(40, W - 40);
        const ny = rand(90, H - 40);
        if (overlapsCard(nx, ny, this.scale)) continue;
        if (i < 18 && tooCloseToOthers(nx, ny, spawnSpacing, this)) continue; // spacing is a preference, the card is not
        this.x = nx;
        this.y = ny;
        placed = true;
      }
      this.tx = this.x;
      this.ty = this.y;
      this.facing = 1;
      this.hopDistance = rand(45, 85) * this.scale;
      this.bobPhase = Math.random() * Math.PI * 2;

      this.state = 'wander';
      this.hopPhase = 'resting';
      this.restTimer = rand(0, 1.5);
      this.phaseTimer = 0;
      this.hopStart = { x: this.x, y: this.y };
      this.hopEnd = { x: this.x, y: this.y };

      this.eatTimer = 0;
      this.eatDuration = 0;
      this.eatFrameIndex = 0;
      this.crumbs = [];
      this.crumbSpawnTimer = 0;
      this.willDropCrumbs = false;
      this.crumbsSpawned = 0;
      this.maxCrumbs = 0;
      this.hearts = [];
      this.heartSpawnQueue = [];

      this.pickTarget();

      // Restoring a raccoon from the previous page: same spot, same walk.
      if (saved) {
        this.x = clamp(saved.x, 30 * this.scale, W - 30 * this.scale);
        this.y = clamp(saved.y, 80, H - 4);
        this.facing = saved.facing;
        this.hopDistance = saved.hopDistance;
        this.hopStart = { x: this.x, y: this.y };
        this.hopEnd = { x: this.x, y: this.y };
        this.restTimer = rand(0, 0.5);
        if (
          saved.tx >= 30 * this.scale &&
          saved.tx <= W - 30 * this.scale &&
          saved.ty >= 80 &&
          saved.ty <= H - 8 &&
          !overlapsCard(saved.tx, saved.ty, this.scale) &&
          !pathHitsCard(this.x, this.y, saved.tx, saved.ty, this.scale)
        ) {
          this.tx = saved.tx;
          this.ty = saved.ty;
        } else {
          this.pickTarget();
        }
      }
    }

    pickTarget() {
      const minSpacing = 85;
      // Never pick a spot behind the card, and never one whose straight walk
      // from here would cross behind it. Spacing from other raccoons is only
      // a preference, so it is dropped after a few tries on a crowded screen.
      for (let i = 0; i < 30; i++) {
        const nx = rand(30 * this.scale, W - 30 * this.scale);
        const ny = rand(80, H - 8);
        if (overlapsCard(nx, ny, this.scale)) continue;
        if (pathHitsCard(this.x, this.y, nx, ny, this.scale)) continue;
        if (i < 18 && tooCloseToOthers(nx, ny, minSpacing, this)) continue;
        this.tx = nx;
        this.ty = ny;
        return;
      }
      // Nothing free in a straight line (e.g. pinned against the card): turn
      // around and take a short walk in a fresh direction rather than staying
      // put and hopping on the spot.
      for (let i = 0; i < 30; i++) {
        const a = rand(0, Math.PI * 2);
        const d = rand(60, 200);
        const nx = clamp(this.x + Math.cos(a) * d, 30 * this.scale, W - 30 * this.scale);
        const ny = clamp(this.y + Math.sin(a) * d, 80, H - 8);
        if (overlapsCard(nx, ny, this.scale)) continue;
        if (pathHitsCard(this.x, this.y, nx, ny, this.scale)) continue;
        this.tx = nx;
        this.ty = ny;
        return;
      }
      this.tx = this.x;
      this.ty = this.y;
    }

    // If the card moved onto this raccoon (window resized, fonts loaded),
    // slide it to the nearest free spot beside, above or below the card.
    evict() {
      if (!overlapsCard(this.x, this.y, this.scale)) return;
      const halfW = 62 * this.scale;
      const h = 112 * this.scale;
      const cands = [
        { x: cardBox.left - halfW - 10, y: this.y },
        { x: cardBox.right + halfW + 10, y: this.y },
        { x: this.x, y: cardBox.top - 10 },
        { x: this.x, y: cardBox.bottom + h + 10 },
      ].filter(
        (c) => c.x >= halfW && c.x <= W - halfW && c.y >= 60 && c.y <= H - 4 && !overlapsCard(c.x, c.y, this.scale)
      );
      if (!cands.length) return;
      cands.sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y));
      this.x = cands[0].x;
      this.y = cands[0].y;
      if (this.state !== 'eating') {
        this.hopPhase = 'resting';
        this.restTimer = rand(0.2, 0.8);
      }
      this.pickTarget();
    }

    startEating() {
      this.state = 'eating';
      this.eatTimer = 0;
      this.eatDuration = EAT_DURATION;
      this.eatFrameIndex = 0;
      this.crumbs = [];
      this.crumbSpawnTimer = rand(0.1, 0.25);
      // Some feedings drop no crumbs at all; the rest drop just a couple.
      this.willDropCrumbs = Math.random() < 0.55;
      this.crumbsSpawned = 0;
      this.maxCrumbs = Math.random() < 0.5 ? 2 : 3;
      // A little heart burst always plays when fed, staggered so they pop
      // out one after another rather than all at once.
      this.hearts = [];
      const heartCount = Math.random() < 0.5 ? 5 : 6;
      this.heartSpawnQueue = Array.from({ length: heartCount }, (_, i) => i * rand(0.05, 0.09));
    }

    spawnHeart() {
      const headHeight = BBOXES.idle.height * this.pixelScale;
      const headCenterX = this.x;
      const headCenterY = this.y - headHeight * 0.88;
      // Wide scatter — left side, straight up, and right side, not a tight
      // crown — with varied start distance and per-heart size for a messier,
      // more organic burst instead of a uniform ring.
      const angle = rand(-Math.PI * 1.15, Math.PI * 0.15);
      const startRadius = rand(8, 30) * this.scale;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const speed = rand(20, 44);
      this.hearts.push({
        x: headCenterX + dirX * startRadius,
        y: headCenterY + dirY * startRadius,
        vx: dirX * speed + rand(-4, 4),
        vy: dirY * speed - rand(6, 14), // extra upward bias so they still drift up overall
        life: 1,
        variant: Math.floor(Math.random() * 3),
        sizeMul: rand(0.55, 1.5),
        rot: rand(-0.5, 0.5),
        rotSpeed: rand(-0.6, 0.6),
        popScale: 0,
      });
    }

    startHop() {
      const dx = this.tx - this.x;
      const dy = this.ty - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) {
        // No real destination: stand still and look for one, don't hop on the spot.
        this.hopPhase = 'resting';
        this.restTimer = rand(0.5, 1.4);
        this.pickTarget();
        return;
      }
      const step = Math.min(this.hopDistance, dist);
      const dirX = dist > 0.01 ? dx / dist : 0;
      const dirY = dist > 0.01 ? dy / dist : 0;
      this.hopStart = { x: this.x, y: this.y };
      this.hopEnd = { x: this.x + dirX * step, y: this.y + dirY * step };
      if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
      this.hopPhase = 'crouch';
      this.phaseTimer = 0;
    }

    update(dt) {
      this.bobPhase += dt * 3.2;

      // Crumb physics (falling, fading, rotating) always run, regardless of
      // state — otherwise a crumb still mid-fall when eating ends freezes in
      // place forever, since nothing would ever advance or clear it.
      for (const c of this.crumbs) {
        c.vy += 70 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.rotSpeed * dt;
        c.life -= dt * 1.1;
      }
      this.crumbs = this.crumbs.filter((c) => c.life > 0);

      // Same reasoning as crumbs: hearts must keep rising/fading regardless
      // of state, or one still mid-flight when eating ends would freeze.
      for (const h of this.hearts) {
        const drag = 1 - Math.min(1, 1.0 * dt); // eases off for a floaty drift instead of a constant climb
        h.vx *= drag;
        h.vy *= drag;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        h.rot += h.rotSpeed * dt;
        h.life -= dt * 0.85;
        h.popScale = Math.min(1, h.popScale + dt * 6);
      }
      this.hearts = this.hearts.filter((h) => h.life > 0);
      if (this.heartSpawnQueue.length) {
        for (let i = this.heartSpawnQueue.length - 1; i >= 0; i--) {
          this.heartSpawnQueue[i] -= dt;
          if (this.heartSpawnQueue[i] <= 0) {
            this.spawnHeart();
            this.heartSpawnQueue.splice(i, 1);
          }
        }
      }

      if (this.state === 'eating') {
        this.eatTimer += dt * 1000;
        const progress = Math.min(this.eatTimer / this.eatDuration, 1);
        // One of 4 baked-in-cookie frames, one per fixed bite — the cookie
        // shrinking is drawn directly into the art, so this just picks
        // which frame to show as time passes.
        this.eatFrameIndex = Math.min(EAT_BITES - 1, Math.floor(this.eatTimer / EAT_CYCLE_MS));

        if (this.willDropCrumbs && this.crumbsSpawned < this.maxCrumbs) {
          this.crumbSpawnTimer -= dt;
          if (this.crumbSpawnTimer <= 0 && progress < 0.85) {
            this.crumbSpawnTimer = rand(0.25, 0.4);
            this.crumbsSpawned++;
            const bbox = BBOXES.eat1;
            const anchorX = this.x + (MOUTH_ANCHOR.x - bbox.centerX) * this.pixelScale * this.facing;
            const anchorY = this.y + (MOUTH_ANCHOR.y - bbox.bottom) * this.pixelScale;
            this.crumbs.push({
              x: anchorX + rand(-4, 4),
              y: anchorY + rand(-3, 3),
              vx: rand(-16, 16),
              vy: rand(-20, -6),
              life: 1,
              variant: Math.random() < 0.5 ? 0 : 1,
              rot: rand(0, Math.PI * 2),
              rotSpeed: rand(-3, 3),
            });
          }
        }

        if (progress >= 1) {
          this.state = 'wander';
          this.hopPhase = 'resting';
          this.restTimer = rand(0.2, 1.2);
          this.pickTarget();
        }
        return;
      }

      // wander / hop state machine
      switch (this.hopPhase) {
        case 'resting':
          this.restTimer -= dt;
          if (this.restTimer <= 0) this.startHop();
          break;

        case 'crouch':
          this.phaseTimer += dt;
          if (this.phaseTimer >= CROUCH_DURATION) {
            this.hopPhase = 'air';
            this.phaseTimer = 0;
          }
          break;

        case 'air': {
          this.phaseTimer += dt;
          const t = Math.min(1, this.phaseTimer / AIR_DURATION);
          this.x = this.hopStart.x + (this.hopEnd.x - this.hopStart.x) * t;
          this.y = this.hopStart.y + (this.hopEnd.y - this.hopStart.y) * t;
          if (this.phaseTimer >= AIR_DURATION) {
            this.x = this.hopEnd.x;
            this.y = this.hopEnd.y;
            this.hopPhase = 'land';
            this.phaseTimer = 0;
          }
          break;
        }

        case 'land':
          this.phaseTimer += dt;
          if (this.phaseTimer >= LAND_DURATION) {
            const dist = Math.hypot(this.tx - this.x, this.ty - this.y);
            if (dist < 6) {
              this.hopPhase = 'resting';
              this.restTimer = rand(0.6, 2.5);
              this.pickTarget();
            } else {
              // Brief standing pause between hops, even mid-journey, so a
              // long trip doesn't look like nonstop crouch/land squashing.
              this.hopPhase = 'resting';
              this.restTimer = rand(0.15, 0.45);
            }
          }
          break;
      }
    }

    hitTest(px, py) {
      const cy = this.y - 45 * this.scale;
      const r = 45 * this.scale;
      return Math.hypot(px - this.x, py - cy) < r;
    }

    draw(ctx) {
      const s = this.pixelScale;
      const facing = this.facing;
      let frameKey;
      let visualYOffset = 0;
      let airT = 0; // 0 = grounded, 1 = peak of the hop

      if (this.state === 'eating') {
        frameKey = ['eat1', 'eat2', 'eat3', 'eat4'][this.eatFrameIndex];
      } else {
        switch (this.hopPhase) {
          case 'crouch':
            frameKey = 'crouch';
            visualYOffset = 1.5 * this.scale;
            break;
          case 'air': {
            frameKey = 'air';
            const t = Math.min(1, this.phaseTimer / AIR_DURATION);
            airT = Math.sin(t * Math.PI); // 0 at takeoff/landing, 1 at the peak
            visualYOffset = -airT * 6 * this.scale; // gentle hop, not a big leap — this happens on every hop
            break;
          }
          case 'land':
            frameKey = 'land';
            visualYOffset = 1.5 * this.scale;
            break;
          default:
            frameKey = 'idle';
            visualYOffset = Math.sin(this.bobPhase * 2) * 1.2 * this.scale;
        }
      }

      const img = ASSETS[frameKey];
      const bbox = BBOXES[frameKey];

      // Shadow: fixed base size (from the idle pose, not whichever frame is
      // active) so it doesn't subtly resize every time the pose switches —
      // it only shrinks and fades on purpose, in sync with jump height.
      const shrink = 1 - airT * 0.22;
      const shadowW = Math.max(8, BBOXES.idle.width * s * 0.5 * shrink);
      const shadowAlpha = 0.16 * (1 - airT * 0.25);
      ctx.save();
      ctx.filter = 'blur(1.5px)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 2, shadowW, shadowW * 0.28, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50, 35, 15, ${shadowAlpha.toFixed(3)})`;
      ctx.fill();
      ctx.restore();

      // character sprite
      ctx.save();
      ctx.translate(this.x, this.y + visualYOffset);
      ctx.scale(s * facing, s);
      ctx.drawImage(img, -bbox.centerX, -bbox.bottom, img.naturalWidth, img.naturalHeight);
      ctx.restore();

      // Crumbs (the cookie itself is baked into the eat1-4 art, no
      // separate overlay needed).
      for (const c of this.crumbs) {
        const crumbImg = c.variant === 0 ? ASSETS.crumb1 : ASSETS.crumb2;
        const crumbBBox = c.variant === 0 ? BBOXES.crumb1 : BBOXES.crumb2;
        const diameter = Math.max(6, 16 * this.scale); // exaggerated above "realistic" crumb size so it's actually visible
        const crumbScale = diameter / Math.max(crumbBBox.width, 1);
        ctx.save();
        ctx.globalAlpha = Math.max(0, c.life);
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.drawImage(
          crumbImg,
          -crumbBBox.centerX * crumbScale,
          -crumbBBox.centerY * crumbScale,
          crumbImg.naturalWidth * crumbScale,
          crumbImg.naturalHeight * crumbScale
        );
        ctx.restore();
      }

      // Little heart burst, plays once whenever this raccoon gets fed.
      const heartKeys = ['heart1', 'heart2', 'heart3'];
      for (const h of this.hearts) {
        const heartImg = ASSETS[heartKeys[h.variant]];
        const heartBBox = BBOXES[heartKeys[h.variant]];
        const diameter = 18 * this.scale * h.popScale * h.sizeMul;
        const heartScale = diameter / Math.max(heartBBox.width, 1);
        const fadeAlpha = Math.min(1, h.life / 0.35); // holds full opacity, only fades near the end
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fadeAlpha));
        ctx.translate(h.x, h.y);
        ctx.rotate(h.rot);
        ctx.drawImage(
          heartImg,
          -heartBBox.centerX * heartScale,
          -heartBBox.centerY * heartScale,
          heartImg.naturalWidth * heartScale,
          heartImg.naturalHeight * heartScale
        );
        ctx.restore();
      }
    }
  }

  let raccoons = [];

  function initRaccoons(savedList) {
    raccoons = [];
    if (savedList && savedList.length) {
      for (const sv of savedList) raccoons.push(new Raccoon(sv));
      for (const r of raccoons) r.evict();
      return;
    }
    const area = W * H;
    const count = Math.max(6, Math.min(13, Math.round(area / 105000)));
    for (let i = 0; i < count; i++) raccoons.push(new Raccoon());
  }

  // --- cursor ------------------------------------------------------------

  let mouseX = W / 2, mouseY = H / 2;
  let hasMouse = false;
  let mouseInWindow = false;

  function updateCursorVisibility(overCard) {
    cursorEl.classList.toggle('hidden', !mouseInWindow || overCard);
  }

  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    hasMouse = true;
    mouseInWindow = true; // a mousemove means the pointer is in the window, even if it was already there on page load (mouseenter never fires in that case)
    cursorEl.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
    updateCursorVisibility(!!(cardEl && cardEl.contains(e.target)));
  }

  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseleave', () => {
    mouseInWindow = false;
    updateCursorVisibility(false);
  });
  document.addEventListener('mouseenter', () => {
    mouseInWindow = true;
    updateCursorVisibility(false);
  });

  function pulseCursor() {
    cursorEl.classList.add('pulse');
    setTimeout(() => cursorEl.classList.remove('pulse'), 220);
  }

  // --- main loop -----------------------------------------------------

  let lastTime = performance.now();

  // Cap at ~60fps. On 120Hz laptop screens requestAnimationFrame fires twice
  // as often, which doubles the drawing work (and heat) with no visible gain.
  const MIN_FRAME_MS = 1000 / 60 - 2;

  function frame(now) {
    if (now - lastTime < MIN_FRAME_MS) {
      requestAnimationFrame(frame);
      return;
    }
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.05);

    ctx.clearRect(0, 0, W, H);

    let fedSomeone = false;
    for (const r of raccoons) {
      r.update(dt);
      if (hasMouse && r.state !== 'eating' && r.hitTest(mouseX, mouseY)) {
        r.startEating();
        fedSomeone = true;
      }
    }
    if (fedSomeone) pulseCursor();

    // Bushes sit behind everything; grass and flowers are interleaved with the
    // raccoons by baseline so a raccoon can stand behind a tuft in front of it.
    if (sceneryBack && sceneryBack.width && sceneryBack.height) ctx.drawImage(sceneryBack, 0, 0, W, H);
    let si = 0;
    for (const r of raccoons.slice().sort((a, b) => a.y - b.y)) {
      while (si < sceneryFront.length && sceneryFront[si].by <= r.y) drawScenery(ctx, sceneryFront[si++]);
      r.draw(ctx);
    }
    while (si < sceneryFront.length) drawScenery(ctx, sceneryFront[si++]);

    requestAnimationFrame(frame);
  }

  let relayoutTimer = null;
  window.addEventListener('resize', () => {
    // A hidden or collapsed window reports 0x0; ignore that and keep the scene.
    if (!window.innerWidth || !window.innerHeight) return;
    resize();
    for (const r of raccoons) r.evict();
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(layoutScenery, 150);
  });

  // With a tall card (the page scrolls) the card blocks the whole screen
  // height, so raccoons can never cross from one side to the other. If one
  // side ends up crowded, walk the surplus over to the emptier side.
  function balanceSides() {
    if (cardBox.top > -1e3) return;
    const left = raccoons.filter((r) => r.x < cardBox.left);
    const right = raccoons.filter((r) => r.x > cardBox.right);
    const [full, empty, toLeft] = left.length > right.length ? [left, right, false] : [right, left, true];
    let surplus = Math.floor((full.length - empty.length) / 2);
    while (surplus-- > 0) {
      const r = full.pop();
      const lo = toLeft ? 30 * r.scale : cardBox.right + 62 * r.scale + 6;
      const hi = toLeft ? cardBox.left - 62 * r.scale - 6 : W - 30 * r.scale;
      if (hi <= lo) return;
      let placed = false;
      for (let i = 0; i < 20 && !placed; i++) {
        const nx = rand(lo, hi);
        const ny = rand(80, H - 8);
        if (i < 15 && tooCloseToOthers(nx, ny, 85, r)) continue;
        r.x = nx;
        r.y = ny;
        placed = true;
      }
      if (placed) {
        r.hopStart = { x: r.x, y: r.y };
        r.hopEnd = { x: r.x, y: r.y };
        r.hopPhase = 'resting';
        r.restTimer = rand(0.2, 0.8);
        r.pickTarget();
      }
    }
  }

  // The card's size can change after first paint (web fonts) or when another
  // tab's content is swapped in. Move any raccoon it now covers and re-place
  // only the meadow pieces it now covers; the rest stays exactly where it was.
  function refreshForCard() {
    const before = JSON.stringify(cardBox);
    updateCardRect();
    if (JSON.stringify(cardBox) === before) return;
    for (const r of raccoons) r.evict();
    balanceSides();
    rebuildSceneryLayers();
  }
  window.addEventListener('load', refreshForCard);
  // Opening or closing a section changes the card's height.
  document.addEventListener('toggle', refreshForCard, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshForCard);

  // --- keeping the scene across tabs ------------------------------------

  // Switching tabs swaps just the card's contents in place (no reload), so
  // the raccoons keep walking and the meadow never changes. That needs
  // fetch, which browsers block for pages opened straight from disk
  // (file://); there the scene is saved on the way out and restored by the
  // next page instead.
  const canSwapPages = location.protocol === 'http:' || location.protocol === 'https:';

  async function swapPage(url, push) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const nextCard = doc.querySelector('.card');
    if (!nextCard || !cardEl) throw new Error('no card in ' + url);
    cardEl.innerHTML = nextCard.innerHTML;
    document.title = doc.title;
    if (push) history.pushState({}, '', url);
    window.scrollTo(0, 0);
    refreshForCard();
  }

  // Tapping the little (i) shows its note (hovering does too, but touch screens can't hover).
  document.addEventListener('click', (e) => {
    const tip = e.target.closest && e.target.closest('.tip');
    for (const t of document.querySelectorAll('.tip.show')) if (t !== tip) t.classList.remove('show');
    if (!tip) return;
    e.preventDefault(); // inside a summary: don't also open or close the section
    tip.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!canSwapPages || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a.tab');
    if (!a || a.origin !== location.origin) return;
    e.preventDefault();
    if (a.href === location.href) return;
    swapPage(a.href, true).catch(() => { location.href = a.href; });
  });
  window.addEventListener('popstate', () => {
    if (canSwapPages) swapPage(location.href, false).catch(() => location.reload());
  });

  const STATE_KEY = 'nick-meadow-state-v1';

  function saveState() {
    if (!ASSETS) return;
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          W,
          H,
          raccoons: raccoons.map((r) => ({ x: r.x, y: r.y, scale: r.scale, facing: r.facing, tx: r.tx, ty: r.ty, hopDistance: r.hopDistance })),
          scenery: sceneryItems.map((i) => ({ name: i.name, x: i.x, by: i.by, w: i.w, h: i.h, flip: i.flip })),
        })
      );
    } catch (err) {
      // storage unavailable: the scene just reshuffles on navigation
    }
  }

  function loadState() {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type === 'reload') {
        sessionStorage.removeItem(STATE_KEY); // a manual refresh gets a fresh meadow
        return null;
      }
      const raw = sessionStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });

  resize();
  Promise.all([loadAssets(), loadScenery()])
    .then(([{ assets, bboxes }]) => {
      ASSETS = assets;
      BBOXES = bboxes;
      const saved = loadState();
      const sameSize = saved && Math.abs(saved.W - W) < 2 && Math.abs(saved.H - H) < 2;
      if (sameSize && saved.scenery && saved.scenery.length) {
        sceneryItems = saved.scenery
          .filter((sv) => SCENERY_IMAGES[sv.name])
          .map((sv) => makeItem(sv.name, sv.x, sv.by, sv.w, sv.h, sv.flip));
        rebuildSceneryLayers();
      } else {
        layoutScenery();
      }
      initRaccoons(saved && saved.raccoons);
      balanceSides();
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      console.error('raccoons.js: failed to load sprite assets — check that the assets/ folder is next to this page.', err);
    });
})();
