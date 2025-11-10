    
window.onload = function() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let w, h;

  // Disable pinch and double-tap zoom in Safari
  document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
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
      } else {
        this.thrust.x *= 0.99;
        this.thrust.y *= 0.99;
      }
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

    // Collisions
    for (let b of bullets) {
      for (let i = asteroids.length - 1; i >= 0; i--) {
        let a = asteroids[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.sqrt(dx*dx+dy*dy) < a.r) {
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


      // Ship vs asteroid collision
  for (let i = asteroids.length - 1; i >= 0; i--) {
    let a = asteroids[i];
    const dx = ship.x - a.x, dy = ship.y - a.y;
    if (Math.sqrt(dx * dx + dy * dy) < a.r + ship.r) {
      ship.lives--;
      if (ship.lives <= 0) {
  // Show Game Over message on canvas instead of using alert
  ctx.fillStyle = "red";
  ctx.font = "40px monospace";
  ctx.textAlign = "center";
  ctx.fillText("GAME OVER", w / 2, h / 2);
  cancelAnimationFrame(update); // stop game loop
  setTimeout(() => {
    // reset after 2 seconds
    ship.lives = 3;
    score = 0;
    ship.x = w / 2;
    ship.y = h / 2;
    ship.thrust = { x: 0, y: 0 };
    resetAsteroids();
    requestAnimationFrame(update);
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
  document.getElementById("thrust").ontouchstart = () => ship.thrusting = true;
  document.getElementById("thrust").ontouchend = () => ship.thrusting = false;
  document.getElementById("fire").ontouchstart = () => bullets.push(new Bullet(ship.x, ship.y, ship.a));
  document.getElementById("left").ontouchstart = () => ship.rot = -0.1;
  document.getElementById("left").ontouchend = () => ship.rot = 0;
  document.getElementById("right").ontouchstart = () => ship.rot = 0.1;
  document.getElementById("right").ontouchend = () => ship.rot = 0;
};
