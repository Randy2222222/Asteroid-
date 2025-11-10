window.onload = function() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let w, h;

  // Sound effects
const sndThrust = new Audio("thrust.mp3");
const sndFire = new Audio("fire.mp3");
const sndExplode = new Audio("explode.mp3");

// 🎧 Add AudioContext for volume control (thrust fade & boost)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let thrustGainNode = audioCtx.createGain();
thrustGainNode.gain.value = 0; // start silent
let thrustSource = audioCtx.createMediaElementSource(sndThrust);
thrustSource.connect(thrustGainNode).connect(audioCtx.destination);

sndThrust.loop = true;
[sndThrust, sndFire, sndExplode].forEach(s => {
  s.preload = "auto";
  s.load();
});


  // Disable pinch and double-tap zoom (iPad Safari fix)
  document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, false);

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  class Ship {
    constructor() {
      this.x = w / 2;
      this.y = h / 2;
      this.a = 0;
      this.r = 15;
      this.thrust = {x:0, y:0};
      this.rot = 0;
      this.thrusting = false;
      this.lives = 3;
    }
    update() {
      if (this.thrusting) {
        this.thrust.x += 0.1 * Math.cos(this.a);
        this.thrust.y += 0.1 * Math.sin(this.a);
        if (sndThrust.paused) sndThrust.play();
      } else {
        sndThrust.pause();
        sndThrust.currentTime = 0;
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
      this.life = 60;
    }
    update() {
      this.x += this.dx;
      this.y += this.dy;
      this.x = (this.x + w) % w;
      this.y = (this.y + h) % h;
      this.life--;
    }
    draw() {
      ctx.fillStyle = "white";
      ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
    }
  }

  class Asteroid {
    constructor(x, y, r) {
      this.x = x; this.y = y; this.r = r;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 0.5;
      this.dx = Math.cos(angle) * speed;
      this.dy = Math.sin(angle) * speed;
    }
    update() {
      this.x = (this.x + this.dx + w) % w;
      this.y = (this.y + this.dy + h) % h;
    }
    draw() {
      ctx.strokeStyle = "white";
      ctx.beginPath();
      for (let i=0; i<8; i++) {
        const ang = (Math.PI*2/8)*i;
        const rad = this.r + Math.random()*5-2;
        ctx.lineTo(this.x + rad*Math.cos(ang), this.y + rad*Math.sin(ang));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  let ship = new Ship();
  let bullets = [];
  let asteroids = [];
  let score = 0;

  function resetAsteroids() {
    asteroids = [];
    for (let i=0; i<5; i++) {
      asteroids.push(new Asteroid(Math.random()*w, Math.random()*h, 40));
    }
  }
  resetAsteroids();

  function update() {
    ship.update();
    bullets.forEach(b => b.update());
    asteroids.forEach(a => a.update());

    // Bullet vs asteroid
    for (let b of bullets) {
      for (let i = asteroids.length - 1; i >= 0; i--) {
        let a = asteroids[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.sqrt(dx*dx+dy*dy) < a.r) {
          const boom = sndExplode.cloneNode();
          boom.play();
          bullets.splice(bullets.indexOf(b),1);
          asteroids.splice(i,1);
          score += 100;
          if (a.r > 20) {
            asteroids.push(new Asteroid(a.x, a.y, a.r/2));
            asteroids.push(new Asteroid(a.x, a.y, a.r/2));
          }
          break;
        }
      }
    }

    // Ship vs asteroid
    for (let i = asteroids.length - 1; i >= 0; i--) {
      let a = asteroids[i];
      const dx = ship.x - a.x, dy = ship.y - a.y;
      if (Math.sqrt(dx*dx+dy*dy) < a.r + ship.r) {
        ship.lives--;
        const boom = sndExplode.cloneNode();
const src = audioCtx.createMediaElementSource(boom);
const gain = audioCtx.createGain();
gain.gain.value = 1.8; // 💥 Boost volume — 1.0 = normal, 1.8 = ~80% louder
src.connect(gain).connect(audioCtx.destination);
boom.play();
        if (ship.lives <= 0) {
          ctx.fillStyle = "red";
          ctx.font = "40px monospace";
          ctx.textAlign = "center";
          ctx.fillText("GAME OVER", w / 2, h / 2);
          cancelAnimationFrame(update);
          setTimeout(() => {
            ship.lives = 3;
            score = 0;
            ship.x = w / 2;
            ship.y = h / 2;
            ship.thrust = {x:0, y:0};
            resetAsteroids();
            requestAnimationFrame(update);
          }, 2000);
          return;
        }
        ship.x = w / 2;
        ship.y = h / 2;
        ship.thrust = {x:0, y:0};
        break;
      }
    }

    if (asteroids.length === 0) resetAsteroids();
    bullets = bullets.filter(b => b.life > 0);

    ctx.clearRect(0, 0, w, h);
    ship.draw();
    bullets.forEach(b => b.draw());
    asteroids.forEach(a => a.draw());
    ctx.fillStyle = "white";
    ctx.font = "20px monospace";
    ctx.fillText("Score: "+score, 20, 30);
    ctx.fillText("Lives: "+ship.lives, 20, 60);
    requestAnimationFrame(update);
  }

  update();

  // Touch controls
  const thrustBtn = document.getElementById("thrust");
  const fireBtn = document.getElementById("fire");
  const leftBtn = document.getElementById("left");
  const rightBtn = document.getElementById("right");

  thrustBtn.ontouchstart = () => {
    ship.thrusting = true;
    sndThrust.play();
  };
  thrustBtn.ontouchend = () => {
    ship.thrusting = false;
    sndThrust.pause();
    sndThrust.currentTime = 0;
  };

  // Continuous firing while holding
  let fireInterval = null;
  fireBtn.ontouchstart = () => {
    if (!fireInterval) {
      const fireSound = sndFire.cloneNode();
      fireSound.play();
      bullets.push(new Bullet(ship.x, ship.y, ship.a));
      fireInterval = setInterval(() => {
        const fireSound = sndFire.cloneNode();
        fireSound.play();
        bullets.push(new Bullet(ship.x, ship.y, ship.a));
      }, 200);
    }
  };
  fireBtn.ontouchend = () => {
    clearInterval(fireInterval);
    fireInterval = null;
  };

  leftBtn.ontouchstart = () => ship.rot = -0.1;
  leftBtn.ontouchend = () => ship.rot = 0;
  rightBtn.ontouchstart = () => ship.rot = 0.1;
  rightBtn.ontouchend = () => ship.rot = 0;
};
