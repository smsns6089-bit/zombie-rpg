// Project Game Maker: Zombie Survival (Top-Down)
// Single-file game logic. No libraries. Works on GitHub Pages.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  hp: document.getElementById("hp"),
  ammo: document.getElementById("ammo"),
  mag: document.getElementById("mag"),
  reserve: document.getElementById("reserve"),
  cash: document.getElementById("cash"),
  wave: document.getElementById("wave"),
  hint: document.getElementById("hint"),
  overlay: document.getElementById("overlay"),
  death: document.getElementById("death"),
  restart: document.getElementById("restart"),
  closeShop: document.getElementById("closeShop"),
  buyAmmo: document.getElementById("buyAmmo"),
  buyMedkit: document.getElementById("buyMedkit"),
  buyDamage: document.getElementById("buyDamage"),
};

function fitCanvas() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// World
const world = {
  w: 3200,
  h: 3200,
  safeZone: { x: 1400, y: 1400, r: 220 },
};

// Input
const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === "e") toggleShopIfInSafeZone();
  if (e.key.toLowerCase() === "r") tryReload();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
window.addEventListener("mousemove", (e) => (mouse = { ...mouse, x: e.clientX, y: e.clientY }));
window.addEventListener("mousedown", () => (mouse.down = true));
window.addEventListener("mouseup", () => (mouse.down = false));

// Mobile joystick
const joyWrap = document.getElementById("joyWrap");
const joyBase = document.getElementById("joyBase");
const joyStick = document.getElementById("joyStick");
let joy = { active: false, dx: 0, dy: 0, id: null };

function setHint(text, color = "") {
  ui.hint.textContent = text || "";
  ui.hint.style.borderColor = color ? color : "rgba(255,255,255,.08)";
}
setHint("Survive. Loot cash. Return to Safe Zone to shop.");

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function rand(a, b) { return a + Math.random() * (b - a); }

// Player
const player = {
  x: world.safeZone.x,
  y: world.safeZone.y,
  r: 16,
  hp: 100,
  maxHp: 100,
  speed: 220,
  cash: 0,
  damageMult: 1,
  gun: {
    magSize: 12,
    ammoInMag: 12,
    reserve: 48,
    fireRate: 9, // shots/sec
    bulletSpeed: 820,
    bulletDamage: 18,
    reloadTime: 0.95,
    lastShot: 0,
    reloading: false,
    reloadT: 0,
  },
};

let camera = { x: 0, y: 0 };
function worldToScreen(wx, wy) {
  return { x: wx - camera.x, y: wy - camera.y };
}
function screenToWorld(sx, sy) {
  return { x: sx + camera.x, y: sy + camera.y };
}

// Entities
let bullets = [];
let zombies = [];
let drops = [];

let wave = 1;
let spawnTimer = 0;
let alive = true;
let shopOpen = false;

// Shooting
function shootAt(targetWorld) {
  const g = player.gun;
  const now = performance.now() / 1000;
  if (g.reloading) return;
  if (now - g.lastShot < 1 / g.fireRate) return;
  if (g.ammoInMag <= 0) { setHint("Click… empty. Press R to reload.", "rgba(245,158,11,.5)"); return; }

  g.lastShot = now;
  g.ammoInMag--;

  const ang = Math.atan2(targetWorld.y - player.y, targetWorld.x - player.x);
  bullets.push({
    x: player.x,
    y: player.y,
    vx: Math.cos(ang) * g.bulletSpeed,
    vy: Math.sin(ang) * g.bulletSpeed,
    r: 4,
    dmg: g.bulletDamage * player.damageMult,
    life: 0.9,
  });
}

function tryReload() {
  const g = player.gun;
  if (g.reloading) return;
  if (g.ammoInMag >= g.magSize) return;
  if (g.reserve <= 0) { setHint("No reserve ammo. Buy ammo in shop.", "rgba(239,68,68,.5)"); return; }

  g.reloading = true;
  g.reloadT = 0;
  setHint("Reloading…");
}

