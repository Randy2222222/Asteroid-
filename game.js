// game.js
// Fixed build based on your stable version
// - Tap-to-Start retained
// - Fullscreen using visualViewport where available (fixes iPad wallpaper gap)
// - Invulnerability timing kept, but **no visible shield** drawn
// - Asteroid waves respawn after cleared
// - Saucer sound stops when saucer destroyed or leaves screen
// - Thrust fade, fire/explode volumes preserved
// - Descriptive comments for each area

window.onload = () => {
  (async function init() {
    // -------------------------
    // Canvas + rendering setup
    // -------------------------
    const canvas = document.getElementById("game");
    if (!canvas) {
      console.error("Missing canvas #game");
      return;
    }
    const ctx = canvas.getContext("2d");

    // logical CSS dimensions (not raw pixel buffer)
    let w = window.innerWidth;
    let h = window.innerHeight;

    // Resize helper: prefer visualViewport to avoid iPad "safe area" gaps
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const cssH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = cssW;
      h = cssH;
    }
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", resizeCanvas);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    // Avoid pinch-zoom / gestures on iOS
    document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });

    // -------------------------
    // Audio: AudioContext + AudioBuffers
    // -------------------------
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const soundFiles = {
      thrust: "thrust.mp3",
      fire: "fire.mp3",
      explode: "explode.mp3",
      saucer: "saucer.mp3"
    };

    // Volume multipliers (tweak these if needed)
    const V = {
      thrustGain: 2.0,
      fireGain: 0.1,
      explodeGain: 2.0,
      saucerGain: 1.0
    };

    // Load buffers (await so we can show splash until ready)
    const buffers = {};
    async function loadBuffer(url) {
      try {
        const r = await fetch(url);
        const ab = await r.arrayBuffer();
        return await audioCtx.decodeAudioData(ab);
      } catch (err) {
        console.warn("Audio load failed:", url, err);
        return null;
      }
    }
    for (let k of Object.keys(soundFiles)) buffers[k] = await loadBuffer(soundFiles[k]);

    // Play buffer helper: returns {src,gain} so we can stop it later
    function playBuffer(name, volume = 1.0, loop = false) {
      if (!buffers[name]) return null;
      const src = audioCtx.createBufferSource();
      src.buffer = buffers[name];
      src.loop = loop;
      const gain = audioCtx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(audioCtx.destination);
      src.start(0);
      return { src, gain };
    }

    // Thrust: looping buffer with ramp-in/out, restart-safe
    let activeThrust = { src: null, gain: null };
    function startThrust() {
      if (!buffers.thrust) return;
      if (activeThrust.src) return;
      const node = playBuffer("thrust", 0, true);
      if (!node) return;
      activeThrust.src = node.src;
      activeThrust.gain = node.gain;
      activeThrust.gain.gain.setValueAtTime(0, audioCtx.currentTime);
      activeThrust.gain.gain.linearRampToValueAtTime(V.thrustGain, audioCtx.currentTime + 0.1);
    }
    function stopThrust() {
      if (!activeThrust.src) return;
      const t = audioCtx.currentTime;
      activeThrust.gain.gain.cancelScheduledValues(t);
      activeThrust.gain.gain.setValueAtTime(activeThrust.gain.gain.value, t);
      activeThrust.gain.gain.linearRampToValueAtTime(0, t + 0.25);
      const srcRef = activeThrust.src;
      setTimeout(() => { try { srcRef.stop(); } catch (e) {} }, 300);
      activeThrust.src = null;
      activeThrust.gain = null;
    }

    // Track a short-lived saucer-shot sound instance so it doesn't pile up
    let activeSaucerSound = null;
    function stopActiveSaucerSound() {
      if (activeSaucerSound) {
        try { activeSaucerSound.src.stop(); } catch (e) {}
        activeSaucerSound = null;
      }
    }

    // -------------------------
    // Game constants & helpers
    // -------------------------
    const FRAME_RATE = 60;
    const SHIP_R = 15;
    const BULLET_SPEED = 6;
    const BULLET_MAX_SCREEN_TRAVEL = 1.5; // bullets expire after ~1.5x screen
    const SAUCER_SCORE = 1000;
    const SAUCER_SPAWN_MIN = 15000;
    const SAUCER_SPAWN_MAX = 45000;

    function randRange(min, max) { return Math.random() * (max - min) + min; }
    function wrapX(x) { return (x + w) % w; }
    function wrapY(y) { return (y + h) % h; }
    function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    // -------------------------
    // Particles for visual pops
    // -------------------------
    class Particle {
      constructor(x, y) {
        this.x = x; this.y = y;
        this.vx = randRange(-1.5, 1.5);
        this.vy = randRange(-1.5, 1.5);
        this.life = Math.floor(randRange(20, 40));
        this.size = randRange(1, 3);
      }
      update() { this.x += this.vx; this.y += this.vy; this.life--; }
      draw() {
        ctx.globalAlpha = Math.max(0, this.life / 40);
        ctx.fillStyle = "rgba(255,210,100,1)";
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
      }
    }

    // -------------------------
    // Entities: Ship, Bullet, Asteroid, Saucer, SaucerBullet
    // -------------------------
    class Ship {
      constructor() {
        this.x = w / 2;
        this.y = h / 2;
        this.a = -Math.PI / 2;
        this.r = SHIP_R;
        this.rot = 0;
        this.vx = 0; this.vy = 0;
        this.thrusting = false;
        this.lives = 3;
        this.invuln = 0; // keep timing for gameplay but we won't draw a ring
      }
      update() {
        this.a += this.rot;
        if (this.thrusting) {
          this.vx += 0.08 * Math.cos(this.a);
          this.vy += 0.08 * Math.sin(this.a);
          startThrust();
        } else stopThrust();
        this.vx *= 0.995; this.vy *= 0.995;
        this.x += this.vx; this.y += this.vy;
        this.x = wrapX(this.x); this.y = wrapY(this.y);
        if (this.invuln > 0) this.invuln--;
      }
      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.a);
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(60,160,255,0.5)";
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.r, 0);
        ctx.lineTo(-this.r * 0.6, -this.r * 0.6);
        ctx.lineTo(-this.r * 0.6, this.r * 0.6);
        ctx.closePath();
        ctx.stroke();
        if (this.thrusting) {
          ctx.fillStyle = "orange";
          ctx.beginPath();
          ctx.moveTo(-this.r * 0.65, -this.r * 0.25);
          ctx.lineTo(-this.r - 6, 0);
          ctx.lineTo(-this.r * 0.65, this.r * 0.25);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
        // NOTE: invuln exists for collision timing but we do NOT draw any shield ring
      }
    }

    class Bullet {
      constructor(x, y, a) {
        this.x = x; this.y = y;
        this.dx = BULLET_SPEED * Math.cos(a);
        this.dy = BULLET_SPEED * Math.sin(a);
        this.dist = 0;
        this.maxDist = Math.max(w, h) * BULLET_MAX_SCREEN_TRAVEL;
      }
      update() {
        this.x = wrapX(this.x + this.dx);
        this.y = wrapY(this.y + this.dy);
        this.dist += Math.hypot(this.dx, this.dy);
      }
      get alive() { return this.dist < this.maxDist; }
      draw() { ctx.fillStyle = "white"; ctx.fillRect(this.x - 1.2, this.y - 1.2, 2.4, 2.4); }
    }

    class Asteroid {
      constructor(x, y, r) {
        this.x = x; this.y = y; this.r = r;
        const ang = Math.random() * Math.PI * 2;
        const spd = Math.random() * 1.6 + 0.2;
        this.dx = Math.cos(ang) * spd;
        this.dy = Math.sin(ang) * spd;
        this.noise = Math.random() * 1000;
      }
      update() { this.x = wrapX(this.x + this.dx); this.y = wrapY(this.y + this.dy); }
      draw() {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          const variance = Math.sin(this.noise + theta * 4) * 0.3 + (Math.random() - 0.5) * 0.2;
          const rad = this.r * (1 + variance * 0.15);
          const px = this.x + rad * Math.cos(theta);
          const py = this.y + rad * Math.sin(theta);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(255,255,255,0.03)";
        ctx.stroke();
        ctx.restore();
      }
    }

    class Saucer {
      constructor() {
        this.side = Math.random() < 0.5 ? -1 : 1;
        this.x = this.side < 0 ? -60 : w + 60;
        this.y = randRange(40, h - 40);
        this.speed = this.side < 0 ? randRange(1.2, 2.0) : -randRange(1.2, 2.0);
        this.r = 18;
        this.fireTimer = randRange(600, 1400);
        this.alive = true;
      }
      update(dt) {
        this.x += this.speed * (dt / (1000 / FRAME_RATE));
        if (this.side < 0 && this.x > w + 80) this.alive = false;
        if (this.side > 0 && this.x < -80) this.alive = false;

        // ensure sound stops if it leaves
        if (!this.alive) stopActiveSaucerSound();

        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = randRange(600, 1400);
          if (ship) {
            const dx = ship.x - this.x, dy = ship.y - this.y;
            const base = Math.atan2(dy, dx);
            const inacc = randRange(-0.25, 0.25);
            saucerBullets.push(new SaucerBullet(this.x, this.y, base + inacc));
            // play short saucer shot; stop previous instance first
            stopActiveSaucerSound();
            if (buffers.saucer) activeSaucerSound = playBuffer("saucer", V.saucerGain, false);
          }
        }
      }
      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = "rgba(200,200,255,0.08)";
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.r + 8, this.r + 3.5, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, -4, this.r - 2, this.r / 2.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    class SaucerBullet {
      constructor(x, y, a) {
        this.x = x; this.y = y;
        this.dx = 5.5 * Math.cos(a);
        this.dy = 5.5 * Math.sin(a);
        this.dist = 0;
        this.maxDist = Math.max(w, h) * BULLET_MAX_SCREEN_TRAVEL;
      }
      update() { this.x = wrapX(this.x + this.dx); this.y = wrapY(this.y + this.dy); this.dist += Math.hypot(this.dx, this.dy); }
      get alive() { return this.dist < this.maxDist; }
      draw() { ctx.fillStyle = "rgba(255,100,100,1)"; ctx.fillRect(this.x - 1.5, this.y - 1.5, 3, 3); }
    }

    // -------------------------
    // Game state
    // -------------------------
    let ship = new Ship();
    let bullets = [];
    let asteroids = [];
    let particles = [];
    let saucers = [];
    let saucerBullets = [];
    let score = 0;
    let started = false;
    let gameOver = false;
    let lastTime = performance.now();
    let saucerNextSpawn = performance.now() + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);

    // initial asteroids
    function resetAsteroids() {
      asteroids = [];
      const initial = 5;
      for (let i = 0; i < initial; i++) {
        asteroids.push(new Asteroid(randRange(0, w), randRange(0, h), randRange(26, 44)));
      }
    }
    resetAsteroids();

    // -------------------------
    // Controls (touch + keyboard fallback)
    // -------------------------
    const thrustBtn = document.getElementById("thrust");
    const fireBtn = document.getElementById("fire");
    const leftBtn = document.getElementById("left");
    const rightBtn = document.getElementById("right");

    // Keyboard fallback
    if (!thrustBtn || !fireBtn || !leftBtn || !rightBtn) {
      console.warn("Touch buttons missing; keyboard enabled (arrow keys, space, Z).");
      window.addEventListener("keydown", e => {
        if (e.key === "ArrowLeft") ship.rot = -0.08;
        if (e.key === "ArrowRight") ship.rot = 0.08;
        if (e.key === " ") { ship.thrusting = true; audioCtx.resume(); }
        if (e.key.toLowerCase() === "z") shoot();
      });
      window.addEventListener("keyup", e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") ship.rot = 0;
        if (e.key === " ") ship.thrusting = false;
      });
    } else {
      // touch handlers
      thrustBtn.addEventListener("touchstart", e => { e.preventDefault(); ship.thrusting = true; audioCtx.resume(); }, { passive: false });
      thrustBtn.addEventListener("touchend", e => { e.preventDefault(); ship.thrusting = false; }, { passive: false });

      let firingInterval = null;
      function startAutoFire() {
        if (firingInterval) return;
        shoot();
        firingInterval = setInterval(shoot, 200);
      }
      function stopAutoFire() { clearInterval(firingInterval); firingInterval = null; }

      fireBtn.addEventListener("touchstart", e => { e.preventDefault(); startAutoFire(); }, { passive: false });
      fireBtn.addEventListener("touchend", e => { e.preventDefault(); stopAutoFire(); }, { passive: false });

      leftBtn.addEventListener("touchstart", e => { e.preventDefault(); ship.rot = -0.08; }, { passive: false });
      leftBtn.addEventListener("touchend", e => { e.preventDefault(); ship.rot = 0; }, { passive: false });

      rightBtn.addEventListener("touchstart", e => { e.preventDefault(); ship.rot = 0.08; }, { passive: false });
      rightBtn.addEventListener("touchend", e => { e.preventDefault(); ship.rot = 0; }, { passive: false });
    }

    // -------------------------
    // Shooting & explosion helpers
    // -------------------------
    function shoot() {
      if (!started || gameOver) return;
      const bx = ship.x + Math.cos(ship.a) * ship.r;
      const by = ship.y + Math.sin(ship.a) * ship.r;
      bullets.push(new Bullet(bx, by, ship.a));
      if (buffers.fire) playBuffer("fire", V.fireGain, false);
    }

    function explodeAt(x, y, amount = 10) {
      for (let i = 0; i < amount; i++) particles.push(new Particle(x, y));
      if (buffers.explode) playBuffer("explode", V.explodeGain, false);
    }

    function maybeSpawnSaucer(now) {
      if (now >= saucerNextSpawn) {
        saucers.push(new Saucer());
        saucerNextSpawn = now + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      }
    }

    // -------------------------
    // Main loop
    // -------------------------
    function loop(now) {
      const dt = now - lastTime;
      lastTime = now;

      // background subtle clear
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);

      // Tap-to-start overlay
      if (!started) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "white";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("ASTEROIDS — TAP TO START", w / 2, h / 2 - 10);
        ctx.font = "14px monospace";
        ctx.fillText("Tap screen or use on-screen controls", w / 2, h / 2 + 18);
        requestAnimationFrame(loop);
        return;
      }

      // Updates
      ship.update();
      bullets.forEach(b => b.update());
      bullets = bullets.filter(b => b.alive);
      asteroids.forEach(a => a.update());
      saucers.forEach(s => s.update(dt));
      saucerBullets.forEach(sb => sb.update());
      saucerBullets = saucerBullets.filter(sb => sb.alive);

      // Collisions: bullets -> asteroids & saucers
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        let removed = false;
        // asteroids
        for (let j = asteroids.length - 1; j >= 0; j--) {
          const a = asteroids[j];
          if (dist(b.x, b.y, a.x, a.y) < a.r) {
            explodeAt(a.x, a.y, 10);
            score += 100;
            bullets.splice(i, 1);
            asteroids.splice(j, 1);
            if (a.r > 20) {
              asteroids.push(new Asteroid(a.x + 4, a.y + 4, a.r / 2));
              asteroids.push(new Asteroid(a.x - 4, a.y - 4, a.r / 2));
            }
            removed = true;
            break;
          }
        }
        if (removed) continue;
        // saucers
        for (let s = saucers.length - 1; s >= 0; s--) {
          if (dist(b.x, b.y, saucers[s].x, saucers[s].y) < saucers[s].r) {
            explodeAt(saucers[s].x, saucers[s].y, 16);
            score += SAUCER_SCORE;
            bullets.splice(i, 1);
            // stop saucer sound
            stopActiveSaucerSound();
            saucers.splice(s, 1);
            if (buffers.explode) playBuffer("explode", V.explodeGain, false);
            removed = true;
            break;
          }
        }
      }

      // Saucer bullets -> ship (ship.invuln still exists but no shield shown)
      if (ship.invuln <= 0) {
        for (let i = saucerBullets.length - 1; i >= 0; i--) {
          const sb = saucerBullets[i];
          if (dist(sb.x, sb.y, ship.x, ship.y) < ship.r) {
            explodeAt(ship.x, ship.y, 16);
            ship.lives--;
            ship.x = w / 2; ship.y = h / 2; ship.vx = 0; ship.vy = 0;
            ship.invuln = 90; // kept for gameplay fairness
            saucerBullets.splice(i, 1);
            if (ship.lives <= 0) gameOver = true;
            break;
          }
        }
      }

      // Ship <-> asteroids
      if (ship.invuln <= 0) {
        for (let i = asteroids.length - 1; i >= 0; i--) {
          if (dist(ship.x, ship.y, asteroids[i].x, asteroids[i].y) < ship.r + asteroids[i].r) {
            explodeAt(ship.x, ship.y, 20);
            ship.lives--;
            ship.x = w / 2; ship.y = h / 2; ship.vx = 0; ship.vy = 0;
            ship.invuln = 90;
            if (buffers.explode) playBuffer("explode", V.explodeGain, false);
            if (ship.lives <= 0) gameOver = true;
            break;
          }
        }
      }

      // Remove expired saucers (their .update stops sound when leaving)
      saucers = saucers.filter(s => s.alive);

      // Spawn saucer occasionally
      maybeSpawnSaucer(performance.now());

      // Update particles and remove dead
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].life <= 0) particles.splice(i, 1);
      }

      // DRAW ORDER
      asteroids.forEach(a => a.draw());
      saucers.forEach(s => s.draw());
      ship.draw();
      bullets.forEach(b => b.draw());
      saucerBullets.forEach(sb => sb.draw());
      particles.forEach(p => p.draw());

      // UI
      ctx.fillStyle = "white";
      ctx.font = "16px monospace";
      ctx.textAlign = "left";
      ctx.fillText("Score: " + score, 12, 22);
      ctx.fillText("Lives: " + ship.lives, 12, 44);

      // If all asteroids cleared, spawn a fresh wave after a short delay
      if (asteroids.length === 0) {
        setTimeout(() => {
          if (asteroids.length === 0) resetAsteroids();
        }, 600);
      }

      // Game over overlay handling
      if (gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "red";
        ctx.font = "40px monospace";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", w / 2, h / 2 - 10);
        ctx.fillStyle = "white";
        ctx.font = "18px monospace";
        ctx.fillText("TAP TO RESTART", w / 2, h / 2 + 26);
        // stop thrust sound
        ship.thrusting = false;
        stopThrust();
      }

      requestAnimationFrame(loop);
    } // end loop

    requestAnimationFrame(loop);

    // -------------------------
    // Tap-to-start / restart
    // -------------------------
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      audioCtx.resume().catch(() => {});
      if (!started) {
        started = true;
        gameOver = false;
        score = 0;
        ship = new Ship();
        bullets = [];
        asteroids = [];
        saucers = [];
        saucerBullets = [];
        particles = [];
        resetAsteroids();
        saucerNextSpawn = performance.now() + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      } else if (gameOver) {
        gameOver = false;
        started = true;
        score = 0;
        ship = new Ship();
        bullets = [];
        asteroids = [];
        saucers = [];
        saucerBullets = [];
        particles = [];
        resetAsteroids();
        saucerNextSpawn = performance.now() + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      }
    }, { passive: false });

    // Debug helper
    window.spawnSaucerNow = function() { saucers.push(new Saucer()); };

    // End init
  })(); // end async init
}; // end onload
