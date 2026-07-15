/* ============================================================
   GREYLOCK TRUST — app.js
   Modular front-end: each feature is an isolated module with
   its own init(), wired together by App.init() at the bottom.
   ============================================================ */

'use strict';

const App = (() => {

  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==========================================================
     1. NAVBAR — glass shell + logo/text swap on scroll
     ========================================================== */
  const Navbar = {
    el: null,
    threshold: 60,

    init() {
      this.el = document.querySelector('.site-nav');
      if (!this.el) return;
      this.onScroll = this.onScroll.bind(this);
      window.addEventListener('scroll', this.onScroll, { passive: true });
      this.onScroll();
    },

    onScroll() {
      this.el.classList.toggle('scrolled', window.scrollY > this.threshold);
    }
  };

  /* ==========================================================
     2. SCROLL PROGRESS BAR
     ========================================================== */
  const Progress = {
    bar: null,

    init() {
      this.bar = document.querySelector('.progress');
      if (!this.bar) return;
      let ticking = false;
      window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
          this.bar.style.width = pct + '%';
          ticking = false;
        });
      }, { passive: true });
    }
  };

  /* ==========================================================
     3. REVEAL — staggered entrance choreography
     ========================================================== */
  const Reveal = {
    init() {
      const targets = document.querySelectorAll('.reveal, .stagger');
      if (!targets.length) return;

      if (prefersReducedMotion) {
        targets.forEach(t => t.classList.add('in'));
        return;
      }

      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

      targets.forEach(t => io.observe(t));
    }
  };

  /* ==========================================================
     4. TILT CARDS — 3D tilt + cursor-tracking gold spotlight
     ========================================================== */
  const Tilt = {
    maxTilt: 5, // degrees

    init() {
      if (prefersReducedMotion) return;
      // Skip on coarse pointers (touch) — tilt feels broken there
      if (window.matchMedia('(pointer: coarse)').matches) return;

      document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('pointermove', e => this.move(e, card));
        card.addEventListener('pointerleave', () => this.reset(card));
      });
    },

    move(e, card) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // spotlight position (CSS custom props consumed by ::before)
      card.style.setProperty('--mx', (x / rect.width) * 100 + '%');
      card.style.setProperty('--my', (y / rect.height) * 100 + '%');

      // tilt, centered around the middle of the card
      const rx = ((y / rect.height) - 0.5) * -2 * this.maxTilt;
      const ry = ((x / rect.width) - 0.5) * 2 * this.maxTilt;
      card.style.transform =
        `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px)`;
    },

    reset(card) {
      card.style.transform = '';
    }
  };

  /* ==========================================================
     5. PARALLAX — slow drift on full-bleed photos
     ========================================================== */
  const Parallax = {
    items: [],

    init() {
      if (prefersReducedMotion) return;
      this.items = [...document.querySelectorAll('[data-parallax]')];
      if (!this.items.length) return;

      let ticking = false;
      window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { this.update(); ticking = false; });
      }, { passive: true });
      this.update();
    },

    update() {
      const vh = window.innerHeight;
      this.items.forEach(img => {
        const rect = img.parentElement.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh) return; // offscreen
        // -1 → 1 as the element travels through the viewport
        const progress = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
        img.style.transform = `translateY(${(-progress * 4).toFixed(2)}%)`;
      });
    }
  };

  /* ==========================================================
     6. MARQUEE — duplicate content for a seamless loop
     ========================================================== */
  const Marquee = {
    init() {
      const track = document.querySelector('.marquee-track');
      if (!track) return;
      track.innerHTML += track.innerHTML;
    }
  };

  /* ==========================================================
     7. BOOKER — three-step scheduling engine
        day → time → details → confirmation
     ========================================================== */
  const Booker = {
    // How far ahead clients can book, in months (increase for more dates)
    MONTHS_AHEAD: 6,
    SLOT_TIMES: ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM'],
    MONTHS: ['January','February','March','April','May','June',
             'July','August','September','October','November','December'],
    DOWS: ['Su','Mo','Tu','We','Th','Fr','Sa'],

    state: {
      viewYear: null,
      viewMonth: null,
      selectedDate: null,
      selectedTime: null,
      meetingType: 'In-person'
    },

    init() {
      this.root = document.querySelector('.booker');
      if (!this.root) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      this.today = today;
      this.maxAhead = new Date(today.getFullYear(), today.getMonth() + this.MONTHS_AHEAD, 1);
      this.state.viewYear = today.getFullYear();
      this.state.viewMonth = today.getMonth();

      this.calGrid  = document.getElementById('calGrid');
      this.calMonth = document.getElementById('calMonth');
      this.prevBtn  = document.getElementById('prevMonth');
      this.nextBtn  = document.getElementById('nextMonth');

      this.prevBtn.addEventListener('click', () => this.shiftMonth(-1));
      this.nextBtn.addEventListener('click', () => this.shiftMonth(1));

      this.root.querySelectorAll('.back-link').forEach(b =>
        b.addEventListener('click', () => this.showPane(+b.dataset.back)));

      document.getElementById('bookingForm')
        .addEventListener('submit', e => this.submit(e));

      // meeting-type toggle (In person / Video call)
      this.segButtons = [...this.root.querySelectorAll('.seg-btn')];
      this.segButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.segButtons.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.state.meetingType = btn.dataset.value;
        });
      });

      this.renderCalendar();
    },

    shiftMonth(delta) {
      let { viewYear: y, viewMonth: m } = this.state;
      m += delta;
      if (m < 0)  { m = 11; y--; }
      if (m > 11) { m = 0;  y++; }
      this.state.viewYear = y;
      this.state.viewMonth = m;
      this.renderCalendar();
    },

    fmtDate(d) {
      return d.toLocaleDateString(undefined,
        { weekday: 'long', month: 'long', day: 'numeric' });
    },

    showPane(n) {
      for (let i = 1; i <= 4; i++) {
        document.getElementById('pane' + i)
          .classList.toggle('active', i === n);
      }
      const activeTab = n > 3 ? 3 : n;
      ['tab1', 'tab2', 'tab3'].forEach((id, idx) => {
        document.getElementById(id)
          .classList.toggle('active', idx + 1 === activeTab);
      });
    },

    renderCalendar() {
      const { viewYear: y, viewMonth: m } = this.state;
      this.calMonth.textContent = `${this.MONTHS[m]} ${y}`;
      this.calGrid.innerHTML = '';

      this.DOWS.forEach(d => {
        const el = document.createElement('div');
        el.className = 'dow';
        el.textContent = d;
        this.calGrid.appendChild(el);
      });

      const firstDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < firstDow; i++) {
        this.calGrid.appendChild(document.createElement('div'));
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-day';
        btn.textContent = d;

        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isPast = date <= this.today;

        if (isWeekend || isPast) {
          btn.disabled = true;
        } else {
          btn.addEventListener('click', () => this.pickDay(date, btn));
        }
        this.calGrid.appendChild(btn);
      }

      this.prevBtn.disabled =
        y === this.today.getFullYear() && m === this.today.getMonth();
      this.nextBtn.disabled =
        y === this.maxAhead.getFullYear() && m === this.maxAhead.getMonth();
    },

    pickDay(date, btn) {
      this.state.selectedDate = date;
      this.calGrid.querySelectorAll('.cal-day.selected')
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('pickedDay').textContent = this.fmtDate(date);
      this.renderSlots();
      // small beat so the selection state is visible before the pane flips
      setTimeout(() => this.showPane(2), 160);
    },

    renderSlots() {
      const grid = document.getElementById('slotGrid');
      grid.innerHTML = '';
      this.SLOT_TIMES.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot';
        b.textContent = t;
        b.addEventListener('click', () => {
          grid.querySelectorAll('.slot.selected')
            .forEach(s => s.classList.remove('selected'));
          b.classList.add('selected');
          this.state.selectedTime = t;
          document.getElementById('pickedSlot').textContent =
            `${this.fmtDate(this.state.selectedDate)} · ${t}`;
          setTimeout(() => this.showPane(3), 160);
        });
        grid.appendChild(b);
      });
    },

    validate() {
      let ok = true;
      const name  = document.getElementById('name');
      const email = document.getElementById('email');

      const check = (input, test) => {
        const field = input.closest('.field');
        const valid = test(input.value.trim());
        field.classList.toggle('invalid', !valid);
        if (!valid) ok = false;
      };

      check(name,  v => v.length >= 2);
      check(email, v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      return ok;
    },

    submit(e) {
      e.preventDefault();
      if (!this.validate()) return;

      const name = document.getElementById('name').value.trim();
      document.getElementById('confirmText').textContent =
        `${name}, your ${this.state.meetingType.toLowerCase()} onboarding session ` +
        `is set for ${this.fmtDate(this.state.selectedDate)} at ${this.state.selectedTime}.`;
      this.showPane(4);
    }
  };

  /* ==========================================================
     8. CONTACT FORM — validation + inline success state
     ========================================================== */
  const ContactForm = {
    init() {
      this.form = document.getElementById('contactForm');
      if (!this.form) return;
      this.form.addEventListener('submit', e => this.submit(e));
    },

    validate() {
      let ok = true;
      const check = (id, test) => {
        const input = document.getElementById(id);
        const field = input.closest('.field');
        const valid = test(input.value.trim());
        field.classList.toggle('invalid', !valid);
        if (!valid) ok = false;
      };
      check('cname',    v => v.length >= 2);
      check('cemail',   v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      check('cmessage', v => v.length >= 10);
      return ok;
    },

    submit(e) {
      e.preventDefault();
      if (!this.validate()) return;
      const name = document.getElementById('cname').value.trim().split(' ')[0];
      document.getElementById('contactConfirm').textContent =
        `Thank you, ${name} — your message is on its way. ` +
        `A member of the team will reply within one business day.`;
      this.form.style.display = 'none';
      document.getElementById('contactSuccess').classList.add('active');
    }
  };

  /* ==========================================================
     9. INTRO CALL — phone request form
     ========================================================== */
  const IntroCall = {
    init() {
      this.form = document.getElementById('introForm');
      if (!this.form) return;
      this.form.addEventListener('submit', e => this.submit(e));
    },

    validate() {
      let ok = true;
      const check = (id, test) => {
        const input = document.getElementById(id);
        const field = input.closest('.field');
        const valid = test(input.value.trim());
        field.classList.toggle('invalid', !valid);
        if (!valid) ok = false;
      };
      check('iname',  v => v.length >= 2);
      // lenient phone check: 7-15 digits once separators are stripped
      check('iphone', v => {
        const digits = v.replace(/[^0-9]/g, '');
        return digits.length >= 7 && digits.length <= 15;
      });
      return ok;
    },

    submit(e) {
      e.preventDefault();
      if (!this.validate()) return;
      const name = document.getElementById('iname').value.trim().split(' ')[0];
      const when = document.getElementById('itime').value.toLowerCase();
      const window_ = when === 'any time is fine'
        ? 'at a convenient time'
        : `in the ${when.replace(/ \(.*\)/, '')}`;
      document.getElementById('introConfirm').textContent =
        `Thank you, ${name} — an advisor will call you ${window_} within one business day.`;
      this.form.style.display = 'none';
      document.getElementById('introSuccess').classList.add('active');
    }
  };

  /* ==========================================================
     BOOT
     ========================================================== */
  return {
    init() {
      Navbar.init();
      Progress.init();
      Reveal.init();
      Tilt.init();
      Parallax.init();
      Marquee.init();
      Booker.init();
      ContactForm.init();
      IntroCall.init();
    }
  };
})();

document.addEventListener('DOMContentLoaded', App.init);

(function () {
  'use strict';
  const burger = document.getElementById('navBurger');
  const menu = document.getElementById('mobileMenu');
  if (!burger || !menu) return;
  burger.addEventListener('click', () => {
    document.body.classList.toggle('menu-open');
  });
  menu.addEventListener('click', e => {
    if (e.target.tagName === 'A') document.body.classList.remove('menu-open');
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) document.body.classList.remove('menu-open');
  });
})();


/* intro-call: constrain the date picker to tomorrow onward */
(function(){
  'use strict';
  const d = document.getElementById('idate');
  if (!d) return;
  const t = new Date(); t.setDate(t.getDate() + 1);
  d.min = t.toISOString().split('T')[0];
})();