// Shop
function inSafeZone() {
  return dist(player, { x: world.safeZone.x, y: world.safeZone.y }) <= world.safeZone.r;
}
function toggleShopIfInSafeZone() {
  if (!alive) return;
  if (!inSafeZone()) return;
  shopOpen = !shopOpen;
  ui.overlay.classList.toggle("hidden", !shopOpen);
  setHint(shopOpen ? "Shopping time. Spend cash." : "Back to surviving.");
}
ui.closeShop.addEventListener("click", () => {
  shopOpen = false;
  ui.overlay.classList.add("hidden");
});
ui.buyAmmo.addEventListener("click", () => {
  if (player.cash < 15) return setHint("Not enough cash for ammo.", "rgba(239,68,68,.5)");
  player.cash -= 15;
  player.gun.reserve += 24;
  setHint("Bought ammo pack (+24).", "rgba(34,197,94,.5)");
});
ui.buyMedkit.addEventListener("click", () => {
  if (player.cash < 20) return setHint("Not enough cash for medkit.", "rgba(239,68,68,.5)");
  player.cash -= 20;
  player.hp = clamp(player.hp + 35, 0, player.maxHp);
  setHint("Healed +35 HP.", "rgba(34,197,94,.5)");
});
ui.buyDamage.addEventListener("click", () => {
  if (player.cash < 40) return setHint("Not enough cash for damage upgrade.", "rgba(239,68,68,.5)");
  player.cash -= 40;
  player.damageMult *= 1.2;
  setHint("Damage increased! (+20%)", "rgba(34,197,94,.5)");
});

// Spawning
function spawnZombie() {
  // Spawn around edges of camera view, outside safe zone radius
  const margin = 520;
  const viewW = innerWidth, viewH = innerHeight;
  const camCenter = { x: camera.x + viewW / 2, y: camera.y + viewH / 2 };

  let x, y;
  const side = Math.floor(Math.random() * 4);
  if (side === 0) { x = camCenter.x + rand(-viewW/2, viewW/2); y = camCenter.y - viewH/2 - margin; }
  if (side === 1) { x = camCenter.x + rand(-viewW/2, viewW/2); y = camCenter.y + viewH/2 + margin; }
  if (side === 2) { x = camCenter.x - viewW/2 - margin; y = camCenter.y + rand(-viewH/2, viewH/2); }
  if (side === 3) { x = camCenter.x + viewW/2 + margin; y = camCenter.y + rand(-viewH/2, viewH/2); }

  x = clamp(x, 0, world.w);
  y = clamp(y, 0, world.h);

  // keep out of safe zone spawn
  const tryPos = { x, y };
  if (dist(tryPos, world.safeZone) < world.safeZone.r + 220) return;

  const baseHp = 55 + wave * 8;
  const baseSpeed = 80 + wave * 2.5;

  zombies.push({
    x, y,
    r: rand(16, 22),
    hp: baseHp,
    maxHp: baseHp,
    speed: baseSpeed * rand(0.85, 1.12),
    dmg: 10 + wave * 1.5,
    hitCd: 0,
    type: Math.random() < 0.18 ? "runner" : "walker",
  });
}

function dropCash(x, y, amount) {
  drops.push({ x, y, r: 10, amount, t: 14 });
}

// Waves
function waveTargetCount() {
  return 8 + wave * 3;
}
function nextWaveIfClear() {
  // soft wave: if player kills enough, wave increases gradually
  // Here we advance when cash threshold or time threshold; keep it simple:
}

// Game loop
let last = performance.now();
function loop(nowMs) {
  requestAnimationFrame(loop);
  const now = nowMs;
  let dt = (now - last) / 1000;
  dt = Math.min(0.033, dt);
  last = now;

  update(dt, now / 1000);
  render();
}
requestAnimationFrame(loop);

