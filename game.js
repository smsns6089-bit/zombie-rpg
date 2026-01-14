 //
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

  start: document.getElementById("start"),
  startBtn: document.getElementById("startBtn"),

  shop: document.getElementById("shop"),
  closeShop: document.getElementById("closeShop"),
  buyAmmo: document.getElementById("buyAmmo"),
  buyMedkit: document.getElementById("buyMedkit"),
  buyDamage: document.getElementById("buyDamage"),

  death: document.getElementById("death"),
  restart: document.getElementById("restart"),
};

function fitCanvas() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", fitCanvas);
fitCanvas();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function rand(a, b) { return a + Math.random() * (b - a); }

function setHint(text, ok=false) {
  ui.hint.textContent = text || "";
  ui.hint.style.borderColor = ok ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.08)";
}

const world = {
  w: 3200,
  h: 3200,
  safeZone: { x: 1400, y: 1400, r: 220 },
};

const state = {
  mode: "start", // start | play | shop | dead
  wave: 1,
  time: 0,
  spawnTimer: 0,
};

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
    fireRate: 9,
    bulletSpeed: 820,
    bulletDamage: 18,
    lastShot: 0,
    reloading: false,
    reloadTime: 0.95,
    reloadT: 0,
  }
};
ui.mag.textContent = player.gun.magSize;

let bullets = [];
let zombies = [];
let drops = [];
let camera = { x: 0, y: 0 };

const keys = new Set();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);

  if (k === "r") tryReload();
  if (k === "e") {
    if (state.mode === "play" && inSafeZone()) openShop();
    else if (state.mode === "shop") closeShop();
  }
  if (k === "escape" && state.mode === "shop") closeShop();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let mouse = { x: innerWidth/2, y: innerHeight/2, down: false };
addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("mousedown", () => { mouse.down = true; if (state.mode === "start") startGame(); });
addEventListener("mouseup", () => { mouse.down = false; });

function worldToScreen(wx, wy) { return { x: wx - camera.x, y: wy - camera.y }; }
function screenToWorld(sx, sy) { return { x: sx + camera.x, y: sy + camera.y }; }

function inSafeZone(){
  return dist(player, world.safeZone) <= world.safeZone.r;
}

function startGame(){
  state.mode = "play";
  ui.start.classList.add("hidden");
  ui.shop.classList.add("hidden");
  ui.death.classList.add("hidden");
  setHint("Survive. Loot cash. Safe Zone = shop.", true);
}

function openShop(){
  state.mode = "shop";
  ui.shop.classList.remove("hidden");
  ui.death.classList.add("hidden"); // prevent stacking
  setHint("Shop open. E or ESC to close.", true);
}
function closeShop(){
  state.mode = "play";
  ui.shop.classList.add("hidden");
  setHint("Back to surviving.", true);
}

function die(){
  state.mode = "dead";
  ui.shop.classList.add("hidden"); // force-close shop so it never stacks
  ui.death.classList.remove("hidden");
  setHint("You died. Restart to try again.");
}

ui.startBtn.addEventListener("click", startGame);
ui.closeShop.addEventListener("click", closeShop);

ui.restart.addEventListener("click", () => {
  bullets = [];
  zombies = [];
  drops = [];
  state.wave = 1;
  state.time = 0;
  state.spawnTimer = 0;

  player.x = world.safeZone.x;
  player.y = world.safeZone.y;
  player.hp = player.maxHp;
  player.cash = 0;
  player.damageMult = 1;
  player.gun.ammoInMag = player.gun.magSize;
  player.gun.reserve = 48;
  player.gun.reloading = false;

  ui.death.classList.add("hidden");
  ui.shop.classList.add("hidden");
  state.mode = "play";
  setHint("Restarted. Don’t get boxed in 😈", true);
});

// Shop buttons
ui.buyAmmo.addEventListener("click", () => {
  if (player.cash < 15) return setHint("Not enough cash.", false);
  player.cash -= 15;
  player.gun.reserve += 24;
  setHint("Bought ammo pack (+24).", true);
});
ui.buyMedkit.addEventListener("click", () => {
  if (player.cash < 20) return setHint("Not enough cash.", false);
  player.cash -= 20;
  player.hp = clamp(player.hp + 35, 0, player.maxHp);
  setHint("Healed +35 HP.", true);
});
ui.buyDamage.addEventListener("click", () => {
  if (player.cash < 40) return setHint("Not enough cash.", false);
  player.cash -= 40;
  player.damageMult *= 1.2;
  setHint("Damage increased (+20%).", true);
});

// Combat
function shootAt(targetWorld){
  if (state.mode !== "play") return;
  const g = player.gun;
  const now = performance.now()/1000;
  if (g.reloading) return;
  if (now - g.lastShot < 1/g.fireRate) return;
  if (g.ammoInMag <= 0) return setHint("Empty. Press R to reload.", false);

  g.lastShot = now;
  g.ammoInMag--;

  const ang = Math.atan2(targetWorld.y - player.y, targetWorld.x - player.x);
  bullets.push({
    x: player.x, y: player.y,
    vx: Math.cos(ang) * g.bulletSpeed,
    vy: Math.sin(ang) * g.bulletSpeed,
    r: 4,
    dmg: g.bulletDamage * player.damageMult,
    life: 0.9,
  });
}

