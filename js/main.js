document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.classList.toggle('open');
    });
    links.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => {
        links.classList.remove('open');
        toggle.classList.remove('open');
      })
    );
  }

  // Highlight the current page in the nav
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach((a) => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });

  // Scroll progress bar
  const bar = document.getElementById('scrollProgress');
  if (bar) {
    const onScroll = () => {
      const h = document.documentElement;
      const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
      bar.style.width = pct + '%';
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Reveal-on-scroll animations
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // Typewriter (home hero)
  const tw = document.getElementById('typewriter');
  if (tw) {
    const phrases = [
      'build things for the web.',
      'solve problems with code.',
      'learn something new every day.',
    ];
    let pi = 0;
    let ci = 0;
    let deleting = false;
    (function tick() {
      const current = phrases[pi];
      ci += deleting ? -1 : 1;
      tw.textContent = current.slice(0, ci);
      let delay = deleting ? 40 : 75;
      if (!deleting && ci === current.length) {
        delay = 2000;
        deleting = true;
      } else if (deleting && ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        delay = 500;
      }
      setTimeout(tick, delay);
    })();
  }

  // Project filters
  const filterBtns = document.querySelectorAll('.filter-btn');
  if (filterBtns.length) {
    filterBtns.forEach((btn) =>
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.filter;
        document.querySelectorAll('[data-category]').forEach((card) => {
          card.classList.toggle('hidden', cat !== 'all' && card.dataset.category !== cat);
        });
      })
    );
  }

  // Footer year
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
});