function update(dt, t) {
  if (!alive) return;

  // Shop pauses zombies a bit but doesn't fully freeze world, keep it tense
  const paused = shopOpen;

  // Reload tick
  const g = player.gun;
  if (g.reloading) {
    g.reloadT += dt;
    if (g.reloadT >= g.reloadTime) {
      const needed = g.magSize - g.ammoInMag;
      const take = Math.min(needed, g.reserve);
      g.reserve -= take;
      g.ammoInMag += take;
      g.reloading = false;
      setHint("Reloaded.");
    }
  }

  // Movement
  let mx = 0, my = 0;
  if (keys.has("w")) my -= 1;
  if (keys.has("s")) my += 1;
  if (keys.has("a")) mx -= 1;
  if (keys.has("d")) mx += 1;

  // Mobile joystick vector
  if (joy.active) {
    mx += joy.dx;
    my += joy.dy;
  }

  const len = Math.hypot(mx, my) || 1;
  mx /= len; my /= len;

  const spd = player.speed * (inSafeZone() ? 1.05 : 1);
  if (!paused) {
    player.x = clamp(player.x + mx * spd * dt, 0, world.w);
    player.y = clamp(player.y + my * spd * dt, 0, world.h);
  }

  // Camera follows
  camera.x = clamp(player.x - innerWidth / 2, 0, world.w - innerWidth);
  camera.y = clamp(player.y - innerHeight / 2, 0, world.h - innerHeight);

  // Aim target
  const aimWorld = screenToWorld(mouse.x, mouse.y);

  // Shoot (mouse or mobile auto shoot if touching right side)
  if (!paused && mouse.down) shootAt(aimWorld);

  // Spawning logic
  if (!paused) {
    spawnTimer -= dt;
    const desired = waveTargetCount();
    const spawnRate = Math.max(0.12, 0.55 - wave * 0.02); // faster over time
    if (zombies.length < desired && spawnTimer <= 0) {
      spawnZombie();
      spawnTimer = spawnRate;
    }

    // Increase wave slowly by time survived
    if (t > wave * 25) wave++;
  }

  // Bullets update
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!paused) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > world.w || b.y > world.h) bullets.splice(i, 1);
  }

  // Zombies update + collisions
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];

    // AI: chase player but avoid safe zone slightly
    if (!paused) {
      const ang = Math.atan2(player.y - z.y, player.x - z.x);
      let sp = z.speed * (z.type === "runner" ? 1.25 : 1);
      // Slow them inside safe zone so it feels safer
      if (dist(z, world.safeZone) < world.safeZone.r) sp *= 0.25;

      z.x = clamp(z.x + Math.cos(ang) * sp * dt, 0, world.w);
      z.y = clamp(z.y + Math.sin(ang) * sp * dt, 0, world.h);
      z.hitCd = Math.max(0, z.hitCd - dt);
    }

    // Zombie hurts player if touching
    const d = dist(z, player);
    if (d < z.r + player.r) {
      if (z.hitCd <= 0 && !paused) {
        z.hitCd = 0.55;
        player.hp -= z.dmg;
        setHint("You’re getting chewed! Get space!", "rgba(239,68,68,.5)");
        if (player.hp <= 0) die();
      }
    }

    // Bullet hits zombie
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      const dd = Math.hypot(z.x - b.x, z.y - b.y);
      if (dd < z.r + b.r) {
        z.hp -= b.dmg;
        bullets.splice(j, 1);
        if (z.hp <= 0) {
          // drop cash
          const amt = Math.floor(rand(6, 14) + wave * 0.5);
          dropCash(z.x, z.y, amt);
          zombies.splice(i, 1);
        }
        break;
      }
    }
  }

  // Drops pickup
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (!paused) d.t -= dt;
    if (dist(d, player) < d.r + player.r + 6) {
      player.cash += d.amount;
      drops.splice(i, 1);
      setHint(`Picked up $${d.amount}.`, "rgba(34,197,94,.45)");
      continue;
    }
    if (d.t <= 0) drops.splice(i, 1);
  }

  // Safe zone hint
  if (inSafeZone() && !shopOpen) setHint("Safe Zone: press E to open shop.", "rgba(34,197,94,.35)");

  // UI update
  ui.hp.textContent = Math.max(0, Math.floor(player.hp));
  ui.ammo.textContent = player.gun.ammoInMag;
  ui.mag.textContent = player.gun.magSize;
  ui.reserve.textContent = player.gun.reserve;
  ui.cash.textContent = player.cash;
  ui.wave.textContent = wave;
}

function die() {
  alive = false;
  ui.death.classList.remove("hidden");
}

ui.restart.addEventListener("click", () => {
  // Reset everything for now
  bullets = [];
  zombies = [];
  drops = [];
  wave = 1;
  spawnTimer = 0;
  alive = true;
  shopOpen = false;
  ui.overlay.classList.add("hidden");
  ui.death.classList.add("hidden");

  player.x = world.safeZone.x;
  player.y = world.safeZone.y;
  player.hp = player.maxHp;
  player.cash = 0;
  player.damageMult = 1;
  player.gun.ammoInMag = player.gun.magSize;
  player.gun.reserve = 48;
  player.gun.reloading = false;
  setHint("Back in. Don’t get clapped by the horde.");
});