function tryReload(){
  if (state.mode !== "play") return;
  const g = player.gun;
  if (g.reloading) return;
  if (g.ammoInMag >= g.magSize) return;
  if (g.reserve <= 0) return setHint("No reserve ammo. Buy ammo in shop.", false);
  g.reloading = true;
  g.reloadT = 0;
  setHint("Reloading...", true);
}

// Spawning
function waveTargetCount(){ return 8 + state.wave * 3; }

function spawnZombie(){
  const margin = 520;
  const viewW = innerWidth, viewH = innerHeight;
  const camCenter = { x: camera.x + viewW/2, y: camera.y + viewH/2 };

  let x, y;
  const side = Math.floor(Math.random()*4);
  if (side===0) { x = camCenter.x + rand(-viewW/2, viewW/2); y = camCenter.y - viewH/2 - margin; }
  if (side===1) { x = camCenter.x + rand(-viewW/2, viewW/2); y = camCenter.y + viewH/2 + margin; }
  if (side===2) { x = camCenter.x - viewW/2 - margin; y = camCenter.y + rand(-viewH/2, viewH/2); }
  if (side===3) { x = camCenter.x + viewW/2 + margin; y = camCenter.y + rand(-viewH/2, viewH/2); }

  x = clamp(x, 0, world.w);
  y = clamp(y, 0, world.h);

  const tryPos = { x, y };
  if (dist(tryPos, world.safeZone) < world.safeZone.r + 220) return;

  const hp = 55 + state.wave * 8;
  zombies.push({
    x, y,
    r: rand(16, 22),
    hp, maxHp: hp,
    speed: (80 + state.wave * 2.5) * rand(0.85, 1.12),
    dmg: 10 + state.wave * 1.5,
    hitCd: 0,
    type: Math.random() < 0.18 ? "runner" : "walker",
  });
}

function dropCash(x,y,amount){
  drops.push({ x,y, r:10, amount, t:14 });
}

// Main loop
let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  let dt = (now-last)/1000;
  dt = Math.min(0.033, dt);
  last = now;

  update(dt);
  render();
}
requestAnimationFrame(loop);

function update(dt){
  // UI always updates
  ui.hp.textContent = Math.max(0, Math.floor(player.hp));
  ui.ammo.textContent = player.gun.ammoInMag;
  ui.reserve.textContent = player.gun.reserve;
  ui.cash.textContent = player.cash;
  ui.wave.textContent = state.wave;

  if (state.mode === "start" || state.mode === "dead") return;

  // Shop pauses the world
  const paused = (state.mode === "shop");

  // Reload
  const g = player.gun;
  if (g.reloading && !paused){
    g.reloadT += dt;
    if (g.reloadT >= g.reloadTime){
      const need = g.magSize - g.ammoInMag;
      const take = Math.min(need, g.reserve);
      g.reserve -= take;
      g.ammoInMag += take;
      g.reloading = false;
      setHint("Reloaded.", true);
    }
  }

  // Movement
  let mx=0, my=0;
  if (keys.has("w")) my -= 1;
  if (keys.has("s")) my += 1;
  if (keys.has("a")) mx -= 1;
  if (keys.has("d")) mx += 1;

  const len = Math.hypot(mx,my) || 1;
  mx/=len; my/=len;

  if (!paused){
    const spd = player.speed * (inSafeZone() ? 1.05 : 1);
    player.x = clamp(player.x + mx*spd*dt, 0, world.w);
    player.y = clamp(player.y + my*spd*dt, 0, world.h);
  }

  // Camera
  camera.x = clamp(player.x - innerWidth/2, 0, world.w - innerWidth);
  camera.y = clamp(player.y - innerHeight/2, 0, world.h - innerHeight);

  // Shooting
  if (!paused && mouse.down){
    shootAt(screenToWorld(mouse.x, mouse.y));
  }

  // Wave scaling
  if (!paused){
    state.time += dt;
    if (state.time > state.wave * 25) state.wave++;
  }

  // Spawning
  if (!paused){
    state.spawnTimer -= dt;
    const desired = waveTargetCount();
    const spawnRate = Math.max(0.12, 0.55 - state.wave*0.02);
    if (zombies.length < desired && state.spawnTimer <= 0){
      spawnZombie();
      state.spawnTimer = spawnRate;
    }
  }

  // Bullets
  for (let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    if (!paused){
      b.x += b.vx*dt;
      b.y += b.vy*dt;
      b.life -= dt;
    }
    if (b.life<=0 || b.x<0 || b.y<0 || b.x>world.w || b.y>world.h) bullets.splice(i,1);
  }

  // Zombies + collisions
  for (let i=zombies.length-1; i>=0; i--){
    const z = zombies[i];
    if (!paused){
      const ang = Math.atan2(player.y - z.y, player.x - z.x);
      let sp = z.speed * (z.type==="runner" ? 1.25 : 1);
      if (dist(z, world.safeZone) < world.safeZone.r) sp *= 0.25;
      z.x = clamp(z.x + Math.cos(ang)*sp*dt, 0, world.w);
      z.y = clamp(z.y + Math.sin(ang)*sp*dt, 0, world.h);
      z.hitCd = Math.max(0, z.hitCd - dt);
    }

    // Zombie damages player
    if (!paused && dist(z, player) < z.r + player.r){
      if (z.hitCd <= 0){
        z.hitCd = 0.55;
        player.hp -= z.dmg;
        setHint("Getting chewed! Move!", false);
        if (player.hp <= 0) die();
      }
    }

    // Bullet hits
    for (let j=bullets.length-1; j>=0; j--){
      const b = bullets[j];
      if (Math.hypot(z.x-b.x, z.y-b.y) < z.r + b.r){
        z.hp -= b.dmg;
        bullets.splice(j,1);
        if (z.hp <= 0){
          const amt = Math.floor(rand(6,14) + state.wave*0.5);
          dropCash(z.x, z.y, amt);
          zombies.splice(i,1);
        }
        break;
      }
    }
  }

  // Drops pickup
  for (let i=drops.length-1; i>=0; i--){
    const d = drops[i];
    if (!paused) d.t -= dt;
    if (dist(d, player) < d.r + player.r + 6){
      player.cash += d.amount;
      drops.splice(i,1);
      setHint(`Picked up $${d.amount}.`, true);
      continue;
    }
    if (d.t <= 0) drops.splice(i,1);
  }

  if (inSafeZone() && state.mode === "play"){
    setHint("SAFE ZONE: press E to shop.", true);
  }
}

