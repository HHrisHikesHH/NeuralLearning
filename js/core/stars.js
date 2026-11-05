// Twinkling starfield background. Static under prefers-reduced-motion; paused while hidden.
export function startStars(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  let stars = [];
  let raf = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function size() {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    const count = Math.round(Math.min(220, (innerWidth * innerHeight) / 6000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: (Math.random() * 1.2 + 0.2) * dpr, t: Math.random() * Math.PI * 2, s: 0.001 + Math.random() * 0.002,
    }));
    draw(false);
  }

  function draw(advance) {
    ctx.fillStyle = '#020508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      if (advance) s.t += s.s;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,210,255,${0.1 + 0.3 * Math.abs(Math.sin(s.t))})`;
      ctx.fill();
    }
  }

  function loop() { draw(true); raf = requestAnimationFrame(loop); }
  function start() { if (!reduced && !raf && !document.hidden) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => (document.hidden ? stop() : start());

  size();
  start();
  window.addEventListener('resize', size);
  document.addEventListener('visibilitychange', onVis);
  return () => { stop(); window.removeEventListener('resize', size); document.removeEventListener('visibilitychange', onVis); };
}
