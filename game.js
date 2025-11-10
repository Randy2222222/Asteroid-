// game.js
// Final polished Asteroids-style game with modern visuals, Tap-to-Start,
// fullscreen scaling, sound buffers, saucer enemy, and inline comments.

window.onload = () => {
  // Wrap everything in an async init so we can await sound loading cleanly
  (async function init() {
    // --------------------------
    // Canvas & rendering setup
    // --------------------------
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");

    // Resize canvas to fill screen and support high-DPI (Retina) displays.
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing back to CSS pixels
      w = cssW;
      h = cssH;
    }
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", resizeCanvas);
    resizeCanvas();

    // Touch / gesture mitigation for iOS
    document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    window.addEventListener('touchmove', e => { /* leave passive default - canvas uses buttons */ }, { passive: true });

    // --------------------------
    // Audio setup (AudioContext + buffers)
    // --------------------------
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // filenames (you can replace these files in your repo)
    // NOTE: 'saucer.mp3' is referenced for the flying saucer; upload it later.
    const soundFiles = {
      thrust: "thrust.mp3",
      fire: "fire.mp3",
      explode: "explode.mp3",
      saucer: "saucer.mp3"
    };

    // volume defaults (easy to tweak)
    const V = {
      thrustGain: 2.0,   // loud
      fireGain: 0.1,     // quiet
      explodeGain: 2.0,  // strong but not overpowering
      saucerGain: 1.0    // placeholder
    };

    // Load audio files into buffers (low-latency playback)
    const buffers = {};
    async function loadBuffer(url) {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      return await audioCtx.decodeAudioData(arrayBuffer);
    }

    // Try to load all sounds. If one fails, we continue but warn.
    const bufferKeys = Object.keys(soundFiles);
    for (let k of bufferKeys) {
      try {
        buffers[k] = await loadBuffer(soundFiles[k]);
      } catch (err) {
        console.warn("Failed to load sound:", soundFiles[k], err);
        buffers[k] = null;
      }
    }

    // Helper to play a buffer with a gain and optional loop
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

    // Thrust handling: we'll create a reusable gain node and create/start/stop sources as needed
    // so repeated restarts won't leak nodes.
    let activeThrust = { src: null, gain: null }; // current thrust source & gain (if any)

    function startThrust() {
      if (!buffers.thrust) return;
      // create a new buffer source and gain; loop it
      if (activeThrust.src) return; // already playing
      const n = playBuffer("thrust", 0, true); // start silent, ramp up
      if (!n) return;
      activeThrust.src = n.src;
      activeThrust.gain = n.gain;
      // ramp up to configured thrustGain over 0.1s
      activeThrust.gain.gain.setValueAtTime(0, audioCtx.currentTime);
      activeThrust.gain.gain.linearRampToValueAtTime(V.thrustGain, audioCtx.currentTime + 0.1);
    }

    function stopThrust() {
      if (!activeThrust.src) return;
      // ramp down then stop after 0.25s to avoid clicks
      const t = audioCtx.currentTime;
      activeThrust.gain.gain.cancelScheduledValues(t);
      activeThrust.gain.gain.setValueAtTime(activeThrust.gain.gain.value, t);
      activeThrust.gain.gain.linearRampToValueAtTime(0, t + 0.25);
      // stop the source after a tiny timeout so ramp finishes
      const srcToStop = activeThrust.src;
      setTimeout(() => {
        try { srcToStop.stop(); } catch (e) {}
      }, 300);
      activeThrust.src = null;
      activeThrust.gain = null;
    }

    // --------------------------
    // Game constants
    // --------------------------
    let w = window.innerWidth;
    let h = window.innerHeight;

    const FRAME_RATE = 60;
    const SHIP_RADIUS = 15;
    const BULLET_SPEED = 6;
    const BULLET_MAX_SCREEN_TRAVEL = 1.5; // times the screen dimension
    const SAUCER_SCORE = 1000; // points for saucer
    const SAUCER_SPAWN_MIN = 15 * 1000; // 15s
    const SAUCER_SPAWN_MAX = 45 * 1000; // 45s

    // --------------------------
    // Utility helpers
    // --------------------------
    function randRange(min, max) { return Math.random() * (max - min) + min; }
    function wrapX(x) { return (x + w) % w; }
    function wrapY(y) { return (y + h) % h; }
    function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    // --------------------------
    // Visual particle (simple) for small explosion pop
    // --------------------------
    class TinyParticle {
      constructor(x, y) {
        this.x = x; this.y = y;
        this.life = randRange(20, 40);
        this.vx = randRange(-1.5, 1.5);
        this.vy = randRange(-1.5, 1.5);
        this.size = randRange(1, 3);
        this.color = "rgba(255,210,100,1)";
      }
      update() {
        this.x += this.vx; this.y += this.vy;
        this.life--;
      }
      draw() {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / 40);
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
      }
    }

    // --------------------------
    // Game entities
    // --------------------------
    class Ship {
      constructor() {
        this.x = w / 2;
        this.y = h / 2;
        this.a = -Math.PI / 2; // facing up
        this.r = SHIP_RADIUS;
        this.rot = 0;
        this.thrusting = false;
        this.vx = 0;
        this.vy = 0;
        this.lives = 3;
        this.invulnerable = 0; // frames after respawn
      }
      update() {
        // rotation
        this.a += this.rot;

        // thrust physics
        if (this.thrusting) {
          // smoother acceleration than simple jump
          this.vx += 0.08 * Math.cos(this.a);
          this.vy += 0.08 * Math.sin(this.a);
          startThrust();
        } else {
          stopThrust();
        }

        // friction and integration
        this.vx *= 0.995;
        this.vy *= 0.995;
        this.x += this.vx;
        this.y += this.vy;

        // wrap
        this.x = wrapX(this.x);
        this.y = wrapY(this.y);

        // invulnerability countdown
        if (this.invulnerable > 0) this.invulnerable--;
      }
      draw() {
        // modernized ship: stroke + slight glow
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.a);
        // glow
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(60,160,255,0.6)";
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.r, 0);
        ctx.lineTo(-this.r * 0.6, -this.r * 0.6);
        ctx.lineTo(-this.r * 0.6, this.r * 0.6);
        ctx.closePath();
        ctx.stroke();

        // engine flame if thrusting
        if (this.thrusting) {
          ctx.fillStyle = "orange";
          ctx.beginPath();
          ctx.moveTo(-this.r * 0.65, -this.r * 0.25);
          ctx.lineTo(-this.r - 6, 0);
          ctx.lineTo(-this.r * 0.65, this.r * 0.25);
          ctx.fill();
        }

        // reset glow
        ctx.shadowBlur = 0;
        ctx.restore();

        // draw small invulnerability ring if active
        if (this.invulnerable > 0) {
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
        this.x = x;
        this.y = y;
        this.dx = BULLET_SPEED * Math.cos(a);
        this.dy = BULLET_SPEED * Math.sin(a);
        this.dist = 0; // distance traveled in pixels
        this.maxDist = Math.max(w, h) * BULLET_MAX_SCREEN_TRAVEL;
      }
      update() {
        this.x = wrapX(this.x + this.dx);
        this.y = wrapY(this.y + this.dy);
        this.dist += Math.hypot(this.dx, this.dy);
      }
      get alive() { return this.dist < this.maxDist; }
      draw() {
        ctx.fillStyle = "white";
        ctx.fillRect(this.x - 1.2, this.y - 1.2, 2.4, 2.4);
      }
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
      update() {
        this.x = wrapX(this.x + this.dx);
        this.y = wrapY(this.y + this.dy);
      }
      draw() {
        // draw a smoother polygon with per-vertex perturbation
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          const variance = (Math.sin(this.noise + theta * 4) * 0.3 + (Math.random() - 0.5) * 0.2);
          const rad = this.r * (1 + variance * 0.15);
          const px = this.x + rad * Math.cos(theta);
          const py = this.y + rad * Math.sin(theta);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        // subtle shadow for modern look
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(255,255,255,0.03)";
        ctx.stroke();
        ctx.restore();
      }
    }

    // Saucer enemy
    class Saucer {
      constructor() {
        // spawn off-screen left or right
        this.side = Math.random() < 0.5 ? -1 : 1;
        this.x = this.side < 0 ? -40 : w + 40;
        this.y = randRange(40, h - 40);
        this.speed = this.side < 0 ? randRange(1.2, 2.0) : -randRange(1.2, 2.0);
        this.r = 18;
        this.fireTimer = randRange(600, 1200); // ms until next saucer shot
        this.alive = true;
      }
      update(dt) {
        this.x += this.speed * (dt / (1000 / FRAME_RATE));
        // leave when fully off-screen on opposite side
        if (this.side < 0 && this.x > w + 60) this.alive = false;
        if (this.side > 0 && this.x < -60) this.alive = false;

        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = randRange(600, 1400);
          // spawn saucer bullet aimed at ship with slight inaccuracy
          if (ship) {
            const dx = ship.x - this.x;
            const dy = ship.y - this.y;
            const baseAngle = Math.atan2(dy, dx);
            const inaccuracy = randRange(-0.25, 0.25); // radians
            const angle = baseAngle + inaccuracy;
            saucerBullets.push(new SaucerBullet(this.x, this.y, angle));
            // play saucer shot sound if present
            if (buffers.saucer) playBuffer("saucer", V.saucerGain, false);
          }
        }
      }
      draw() {
        // modern saucer silhouette
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = "rgba(200,200,255,0.08)";
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.r + 8, this.r + 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
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
        this.maxDist = Math.max(w, h) * 1.5;
      }
      update() {
        this.x = wrapX(this.x + this.dx);
        this.y = wrapY(this.y + this.dy);
        this.dist += Math.hypot(this.dx, this.dy);
      }
      get alive() { return this.dist < this.maxDist; }
      draw() {
        ctx.fillStyle = "rgba(255,100,100,1)";
        ctx.fillRect(this.x - 1.5, this.y - 1.5, 3, 3);
      }
    }

    // --------------------------
    // Game state
    // --------------------------
    let ship = new Ship();
    let bullets = [];
    let asteroids = [];
    let particles = [];
    let saucers = [];
    let saucerBullets = [];
    let score = 0;
    let started = false;
    let gameOver = false;
    let lastFrameTime = performance.now();
    let saucerNextSpawnAt = performance.now() + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);

    // --------------------------
    // Initialize asteroids
    // --------------------------
    function resetAsteroids() {
      asteroids = [];
      const initial = 5;
      for (let i = 0; i < initial; i++) {
        asteroids.push(new Asteroid(randRange(0, w), randRange(0, h), randRange(26, 44)));
      }
    }
    resetAsteroids();

    // --------------------------
    // Input: touch button hooks (these are your on-screen controls)
    // --------------------------
    // We expect index.html to have controls with IDs: thrust, fire, left, right
    const thrustBtn = document.getElementById("thrust");
    const fireBtn = document.getElementById("fire");
    const leftBtn = document.getElementById("left");
    const rightBtn = document.getElementById("right");

    // Defensive: if these buttons are absent, create keyboard alternatives for debugging
    if (!thrustBtn || !fireBtn || !leftBtn || !rightBtn) {
      console.warn("Touch control elements not found; falling back to keyboard controls for testing.");
      window.addEventListener("keydown", e => {
        if (e.key === "ArrowLeft") ship.rot = -0.08;
        if (e.key === "ArrowRight") ship.rot = 0.08;
        if (e.key === " ") ship.thrusting = true;
        if (e.key === "z") shoot();
      });
      window.addEventListener("keyup", e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") ship.rot = 0;
        if (e.key === " ") ship.thrusting = false;
      });
    } else {
      // Make touch handlers non-passive to ensure quick response
      thrustBtn.addEventListener("touchstart", (e) => { e.preventDefault(); ship.thrusting = true; audioCtx.resume(); }, { passive: false });
      thrustBtn.addEventListener("touchend", (e) => { e.preventDefault(); ship.thrusting = false; }, { passive: false });

      let fireInterval = null;
      function startFiring() {
        if (fireInterval) return;
        shoot();
        fireInterval = setInterval(shoot, 200);
      }
      function stopFiring() { clearInterval(fireInterval); fireInterval = null; }

      fireBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startFiring(); }, { passive: false });
      fireBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopFiring(); }, { passive: false });

      leftBtn.addEventListener("touchstart", (e) => { e.preventDefault(); ship.rot = -0.08; }, { passive: false });
      leftBtn.addEventListener("touchend", (e) => { e.preventDefault(); ship.rot = 0; }, { passive: false });

      rightBtn.addEventListener("touchstart", (e) => { e.preventDefault(); ship.rot = 0.08; }, { passive: false });
      rightBtn.addEventListener("touchend", (e) => { e.preventDefault(); ship.rot = 0; }, { passive: false });
    }

    // --------------------------
    // Shooting logic (fire a bullet)
    // --------------------------
    function shoot() {
      if (!started || gameOver) return;
      // create bullet and play quiet fire sound
      bullets.push(new Bullet(ship.x + Math.cos(ship.a) * ship.r, ship.y + Math.sin(ship.a) * ship.r, ship.a));
      // Play fire buffer with configured gain
      if (buffers.fire) {
        const p = playBuffer("fire", V.fireGain, false);
        // stop after short time if buffer long — but buffer playback is short for SFX
        if (p && p.src && p.src.stop) {
          // nothing needed; buffer will stop on its own
        }
      }
    }

    // --------------------------
    // Explosion: spawn particles + play buffer
    // --------------------------
    function explodeAt(x, y, amount = 8) {
      for (let i = 0; i < amount; i++) particles.push(new TinyParticle(x, y));
      if (buffers.explode) {
        playBuffer("explode", V.explodeGain, false);
      }
    }

    // --------------------------
    // Saucer spawning & handling
    // --------------------------
    function maybeSpawnSaucer(now) {
      if (now >= saucerNextSpawnAt) {
        saucers.push(new Saucer());
        saucerNextSpawnAt = now + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      }
    }

    // --------------------------
    // Main animation loop
    // --------------------------
    function frame(now) {
      const dt = now - (lastFrameTime || now);
      lastFrameTime = now;

      // Update sizes (in case something changed quickly)
      // (resizeCanvas is called on resize/orientation events; we keep w/h reliable.)
      // Clear frame
      ctx.clearRect(0, 0, w, h);

      // If game not started, show splash and wait for first touch
      if (!started) {
        // draw background title
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "white";
        ctx.font = "bold 36px monospace";
        ctx.textAlign = "center";
        ctx.fillText("ASTEROIDS — TAP TO START", w / 2, h / 2 - 20);
        ctx.font = "16px monospace";
        ctx.fillText("Modernized by ChatGPT — tap the screen or controls to begin", w / 2, h / 2 + 16);

        requestAnimationFrame(frame);
        return;
      }

      // Update entities
      ship.update();

      bullets.forEach(b => b.update());
      bullets = bullets.filter(b => b.alive); // bullets vanish after traveling one screen-length

      asteroids.forEach(a => a.update());
      saucers.forEach(s => s.update(dt));
      saucerBullets.forEach(b => b.update());
      saucerBullets = saucerBullets.filter(b => b.alive);

      // Collisions: bullets -> asteroids
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        let hit = false;
        for (let j = asteroids.length - 1; j >= 0; j--) {
          const a = asteroids[j];
          if (dist(b.x, b.y, a.x, a.y) < a.r) {
            // hit: explode, score, split asteroid
            explodeAt(a.x, a.y, 10);
            score += 100;
            bullets.splice(i, 1);
            asteroids.splice(j, 1);
            if (a.r > 20) {
              asteroids.push(new Asteroid(a.x + 4, a.y + 4, a.r / 2));
              asteroids.push(new Asteroid(a.x - 4, a.y - 4, a.r / 2));
            }
            hit = true;
            break;
          }
        }
        if (hit) continue;
        // bullets can also hit saucer
        for (let s = saucers.length - 1; s >= 0; s--) {
          const sau = saucers[s];
          if (dist(b.x, b.y, sau.x, sau.y) < sau.r) {
            explodeAt(sau.x, sau.y, 18);
            score += SAUCER_SCORE;
            bullets.splice(i, 1);
            saucers.splice(s, 1);
            // play saucer explosion (reuse explode buffer)
            if (buffers.explode) playBuffer("explode", V.explodeGain, false);
            break;
          }
        }
      }

      // Collisions: saucer bullets -> ship
      if (ship.invulnerable <= 0) {
        for (let i = saucerBullets.length - 1; i >= 0; i--) {
          if (dist(saucerBullets[i].x, saucerBullets[i].y, ship.x, ship.y) < ship.r) {
            // ship hit
            explodeAt(ship.x, ship.y, 16);
            ship.lives--;
            ship.x = w / 2; ship.y = h / 2; ship.vx = 0; ship.vy = 0;
            ship.invulnerable = 90; // give ~1.5s invulnerability
            saucerBullets.splice(i, 1);
            if (ship.lives <= 0) {
              gameOver = true;
            }
            break;
          }
        }
      }

      // Collisions: ship <-> asteroids
      if (ship.invulnerable <= 0) {
        for (let i = asteroids.length - 1; i >= 0; i--) {
          const a = asteroids[i];
          if (dist(ship.x, ship.y, a.x, a.y) < a.r + ship.r) {
            explodeAt(ship.x, ship.y, 20);
            ship.lives--;
            ship.x = w / 2; ship.y = h / 2; ship.vx = 0; ship.vy = 0;
            ship.invulnerable = 90;
            // play explosion sound
            if (buffers.explode) playBuffer("explode", V.explodeGain, false);
            if (ship.lives <= 0) {
              gameOver = true;
            }
            break;
          }
        }
      }

      // Remove off-screen / expired saucers
      saucers = saucers.filter(s => s.alive);

      // Spawn a saucer occasionally
      maybeSpawnSaucer(performance.now());

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].life <= 0) particles.splice(i, 1);
      }

      // Draw section: background, ship, asteroids, bullets, saucers, UI
      // subtle vignette
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, w, h);

      // draw asteroids
      asteroids.forEach(a => a.draw());

      // draw saucers
      saucers.forEach(s => s.draw());

      // draw ship
      ship.draw();

      // draw bullets
      bullets.forEach(b => b.draw());

      // draw saucer bullets
      saucerBullets.forEach(b => b.draw());

      // draw particles
      particles.forEach(p => p.draw());

      // UI: score & lives
      ctx.fillStyle = "white";
      ctx.font = "18px monospace";
      ctx.textAlign = "left";
      ctx.fillText("Score: " + score, 14, 28);
      ctx.fillText("Lives: " + ship.lives, 14, 52);

      // Game over handling
      if (gameOver) {
        ctx.fillStyle = "red";
        ctx.font = "44px monospace";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", w / 2, h / 2 - 10);
        ctx.font = "20px monospace";
        ctx.fillStyle = "white";
        ctx.fillText("TAP TO RESTART", w / 2, h / 2 + 26);
        // stop thrust if active
        ship.thrusting = false;
        stopThrust();
      }

      // Draw small "tap to restart" text handled above; loop continues
      requestAnimationFrame(frame);
    } // end frame

    requestAnimationFrame(frame);

    // --------------------------
    // Tap-to-start / Tap-to-restart handling
    // --------------------------
    // We need a user interaction to start audio on mobile — resume AudioContext
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (!started) {
        audioCtx.resume();
        started = true;
        gameOver = false;
        resetAsteroids();
        ship = new Ship();
        score = 0;
        saucers = [];
        saucerBullets = [];
        bullets = [];
      } else if (gameOver) {
        // restart after game over
        audioCtx.resume();
        gameOver = false;
        started = true;
        resetAsteroids();
        ship = new Ship();
        bullets = [];
        saucers = [];
        saucerBullets = [];
        particles = [];
        score = 0;
        // schedule next saucer
        saucerNextSpawnAt = performance.now() + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      }
    }, { passive: false });

    // --------------------------
    // Saucer bullet and spawn arrays already declared above
    // --------------------------
    // Helper: spawn saucer bullets array exists; handled above.

    // --------------------------
    // Saucer spawn timer uses performance.now(); implement maybeSpawnSaucer
    // --------------------------
    function maybeSpawnSaucer(now) {
      if (now >= saucerNextSpawnAt) {
        saucers.push(new Saucer());
        saucerNextSpawnAt = now + randRange(SAUCER_SPAWN_MIN, SAUCER_SPAWN_MAX);
      }
    }

    // --------------------------
    // Make sure canvas resizes initially to correct DPR
    // --------------------------
    resizeCanvas();

    // --------------------------
    // End of init
    // --------------------------
  })(); // end async init
}; // end onload
