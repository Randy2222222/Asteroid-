window.onload = function() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let w, h;

  // Resize canvas to fill screen
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  // --- Sound setup ---
  const sndThrust = new Audio("thrust.mp3");
  const sndFire = new Audio("fire.mp3");
  const sndExplode = new Audio("explode.mp3");

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Thrust sound uses fade in/out
  const thrustGain = audioCtx.createGain();
  thrustGain.gain.value = 0;
  const thrustSrc = audioCtx.createMediaElementSource(sndThrust);
  thrustSrc.connect(thrustGain).connect(audioCtx.destination);
  sndThrust.loop = true;

  // Preload sounds
  [sndThrust, sndFire, sndExplode].forEach(s => {
    s.preload = "auto";
    s.load();
  });

  // --- Classes ---
  class Ship {
    constructor() {
      this.x = w / 2;
      this.y = h / 2;
      this.a = 0;
      this.r = 15;
      this.rot = 0;
      this.thrust = { x: 0, y: 0 };
      this.thrusting = false;
      this.lives = 3;
    }
    update() {
      if (this.thrusting) {
        this.thrust.x += 0.1 * Math.cos(this.a);
        this.thrust.y += 0.1 * Math.sin(this.a);
        thrustGain.gain.linearRampToValueAtTime(2.0, audioCtx.currentTime + 0.1);
        if (sndThrust.paused) sndThrust.play();
      } else {
        thrustGain.gain.linearRampToValueAtTime(0.0, audioCtx.currentTime + 0.3);
      }

      this.thrust.x *= 0.99;
      this.thrust.y *= 0.99;
      this.x += this.thrust.x;
      this.y += this.thrust.y;
      this.a += this.rot;
      this.x = (this.x + w) % w;
      this.y = (this.y + h) % h;
    }
    draw() {
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(
        this.x + this.r * Math.cos(this.a),
        this.y + this.r * Math.sin(this.a)
      );
      ctx.lineTo(
        this.x - this.r * (Math.cos(this.a) + Math.sin(this.a)),
        this.y - this.r * (Math.sin(this.a) - Math.cos(this.a))
      );
      ctx.lineTo(
        this.x - this.r * (Math.cos(this.a) - Math.sin(this.a)),
        this.y - this.r * (Math.sin(this.a) + Math.cos(this.a))
      );
      ctx.closePath();
      ctx.stroke();
    }
  }

  class Bullet {
    constructor(x, y, a) {
      this.x = x;
      this.y = y;
      this.dx = 6 * Math.cos(a);
      this.dy = 6 * Math.sin(a);
      this.dist = 0;
      this.maxDist = Math.max(w, h) * 1.5; // wrap once, then vanish
    }
    update() {
      this.x = (this.x + this.dx + w) % w;
      this.y = (this.y + this.dy + h) % h;
      this.dist += Math.hypot(this.dx, this.dy);
    }
    get alive() {
      return this.dist < this.maxDist;
    }
    draw() {
      ctx.fillStyle = "white";
      ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
    }
  }

  class Asteroid {
    constructor(x, y, r) {
      this.x = x;
      this.y = y;
      this.r = r;
      const ang = Math.random() * Math.PI * 2;
      const spd = Math.random() * 2 + 0.5;
      this.dx = Math.cos(ang) * spd;
      this.dy = Math.sin(ang) * spd;
    }
    update() {
      this.x = (this.x + this.dx + w) % w;
      this.y = (this.y + this.dy + h) % h;
    }
    draw() {
      ctx.strokeStyle = "white";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 / 8) * i;
        const rad = this.r + Math.random() * 5 - 2;
        ctx.lineTo(this.x + rad * Math.cos(ang), this.y + rad * Math.sin(ang));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // --- Game objects ---
  let ship = new Ship();
  let bullets = [];
  let asteroids = [];
  let score = 0;

  function resetAsteroids() {
    asteroids = [];
    for (let i = 0; i < 5; i++) {
      asteroids.push(new Asteroid(Math.random() * w, Math.random() * h, 40));
    }
  }
  resetAsteroids();

  // --- Game loop ---
  function update() {
    ship.update();
    bullets.forEach(b => b.update());
    asteroids.forEach(a => a.update());

    // Bullet vs asteroid
    for (let b of bullets) {
      for (let i = asteroids.length - 1; i >= 0; i--) {
        let a = asteroids[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < a.r) {
          const boom = sndExplode.cloneNode();
          const src = audioCtx.createMediaElementSource(boom);
          const gain = audioCtx.createGain();
          gain.gain.value = 2.0; // 💥 slightly lower volume
          src.connect(gain).connect(audioCtx.destination);
          boom.play();

          bullets.splice(bullets.indexOf(b), 1);
          asteroids.splice(i, 1);
          score += 100;
          if (a.r > 20) {
            asteroids.push(new Asteroid(a.x, a.y, a.r / 2));
            asteroids.push(new Asteroid(a.x, a.y, a.r / 2));
          }
          break;
        }
      }
    }

    // Ship vs asteroid
    for (let i = asteroids.length - 1; i >= 0; i--) {
      let a = asteroids[i];
      const dx = ship.x - a.x, dy = ship.y - a.y;
      if (Math.sqrt(dx * dx + dy * dy) < a.r + ship.r) {
        ship.lives--;
        const boom = sndExplode.cloneNode();
        const src = audioCtx.createMediaElementSource(boom);
        const gain = audioCtx.createGain();
        gain.gain.value = 2.0;
        src.connect(gain).connect(audioCtx.destination);
        boom.play();

        if (ship.lives <= 0) {
          ctx.fillStyle = "red";
          ctx.font = "40px monospace";
          ctx.textAlign = "center";
          ctx.fillText("GAME OVER", w / 2, h / 2);
          sndThrust.pause();
          setTimeout(() => {
            ship = new Ship();
            bullets = [];
            score = 0;
            resetAsteroids();
            update();
          }, 2000);
          return;
        }

        ship.x = w / 2;
        ship.y = h / 2;
        ship.thrust = { x: 0, y: 0 };
        break;
      }
    }

    if (asteroids.length === 0) resetAsteroids();
    bullets = bullets.filter(b => b.alive);

    // Draw
    ctx.clearRect(0, 0, w, h);
    ship.draw();
    bullets.forEach(b => b.draw());
    asteroids.forEach(a => a.draw());
    ctx.fillStyle = "white";
    ctx.font = "20px monospace";
    ctx.fillText("Score: " + score, 20, 30);
    ctx.fillText("Lives: " + ship.lives, 20, 60);

    requestAnimationFrame(update);
  }

  update();

  // --- Touch controls ---
  const thrustBtn = document.getElementById("thrust");
  const fireBtn = document.getElementById("fire");
  const leftBtn = document.getElementById("left");
  const rightBtn = document.getElementById("right");

  thrustBtn.ontouchstart = () => {
    ship.thrusting = true;
    audioCtx.resume();
  };
  thrustBtn.ontouchend = () => (ship.thrusting = false);

  let fireInterval = null;
  fireBtn.ontouchstart = () => {
    if (!fireInterval) {
      const fireSound = sndFire.cloneNode();
      const src = audioCtx.createMediaElementSource(fireSound);
      const gain = audioCtx.createGain();
      gain.gain.value = 0.1; // 🔫 quiet fire
      src.connect(gain).connect(audioCtx.destination);
      fireSound.play();
      bullets.push(new Bullet(ship.x, ship.y, ship.a));
      fireInterval = setInterval(() => {
        const fireSound = sndFire.cloneNode();
        const src = audioCtx.createMediaElementSource(fireSound);
        const gain = audioCtx.createGain();
        gain.gain.value = 0.1;
        src.connect(gain).connect(audioCtx.destination);
        fireSound.play();
        bullets.push(new Bullet(ship.x, ship.y, ship.a));
      }, 200);
    }
  };
  fireBtn.ontouchend = () => {
    clearInterval(fireInterval);
    fireInterval = null;
  };

  leftBtn.ontouchstart = () => (ship.rot = -0.1);
  leftBtn.ontouchend = () => (ship.rot = 0);
  rightBtn.ontouchstart = () => (ship.rot = 0.1);
  rightBtn.ontouchend = () => (ship.rot = 0);
};