// Rendering
function render() {
  // Clear
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  // Background grid
  const grid = 64;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // World bounds and grid lines (only nearby for performance)
  const startX = Math.floor(camera.x / grid) * grid;
  const startY = Math.floor(camera.y / grid) * grid;
  const endX = camera.x + innerWidth;
  const endY = camera.y + innerHeight;

  ctx.strokeStyle = "rgba(255,255,255,.04)";
  ctx.lineWidth = 1;

  for (let x = startX; x <= endX; x += grid) {
    const sx = x - camera.x;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, innerHeight); ctx.stroke();
  }
  for (let y = startY; y <= endY; y += grid) {
    const sy = y - camera.y;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(innerWidth, sy); ctx.stroke();
  }

  // Safe zone
  {
    const s = worldToScreen(world.safeZone.x, world.safeZone.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, world.safeZone.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(34,197,94,.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(34,197,94,.35)";
    ctx.stroke();

    ctx.fillStyle = "rgba(34,197,94,.75)";
    ctx.font = "14px system-ui";
    ctx.fillText("SAFE ZONE", s.x - 40, s.y - world.safeZone.r - 10);
  }

  // Drops
  for (const d of drops) {
    const s = worldToScreen(d.x, d.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(34,197,94,.8)";
    ctx.fill();
    ctx.fillStyle = "#06120a";
    ctx.font = "12px system-ui";
    ctx.fillText("$", s.x - 3, s.y + 4);
  }

  // Bullets
  ctx.fillStyle = "rgba(245,158,11,.9)";
  for (const b of bullets) {
    const s = worldToScreen(b.x, b.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Zombies
  for (const z of zombies) {
    const s = worldToScreen(z.x, z.y);

    // body
    ctx.beginPath();
    ctx.arc(s.x, s.y, z.r, 0, Math.PI * 2);
    ctx.fillStyle = z.type === "runner" ? "rgba(239,68,68,.85)" : "rgba(148,163,184,.85)";
    ctx.fill();

    // hp bar
    const w = z.r * 2;
    const hpPct = clamp(z.hp / z.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(s.x - w/2, s.y - z.r - 12, w, 5);
    ctx.fillStyle = "rgba(34,197,94,.9)";
    ctx.fillRect(s.x - w/2, s.y - z.r - 12, w * hpPct, 5);
  }

  // Player
  {
    const s = worldToScreen(player.x, player.y);
    // body
    ctx.beginPath();
    ctx.arc(s.x, s.y, player.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(59,130,246,.9)";
    ctx.fill();

    // aim line
    const aim = screenToWorld(mouse.x, mouse.y);
    const a = worldToScreen(aim.x, aim.y);
    ctx.strokeStyle = "rgba(255,255,255,.20)";
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();

    // player HP bar
    const w = 70;
    const hpPct = clamp(player.hp / player.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(s.x - w/2, s.y + player.r + 10, w, 7);
    ctx.fillStyle = "rgba(34,197,94,.9)";
    ctx.fillRect(s.x - w/2, s.y + player.r + 10, w * hpPct, 7);
  }

  // Border vignette (danger feel)
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(0, 0, innerWidth, 10);
  ctx.fillRect(0, innerHeight-10, innerWidth, 10);
  ctx.fillRect(0, 0, 10, innerHeight);
  ctx.fillRect(innerWidth-10, 0, 10, innerHeight);
}

// Mobile joystick handling
function isCoarsePointer() {
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}

if (isCoarsePointer()) {
  joyWrap.style.display = "block";

  window.addEventListener("touchstart", (e) => {
    if (!alive) return;
    for (const t of e.changedTouches) {
      // Left side joystick
      if (t.clientX < innerWidth * 0.45 && !joy.active) {
        joy.active = true;
        joy.id = t.identifier;
        joy.dx = 0; joy.dy = 0;
        joyBase.dataset.cx = t.clientX;
        joyBase.dataset.cy = t.clientY;
        // move base to touch
        joyWrap.style.left = (t.clientX - 70) + "px";
        joyWrap.style.top = (t.clientY - 70) + "px";
        joyWrap.style.bottom = "auto";
      } else {
        // Right side = shooting while held
        mouse.down = true;
        mouse.x = t.clientX;
        mouse.y = t.clientY;
      }
    }
  }, { passive: false });

  window.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        const cx = Number(joyBase.dataset.cx || 0);
        const cy = Number(joyBase.dataset.cy || 0);
        const dx = t.clientX - cx;
        const dy = t.clientY - cy;
        const max = 40;
        const clx = clamp(dx, -max, max);
        const cly = clamp(dy, -max, max);

        joy.dx = clx / max;
        joy.dy = cly / max;

        joyStick.style.left = (38 + clx) + "px";
        joyStick.style.top = (38 + cly) + "px";
      } else {
        mouse.x = t.clientX;
        mouse.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        joy.active = false;
        joy.id = null;
        joy.dx = 0; joy.dy = 0;
        joyStick.style.left = "38px";
        joyStick.style.top = "38px";
        // return joystick to bottom-left default
        joyWrap.style.left = "18px";
        joyWrap.style.top = "auto";
        joyWrap.style.bottom = "18px";
      } else {
        mouse.down = false;
      }
    }
  });
}