function render(){
  ctx.clearRect(0,0,innerWidth,innerHeight);

  // background
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0,0,innerWidth,innerHeight);

  // grid
  const grid = 64;
  const startX = Math.floor(camera.x / grid) * grid;
  const startY = Math.floor(camera.y / grid) * grid;
  const endX = camera.x + innerWidth;
  const endY = camera.y + innerHeight;

  ctx.strokeStyle = "rgba(255,255,255,.04)";
  ctx.lineWidth = 1;

  for (let x=startX; x<=endX; x+=grid){
    const sx = x - camera.x;
    ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,innerHeight); ctx.stroke();
  }
  for (let y=startY; y<=endY; y+=grid){
    const sy = y - camera.y;
    ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(innerWidth,sy); ctx.stroke();
  }

  // safe zone
  {
    const s = worldToScreen(world.safeZone.x, world.safeZone.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, world.safeZone.r, 0, Math.PI*2);
    ctx.fillStyle = "rgba(34,197,94,.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(34,197,94,.35)";
    ctx.stroke();

    ctx.fillStyle = "rgba(34,197,94,.75)";
    ctx.font = "14px system-ui";
    ctx.fillText("SAFE ZONE", s.x - 40, s.y - world.safeZone.r - 10);
  }

  // drops
  for (const d of drops){
    const s = worldToScreen(d.x,d.y);
    ctx.beginPath();
    ctx.arc(s.x,s.y,d.r,0,Math.PI*2);
    ctx.fillStyle = "rgba(34,197,94,.85)";
    ctx.fill();
    ctx.fillStyle = "#06120a";
    ctx.font = "12px system-ui";
    ctx.fillText("$", s.x-3, s.y+4);
  }

  // bullets
  ctx.fillStyle = "rgba(245,158,11,.9)";
  for (const b of bullets){
    const s = worldToScreen(b.x,b.y);
    ctx.beginPath();
    ctx.arc(s.x,s.y,b.r,0,Math.PI*2);
    ctx.fill();
  }

  // zombies
  for (const z of zombies){
    const s = worldToScreen(z.x,z.y);
    ctx.beginPath();
    ctx.arc(s.x,s.y,z.r,0,Math.PI*2);
    ctx.fillStyle = z.type==="runner" ? "rgba(239,68,68,.85)" : "rgba(148,163,184,.85)";
    ctx.fill();

    const w = z.r*2;
    const pct = clamp(z.hp/z.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(s.x-w/2, s.y-z.r-12, w, 5);
    ctx.fillStyle = "rgba(34,197,94,.9)";
    ctx.fillRect(s.x-w/2, s.y-z.r-12, w*pct, 5);
  }

  // player
  {
    const s = worldToScreen(player.x,player.y);
    ctx.beginPath();
    ctx.arc(s.x,s.y,player.r,0,Math.PI*2);
    ctx.fillStyle = "rgba(59,130,246,.9)";
    ctx.fill();

    // aim line
    const aim = screenToWorld(mouse.x,mouse.y);
    const a = worldToScreen(aim.x,aim.y);
    ctx.strokeStyle = "rgba(255,255,255,.20)";
    ctx.beginPath();
    ctx.moveTo(s.x,s.y);
    ctx.lineTo(a.x,a.y);
    ctx.stroke();
  }
}
