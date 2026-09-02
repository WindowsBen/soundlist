// ================== PARTICLES ==================
// Self-executing — import this module for the side effect only.
// No exports.

(function initParticles() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const COUNT      = 90;
  const MAX_DIST   = 160;
  const SPEED      = 0.35;
  const DOT_R      = 2;
  const MAX_DIST2  = MAX_DIST * MAX_DIST;

  let particles = [];
  let W = 0, H = 0;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    const angle = Math.random() * Math.PI * 2;
    const speed = SPEED * (0.5 + Math.random() * 0.5);
    return {
      x:  Math.random() * W,
      y:  Math.random() * H,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, makeParticle);
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -5)      p.x = W + 5;
      else if (p.x > W + 5) p.x = -5;
      if (p.y < -5)      p.y = H + 5;
      else if (p.y > H + 5) p.y = -5;
    }

    const light          = document.body.classList.contains("lightmode");
    const dotColor       = light ? "rgba(20, 30, 90, 0.7)"    : "rgba(180, 215, 255, 0.75)";
    const lineBase       = light ? "20, 30, 90"                : "160, 200, 255";
    const lineAlphaScale = light ? 0.35                        : 0.45;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < MAX_DIST2) {
          const alpha = (1 - Math.sqrt(d2) / MAX_DIST) * lineAlphaScale;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(${lineBase}, ${alpha})`;
          ctx.lineWidth   = 0.8;
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = dotColor;
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(init, 200);
  });

  init();
  tick();
})();