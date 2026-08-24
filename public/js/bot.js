(function () {
  function initBot() {
    const svg = document.getElementById('botSvg');
    if (!svg) return;
    const pupils = svg.querySelectorAll('.pupil');
    const eyes = svg.querySelectorAll('.eye');

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let idleTimer = null;
    let idle = true;

    function setTargetFromPoint(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.44; // roughly the eye line
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const maxOffset = 5.5; // svg user units the pupil is allowed to travel
      const pull = Math.min(1, dist / 260); // eyes ease toward full offset as cursor moves away
      target.x = (dx / dist) * maxOffset * pull;
      target.y = (dy / dist) * maxOffset * 0.7 * pull;

      idle = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idle = true; }, 4500);
    }

    window.addEventListener('mousemove', (e) => setTargetFromPoint(e.clientX, e.clientY));
    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) setTargetFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    function tick() {
      if (idle) {
        const t = Date.now() / 1600;
        target.x = Math.sin(t) * 3;
        target.y = Math.cos(t * 0.7) * 1.3;
      }
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      pupils.forEach((p) => p.setAttribute('transform', `translate(${current.x.toFixed(2)},${current.y.toFixed(2)})`));
      requestAnimationFrame(tick);
    }
    tick();

    function scheduleBlink() {
      setTimeout(() => {
        eyes.forEach((e) => e.classList.add('blink'));
        setTimeout(() => eyes.forEach((e) => e.classList.remove('blink')), 140);
        scheduleBlink();
      }, 2600 + Math.random() * 3400);
    }
    scheduleBlink();
  }

  function scatterParticles() {
    const stage = document.querySelector('.stage');
    if (!stage) return;
    const positions = [
      [12, 18], [88, 12], [8, 78], [92, 70], [50, 8], [45, 90], [70, 40], [20, 45]
    ];
    positions.forEach(([left, top], i) => {
      const el = document.createElement('span');
      el.className = 'particle';
      el.style.left = left + '%';
      el.style.top = top + '%';
      el.style.animationDelay = (i * 0.6) + 's';
      stage.appendChild(el);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initBot();
    scatterParticles();
  });
})();
