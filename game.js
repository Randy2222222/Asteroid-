// game.js
// Restored full-featured Asteroids build (stable ~530-line equivalent)
// - Tap-to-Start / Tap-to-Restart
// - Fullscreen responsive canvas (DPR-aware)
// - Modernized visuals + particle pops
// - Bullets wrap once then expire (classic behavior)
// - AudioBuffer-based SFX with correct gains (thrust/fire/explode/saucer)
// - Flying saucer framework (random spawn + firing), with sound stop fixes
// - Thorough inline comments for easy tweaking

window.onload = () => {
  (async function init() {
    // -------------------------
    // Canvas & rendering setup
    // -------------------------
    const canvas = document.getElementById("game");
    if (!canvas) {
      console.error("Canvas element with id='game' not found.");
      return;
    }
    const ctx = canvas.getContext("2d");

    // Logical CSS width/height
    let w = window.innerWidth;
    let h = window.innerHeight;

    // Resize canvas to fill screen and support high-DPI (Retina).
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      // Make canvas CSS size fill viewport
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      // Set actual pixel buffer size for crispness on high-DPI
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      // Scale the drawing so 1 unit = 1 CSS pixel
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = cssW;
      h = cssH;
    }
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", resizeCanvas);
    resizeCanvas();

    // Prevent two-finger gestures that can cause zoom
    document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

    // -------------------------
    // Audio setup (AudioContext + AudioBuffers)
    // -------------------------
    // We use buffers for reliable low-latency playback and for restart-safe behavior.
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Filenames — place these in same folder as game.js
    const soundFiles = {
      thrust: "thrust.mp3",
      fire: "fire.mp3",
      explode: "explode.mp3",
      saucer: "saucer.mp3" // upload this when ready
    };

    // Volume defaults (easy to tweak here)
    const V = {
      thrustGain: 2.0,   // loud thrust
      fireGain: 0.1,     // quiet fire
      explodeGain: 2.0,  // reduced explosion
      saucerGain: 1.0    // saucer shot placeholder
    };

    // load buffers with decode
    const buffers = {};
    async function loadBuffer(url) {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        return await audioCtx.decodeAudioData(ab);
      } catch (err) {
        console.warn("Failed to load", url, err);
        return null;
      }
    }

    // pre-load all buffers (we await so we can show splash until ready)
    for (let key of Object.keys(soundFiles)) {
      buffers[key] = await loadBuffer(soundFiles[key]);
    }

    // Helper to play a named buffer (returns {src, gain})
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

    // Track any active saucer sound (so it can be stopped on destroy or offscreen)
    let activeSaucerSound = null;

    // Thrust special handling: ramp in/out, restart-safe.
    // We'll create a looping buffer source when thrust starts and stop when it ends.
    let activeThrust = { src: null, gain: null };
    function startThrust() {
      if (!buffers.thrust) return;
      if (activeThrust.src) return; // already playing
      const node = playBuffer("thrust", 0, true); // start silent loop
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
      const srcToStop = activeThrust.src;
      // stop after ramp completes (allow time for ramp)
      setTimeout(() => { try { srcToStop.stop(); } catch (e) {} }, 300);
      activeThrust.src = null;
      activeThrust.gain = null;
    }

    // -------------------------
    // Game constants & helpers
    // -------------------------
    const FRAME_RATE = 60;
    const SHIP_RADIUS = 15;
    const BULLET_SPEED = 6;
    const BULLET_SCREEN_TRAVEL = 1.5; // times screen dimension
    const SAUCER_SCORE = 1000;
    const SAUCER_SPAWN_MIN = 15000; // ms
    const SAUCER_SPAWN_MAX = 45000; // ms

    function randRange(min, max) { return Math.random() * (max - min) + min; }
    function wrapX(x) { return (x + w) % w; }
    function wrapY(y) { return (y + h) % h; }
    function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    // -------------------------
    // Visual particle for explosions
    // -------------------------
    class Particle {
      constructor(x, y) {
        this.x = x; this.y = y;
        this.vx = randRange(-1.6, 1.6);
        this.vy = randRange(-1.6, 1.6);
        this.life = Math.floor(randRange(18, 42));
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
    // Entities (Ship, Bullet, Asteroid, Saucer, SaucerBullet)
    // -------------------------
    class Ship {
      constructor() {
        this.x = w / 2;
        this.y = h / 2;
        this.a = -Math.PI / 2; // facing up by default
        this.r = SHIP_RADIUS;
        this.rot = 0;
        this.vx = 0; this.vy = 0;
        this.thrusting = false;
        this.lives = 3;
        this.invuln = 0;
      }
      update() {
        this.a += this.rot;
        if (this.thrusting) {
          this.vx += 0.08 * Math.cos(this.a);
          this.vy += 0.08 * Math.sin(this.a);
          startThrust();
        } else {
          stopThrust();
        }
        this.vx *= 0.995; this.vy *= 0.995;
        this.x += this.vx; this.y += this.vy;
        this.x = wrapX(this.x); this.y = wrapY(this.y);
        if (this.invuln > 0) this.invuln--;
      }
      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.a);
        // glow/stroke
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
        // thrust flame
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
        // invulnerability ring
        if (this.invuln > 0) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.arc(this.x, this.y, this.r + 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    class Bullet {
      constructor(x, y, a) {
        this.x = x; this.y = y;
        this.dx = BULLET_SPEED * Math.cos(a);
        this.dy = BULLET_SPEED * Math.sin(a);
        this.dist = 0;
        this.maxDist = Math.max(w, h) * BULLET_SCREEN_TRAVEL;
      }
      update() {
        this.x = wrapX(this.x + this.dx);
        this.y = wrapY(this.y + this.dy);
        this.dist += Math.hypot(this.dx, this.dy);
      }
      get alive() { return this.dist < this.maxDist; }
      draw() { ctx.fillStyle = "white"; ctx.fillRect(this.x - 1.3, this.y - 1.3, 2.6, 2.6); }
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

    // Saucer: moves horizontally across screen and fires at player
    class Saucer {
      constructor() {
        this.side = Math.random() < 0.5 ? -1 : 1;
        this.x = this.side < 0 ? -60 : w + 60;
        this.y = randRange(40, h - 40);
        this.speed = this.side < 0 ? randRange(1.2, 2.0) : -randRange(1.2, 2.0);
        this.r = 18;
        this.fireTimer = randRange(600, 1400); // ms until next shot
        this.alive = true;
      }
      update(dt) {
        // dt = ms elapsed; scale so speed feels consistent
        this.x += this.speed * (dt / (1000 / FRAME_RATE));
        // check leave-screen conditions
        if (this.side < 0 && this.x > w + 80) this.alive = false;
        if (this.side > 0 && this.x < -80) this.alive = false;
        // If saucer left screen, ensure its sound stops
        if (!this.alive && activeSaucerSound) {
          try { activeSaucerSound.src.stop(); } catch (e) {}
          activeSaucerSound = null;
        }

        // firing logic: fire toward player with slight inaccuracy
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = randRange(600, 1400);
          if (ship) {
            const dx = ship.x - this.x, dy = ship.y - this.y;
            const base = Math.atan2(dy, dx);
            const inacc = randRange(-0.25, 0.25);
            saucerBullets.push(new SaucerBullet(this.x, this.y, base + inacc));

            // Play a short saucer shot sound (ensure not to pile up)
            // Stop any previous saucer-shot instance reference, then play new buffer and keep reference.
            if (activeSaucerSound) {
              try { activeSaucerSound.src.stop(); } catch (e) {}
              activeSaucerSound = null;
            }
            if (buffers.saucer) {
              activeSaucerSound = playBuffer("saucer", V.saucerGain, false);
            }
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
        this.maxDist = Math.max(w, h) * BULLET_SCREEN_TRAVEL;
      }
      update() { this.x = wrapX(this.x + this.dx); this.y = wrapY(this.y + this.dy); this.dist += Math.hypot(this.dx, this.dy); }
      get alive() { return this.dist < this.maxDist; }
      draw() { ctx.fillStyle = "rgba(255,100,100,1)"; ctx.fillRect(this.x - 1.5, this.y - 1.5, 3, 3); }
    }

    // -------------------------
    // Game state initialization
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

    function resetAsteroids() {
      asteroids = [];
      for (let i = 0; i < 5; i++) asteroids.push(new Asteroid(randRange(0, w), randRange(0, h), randRange(26, 44)));
    }
    resetAsteroids();

    // -------------------------
    // Controls: touch buttons + keyboard fallback
    // -------------------------
    const thrustBtn = document.getElementById("thrust");
    const fireBtn = document.getElementById("fire");
    const leftBtn = document.getElementById("left");
    const rightBtn = document.getElementById("right");

    if (!thrustBtn || !fireBtn || !leftBtn || !rightBtn) {
      console.warn("Touch buttons not found — keyboard fallback enabled.");
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
    // Main game loop
    // -------------------------
    function loop(now) {
      const dt = now - lastTime;
      lastTime = now;

      // draw background
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);

      // Splash / Tap-to-start overlay
      if (!started) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "white";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("ASTEROIDS — TAP TO START", w / 2, h / 2 - 12);
        ctx.font = "14px monospace";
        ctx.fillText("Tap the screen or use the on-screen controls to begin", w / 2, h / 2 + 14);
        requestAnimationFrame(loop);
        return;
      }

      // updates
      ship.update();
      for (let b of bullets) b.update();
      bullets = bullets.filter(b => b.alive);
      for (let a of asteroids) a.update();
      for (let s of saucers) s.update(dt);
      for (let sb of saucerBullets) sb.update();
      saucerBullets = saucerBullets.filter(sb => sb.alive);

      // collisions: bullets -> asteroids & saucers
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
            // stop saucer sound if playing
            if (activeSaucerSound) { try { activeSaucerSound.src.stop(); } catch (e) {} activeSaucerSound = null; }
            saucers.splice(s, 1);
            if (buffers.explode) playBuffer("explode", V.explodeGain, false);
            removed = true;
            break;
          }
        }
      }

      // saucer bullets -> ship
      if (ship.invuln <= 0) {
        for (let i = saucerBullets.length - 1; i >= 0; i--) {
          const sb = saucerBullets[i];
          if (dist(sb.x, sb.y, ship.x, ship.y) < ship.r) {
            explodeAt(ship.x, ship.y, 16);
            ship.lives--;
            ship.x = w / 2; ship.y = h / 2; ship.vx = 0; ship.vy = 0;
            ship.invuln = 90;
            saucerBullets.splice(i, 1);
            if (ship.lives <= 0) gameOver = true;
            break;
          }
        }
      }

      // ship <-> asteroids
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

      // remove expired saucers (they already stop sound on leaving in update())
      saucers = saucers.filter(s => s.alive);

      // spawn saucer occasionally
      maybeSpawnSaucer(performance.now());

      // update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].life <= 0) particles.splice(i, 1);
      }

      // DRAW: asteroids, saucers, ship, bullets, saucer bullets, particles, UI
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

      // Game over overlay
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
        // ensure thrust stops
        ship.thrusting = false;
        stopThrust();
      }

      requestAnimationFrame(loop);
    } // end loop

    requestAnimationFrame(loop);

    // -------------------------
    // Tap-to-start / Tap-to-restart
    // -------------------------
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      // resume audio context on first user interaction
      audioCtx.resume().catch(() => { /* ignore */ });

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

    // -------------------------
    // Debug helper to spawn saucer manually (call from console)
    // -------------------------
    window.spawnSaucerNow = function() {
      saucers.push(new Saucer());
    };

    // End init
  })(); // end async init
}; // end onload
