/* ============================================================
   GREYLOCK TRUST — app.js
   Modular front-end: each feature is an isolated module with
   its own init(), wired together by App.init() at the bottom.
   ============================================================ */

'use strict';

/* ============================================================
   GREYLOCK CONFIG — paste your service IDs here
   ============================================================ */
const GREYLOCK = {
  // From formspree.io → your three forms → each form's ID (the part after /f/)
  FORMSPREE: {
    support:    'PASTE_SUPPORT_ID',
    intro:      'PASTE_INTRO_ID',
    onboarding: 'PASTE_ONBOARDING_ID'
  },
  SUPABASE_URL: 'https://otjanvfidvyfhhvteedp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90amFudmZpZHZ5ZmhodnRlZWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTQzNDUsImV4cCI6MjA5OTA5MDM0NX0.Rv8pvoALDawrvxn-xpYaJCpZLFHO0eYi4DL6gSOKAFo'
};

/* Bookings API — availability + creation, plain fetch, graceful offline */
const BookingsAPI = {
  headers() {
    return {
      'apikey': GREYLOCK.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + GREYLOCK.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
  },

  // -> Map of "YYYY-MM-DD|9:00 AM" -> number of seats taken in that unit
  async fetchBooked(fromISO, toISO) {
    try {
      const url = `${GREYLOCK.SUPABASE_URL}/rest/v1/booked_slots` +
                  `?day=gte.${fromISO}&day=lte.${toISO}&select=day,slot,kind,n`;
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) return new Map();
      const rows = await r.json();
      return new Map(rows.map(x => [`${x.day}|${x.slot}|${x.kind}`, x.n]));
    } catch (_) {
      return new Map();   // offline/preview: calendar still works, just unfiltered
    }
  },

  // -> {ok:true} | {ok:false, dupe:true} | {ok:false}
  async create(payload) {
    try {
      const r = await fetch(`${GREYLOCK.SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: { ...this.headers(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload)
      });
      if (r.ok) return { ok: true };
      if (r.status === 409) return { ok: false, dupe: true };  // unique(day,slot) fired
      return { ok: false };
    } catch (_) {
      return { ok: false, offline: true };
    }
  },

  // fire the notification email via Formspree (no-op until IDs are pasted)
  async notify(formKey, data) {
    const id = GREYLOCK.FORMSPREE[formKey];
    if (!id || id.startsWith('PASTE_')) return { skipped: true };
    try {
      const r = await fetch(`https://formspree.io/f/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      });
      return { ok: r.ok };
    } catch (_) { return { ok: false }; }
  },

  async insert(table, payload) {
    try {
      const r = await fetch(`${GREYLOCK.SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload)
      });
      return { ok: r.ok };
    } catch (_) { return { ok: false }; }
  },

  // confirmation email via Edge Function — fire-and-forget; a mail
  // hiccup must never break a completed booking
  async sendConfirmation(data) {
    if (!data || !data.email) return;
    try {
      await fetch(`${GREYLOCK.SUPABASE_URL}/functions/v1/send-confirmation-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + GREYLOCK.SUPABASE_ANON_KEY,
          'apikey': GREYLOCK.SUPABASE_ANON_KEY
        },
        body: JSON.stringify(data)
      });
    } catch (_) { /* booking already succeeded; stay silent */ }
  },

  async rpc(fn, args) {
    try {
      const r = await fetch(`${GREYLOCK.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(args)
      });
      if (!r.ok) return null;
      const text = await r.text();
      return text ? JSON.parse(text) : true;
    } catch (_) { return null; }
  },

  toISO(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
};



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
    UNIT_MIN: 30,

    // labels <-> minutes
    toMin(label) {
      const m = label.match(/(\d+):(\d+)\s*(AM|PM)/i);
      let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12;
      return h * 60 + (+m[2]);
    },
    toLabel(min) {
      let h = Math.floor(min / 60), mm = min % 60;
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
    },

    MONTHS: ['January','February','March','April','May','June',
             'July','August','September','October','November','December'],
    DOWS: ['Su','Mo','Tu','We','Th','Fr','Sa'],
    MONTHS_AHEAD: 12,
    // Demo window: only these dates are bookable. Set to null to
    // reopen the full calendar after the demo.
    BOOK_WINDOW: { start: '2026-07-20', end: '2026-07-24' },

    state: { viewYear:null, viewMonth:null, selectedDate:null,
             selectedTime:null, meetingType:null },

    init() {
      this.root = document.querySelector('.booker');
      if (!this.root || !document.getElementById('calGrid')) return;

      // ---- per-page configuration via data attributes ----
      this.kind = this.root.dataset.kind || 'onboarding';
      if (this.kind === 'intro') {
        this.durationUnits = 1;                       // 20-min call in one unit
        this.startTimes = [];
        for (let t = this.toMin('9:00 AM'); t <= this.toMin('4:30 PM'); t += 30)
          this.startTimes.push(this.toLabel(t));
        this.state.meetingType = 'Phone call';
        this.CAPACITY = 1;                        // intro calls: one at a time
      } else {
        this.durationUnits = 4;                       // 2-hour session = 4 units
        this.startTimes = ['9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM'];
        this.state.meetingType = 'In person';
      }

      const today = new Date(); today.setHours(0,0,0,0);
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

      this.segButtons = [...this.root.querySelectorAll('.seg-btn')];
      this.segButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.segButtons.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.state.meetingType = btn.dataset.value;
          this.toggleVideoEmail();
        });
      });
      this.toggleVideoEmail();

      this.booked = new Map();
      this.renderCalendar();
      this.refreshBooked();
      this.initManage();          // stage 2: ?manage=<token>
    },

    toggleVideoEmail() {
      // on the intro card, email is only needed for video calls
      const wrap = document.getElementById('emailField');
      if (!wrap) return;
      const on = this.state.meetingType === 'Video call';
      wrap.classList.toggle('hidden', !on);
    },

    CAPACITY: 2,   // onboarding: 2 at once; intro pages override to 1 in init

    // day-specific schedules: Fridays offer mornings only
    timesFor(date) {
      if (date.getDay() === 5) {                       // Friday
        if (this.kind === 'intro')
          return this.startTimes.filter(t => this.toMin(t) < this.toMin('12:00 PM'));
        return ['9:30 AM'];                            // onboarding: one morning session
      }
      return this.startTimes;
    },

    unitsFor(startLabel) {
      const s = this.toMin(startLabel), out = [];
      for (let i = 0; i < this.durationUnits; i++)
        out.push(this.toLabel(s + i * this.UNIT_MIN));
      return out;
    },
    seatsLeft(date, startLabel) {
      const day = BookingsAPI.toISO(date);
      let used = 0;
      this.unitsFor(startLabel).forEach(u => {
        used = Math.max(used, this.booked.get(`${day}|${u}|${this.kind}`) || 0);
      });
      return Math.max(0, this.CAPACITY - used);
    },
    isStartFree(date, startLabel) {
      return this.seatsLeft(date, startLabel) > 0;
    },
    dayHasSpace(date) {
      return this.timesFor(date).some(t => this.isStartFree(date, t));
    },

    async refreshBooked() {
      const { viewYear: y, viewMonth: m } = this.state;
      const from = BookingsAPI.toISO(new Date(y, m, 1));
      const to   = BookingsAPI.toISO(new Date(y, m + 1, 0));
      this.booked = await BookingsAPI.fetchBooked(from, to);
      this.renderCalendar();
      if (this.state.selectedDate) this.renderSlots();
    },

    shiftMonth(delta) {
      let { viewYear: y, viewMonth: m } = this.state;
      m += delta;
      if (m < 0)  { m = 11; y--; }
      if (m > 11) { m = 0;  y++; }
      this.state.viewYear = y; this.state.viewMonth = m;
      this.renderCalendar();
      this.refreshBooked();
    },

    fmtDate(d) {
      return d.toLocaleDateString(undefined,
        { weekday:'long', month:'long', day:'numeric' });
    },

    showPane(n) {
      for (let i = 1; i <= 4; i++) {
        const p = document.getElementById('pane' + i);
        if (p) p.classList.toggle('active', i === n);
      }
      const activeTab = n > 3 ? 3 : n;
      ['tab1','tab2','tab3'].forEach((id, idx) => {
        const t = document.getElementById(id);
        if (t) t.classList.toggle('active', idx + 1 === activeTab);
      });
    },

    renderCalendar() {
      const { viewYear: y, viewMonth: m } = this.state;
      this.calMonth.textContent = `${this.MONTHS[m]} ${y}`;
      this.calGrid.innerHTML = '';
      this.DOWS.forEach(d => {
        const el = document.createElement('div');
        el.className = 'dow'; el.textContent = d;
        this.calGrid.appendChild(el);
      });
      const firstDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < firstDow; i++)
        this.calGrid.appendChild(document.createElement('div'));

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d);
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'cal-day'; btn.textContent = d;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isPast = date <= this.today;
        const iso = BookingsAPI.toISO(date);
        const inWindow = !this.BOOK_WINDOW ||
          (iso >= this.BOOK_WINDOW.start && iso <= this.BOOK_WINDOW.end);
        const isFull = !isWeekend && !isPast && inWindow && !this.dayHasSpace(date);
        if (isFull) btn.classList.add('full');
        if (isWeekend || isPast || isFull || !inWindow) btn.disabled = true;
        else btn.addEventListener('click', () => this.pickDay(date, btn));
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
      setTimeout(() => this.showPane(2), 160);
    },

    renderSlots() {
      const grid = document.getElementById('slotGrid');
      grid.innerHTML = '';
      this.timesFor(this.state.selectedDate).forEach(t => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'slot'; b.textContent = t;
        const left = this.seatsLeft(this.state.selectedDate, t);
        if (left <= 0) {
          b.disabled = true; b.classList.add('taken');
          b.textContent = t + ' \u2014 fully booked';
          grid.appendChild(b); return;
        }
        if (this.CAPACITY > 1 && left < this.CAPACITY) {
          const s = document.createElement('span');
          s.className = 'seats';
          s.textContent = `${left} of ${this.CAPACITY} seats left`;
          b.appendChild(s);
        }
        b.addEventListener('click', () => {
          grid.querySelectorAll('.slot.selected').forEach(s => s.classList.remove('selected'));
          b.classList.add('selected');
          this.state.selectedTime = t;
          document.getElementById('pickedSlot').textContent =
            `${this.fmtDate(this.state.selectedDate)} \u00b7 ${t}`;
          setTimeout(() => this.showPane(3), 160);
        });
        grid.appendChild(b);
      });
    },

    validate() {
      let ok = true;
      const check = (id, test, required = true) => {
        const input = document.getElementById(id);
        if (!input) return;
        const field = input.closest('.field');
        if (field.classList.contains('hidden') && !required) return;
        const valid = test(input.value.trim());
        field.classList.toggle('invalid', !valid);
        if (!valid) ok = false;
      };
      check('name',  v => v.length >= 2);
      if (this.kind === 'intro') {
        check('phone', v => v.replace(/[^0-9]/g,'').length >= 7);
        check('email', v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      } else {
        check('email', v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      }
      return ok;
    },

    newToken() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
      });
    },

    async submit(e) {
      e.preventDefault();
      if (!this.validate()) return;
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const oldLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Confirming\u2026'; }

      const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
      const token = this.newToken();
      const day = BookingsAPI.toISO(this.state.selectedDate);
      const rows = this.unitsFor(this.state.selectedTime).map(u => ({
        day, slot: u,
        kind: this.kind,
        mode: this.state.meetingType,
        name: val('name'),
        email: val('email') || null,
        phone: val('phone') || null,
        notes: val('notes') || null,
        manage_token: token
      }));

      const res = await BookingsAPI.create(rows);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldLabel; }

      if (res.dupe) {
        await this.refreshBooked();
        this.showPane(2);
        const note = document.createElement('p');
        note.className = 'slot-note';
        note.textContent = 'That time was claimed a moment ago \u2014 the calendar has refreshed, please pick another.';
        const grid = document.getElementById('slotGrid');
        grid.parentElement.insertBefore(note, grid);
        setTimeout(() => note.remove(), 6000);
        return;
      }

      const manageUrl = new URL('book.html', location.href);
      manageUrl.searchParams.set('manage', token);

      const what = this.kind === 'intro'
        ? `20-minute ${this.state.meetingType.toLowerCase()}`
        : `${this.state.meetingType.toLowerCase()} onboarding session`;

      if (res.ok) {
        BookingsAPI.sendConfirmation({
          name: val('name'), email: val('email'),
          day, slot: this.state.selectedTime,
          mode: this.state.meetingType, kind: this.kind
        });
      }
      BookingsAPI.notify(this.kind === 'intro' ? 'intro' : 'onboarding', {
        _subject: `New ${this.kind} booking \u2014 ${day} ${this.state.selectedTime} (${this.state.meetingType})`,
        ...rows[0],
        manage_link: manageUrl.href
      });

      document.getElementById('confirmText').textContent =
        `${val('name')}, your ${what} is set for ` +
        `${this.fmtDate(this.state.selectedDate)} at ${this.state.selectedTime}.` +
        (res.ok ? '' : ' (Our booking system had a hiccup \u2014 we\u2019ll confirm by email.)');

      const change = document.getElementById('changeText');
      if (change) change.innerHTML =
        'Need to change it? Email <a href="mailto:support@greylocktrust.com">support@greylocktrust.com</a> ' +
        'and we\u2019ll release your time \u2014 then simply rebook whichever new slot suits you.';

      this.showPane(4);
    },

    /* ---------- stage 2: ?manage=<token> ---------- */
    async initManage() {
      const token = new URLSearchParams(location.search).get('manage');
      const panel = document.getElementById('managePanel');
      if (!token || !panel) return;
      panel.style.display = 'block';
      const body = document.getElementById('manageBody');
      body.textContent = 'Looking up your booking\u2026';

      const rows = await BookingsAPI.rpc('get_booking', { t: token });
      if (!rows || !rows.length) {
        body.textContent = 'We couldn\u2019t find that booking \u2014 it may already be cancelled. ' +
          'Email support@greylocktrust.com and we\u2019ll sort it out.';
        return;
      }
      const kind = rows[0].kind === 'intro' ? '20-minute call' : 'Onboarding session';
      const d = new Date(rows[0].day + 'T12:00:00');
      const times = rows.map(r => r.slot);
      body.innerHTML =
        `<strong>${kind}</strong> \u2014 ${this.fmtDate(d)} at ${times[0]} (${rows[0].mode})`;
      const btn = document.getElementById('manageCancel');
      btn.style.display = 'inline-flex';
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Cancelling\u2026';
        const ok = await BookingsAPI.rpc('cancel_booking', { t: token });
        btn.style.display = 'none';
        body.innerHTML = ok !== null
          ? 'Your booking is cancelled and the time is released. ' +
            'Pick a new time below whenever suits you \u2014 or email ' +
            '<a href="mailto:support@greylocktrust.com">support@greylocktrust.com</a> if we can help.'
          : 'Something went wrong \u2014 please email support@greylocktrust.com and we\u2019ll cancel it for you.';
        this.refreshBooked();
      }, { once: true });
    }
  };;

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

    async submit(e) {
      e.preventDefault();
      if (!this.validate()) return;

      const submitBtn = this.form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending\u2026'; }

      const topicEl = document.getElementById('ctopic');
      const msg = {
        name:    document.getElementById('cname').value.trim(),
        email:   document.getElementById('cemail').value.trim(),
        topic:   topicEl ? topicEl.value : null,
        message: document.getElementById('cmessage').value.trim()
      };
      // 1) into your database inbox…
      const saved = await BookingsAPI.insert('support_messages', msg);
      // 2) …and by email once Formspree is configured
      const mailed = await BookingsAPI.notify('support',
        { _subject: 'Support message from the website', ...msg });
      const res = { ok: saved.ok || mailed.ok, skipped: mailed.skipped && saved.ok };
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send message'; }

      const name = document.getElementById('cname').value.trim().split(' ')[0];
      document.getElementById('contactConfirm').textContent =
        (res.ok || res.skipped)
          ? `Thank you, ${name} \u2014 your message is on its way. A member of the team will reply within one business day.`
          : `${name}, something went wrong sending your message \u2014 please email support@greylocktrust.com directly and we\u2019ll take it from there.`;
      this.form.style.display = 'none';
      document.getElementById('contactSuccess').classList.add('active');
    }
  };

  /* ==========================================================
     9. INTRO CALL — phone request form
     ========================================================== */
  const IntroCall = {
    callType: 'Phone call',

    init() {
      this.form = document.getElementById('introForm');
      if (!this.form) return;
      this.form.addEventListener('submit', e => this.submit(e));

      // phone / video toggle — video reveals the email field
      const segButtons = [...this.form.querySelectorAll('.seg-btn')];
      const emailField = document.getElementById('emailField');
      segButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          segButtons.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.callType = btn.dataset.value;
          const video = this.callType === 'Video call';
          emailField.classList.toggle('hidden', !video);
          if (!video) emailField.classList.remove('invalid');
        });
      });
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
      // exact date: future weekday
      check('idate', v => {
        if (!v) return false;
        const d = new Date(v + 'T12:00:00');
        return d > new Date() && d.getDay() !== 0 && d.getDay() !== 6;
      });
      check('itime', v => v !== '' && v !== 'Choose a time…');
      // lenient phone check: 7-15 digits once separators are stripped
      check('iphone', v => {
        const digits = v.replace(/[^0-9]/g, '');
        return digits.length >= 7 && digits.length <= 15;
      });
      // email only required when a video call is chosen
      if (this.callType === 'Video call') {
        check('iemail', v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      }
      return ok;
    },

    async submit(e) {
      e.preventDefault();
      if (!this.validate()) return;

      const submitBtn = this.form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Requesting\u2026'; }

      const payload = {
        day:  document.getElementById('idate').value,
        slot: document.getElementById('itime').value,
        kind: 'intro',
        mode: this.callType,
        name:  document.getElementById('iname').value.trim(),
        phone: document.getElementById('iphone').value.trim(),
        email: this.callType === 'Video call'
                 ? document.getElementById('iemail').value.trim() : null,
        notes: document.getElementById('inotes').value.trim() || null
      };
      const res = await BookingsAPI.create(payload);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request my call'; }

      if (res.dupe) {
        const t = document.getElementById('itime');
        const f = t.closest('.field');
        f.classList.add('invalid');
        f.querySelector('.field-error').textContent =
          'That time was just booked \u2014 please choose another.';
        return;
      }
      BookingsAPI.notify('intro', {
        _subject: `New 20-min intro call \u2014 ${payload.day} ${payload.slot} (${payload.mode})`,
        ...payload
      });

      const name = document.getElementById('iname').value.trim().split(' ')[0];
      const when = document.getElementById('itime').value.toLowerCase();
      const window_ = when === 'any time is fine'
        ? 'at a convenient time'
        : `in the ${when.replace(/ \(.*\)/, '')}`;
      const how = this.callType === 'Video call'
        ? `email your video link and call you ${window_} within one business day`
        : `call you ${window_} within one business day`;
      document.getElementById('introConfirm').textContent =
        `Thank you, ${name} — an advisor will ${how}.`;
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

/* ============================================================
   MobileNav — hamburger menu, self-building on every page.
   No markup required: the button and panel are created from
   whatever links this page's nav actually contains.
   ============================================================ */
(function () {
  'use strict';
  function initMobileNav() {
  const navInner = document.querySelector('.site-nav .nav-inner');
  const links = document.querySelector('.site-nav .nav-links');
  if (!navInner || !links) return;

  /* button: reuse one if the page already has it, else build it */
  let burger = document.getElementById('navBurger');
  if (!burger) {
    burger = document.createElement('button');
    burger.id = 'navBurger';
    burger.className = 'nav-burger';
    burger.setAttribute('aria-label', 'Menu');
    burger.innerHTML =
      '<svg class="bars" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      '<svg class="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    navInner.appendChild(burger);
  }

  /* panel: rebuild fresh from the live nav so it always matches */
  let menu = document.getElementById('mobileMenu');
  if (menu) menu.remove();
  menu = document.createElement('div');
  menu.id = 'mobileMenu';
  menu.className = 'mobile-menu';

  links.querySelectorAll('a:not(.btn)').forEach(a => {
    const copy = a.cloneNode(true);
    copy.classList.remove('active');
    menu.appendChild(copy);
  });
  const actions = document.createElement('div');
  actions.className = 'mm-actions';
  links.querySelectorAll('a.btn').forEach(b => actions.appendChild(b.cloneNode(true)));
  if (actions.children.length) menu.appendChild(actions);

  document.querySelector('.site-nav').insertAdjacentElement('afterend', menu);

  /* behavior */
  burger.addEventListener('click', () =>
    document.body.classList.toggle('menu-open'));
  menu.addEventListener('click', e => {
    if (e.target.closest('a')) document.body.classList.remove('menu-open');
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) document.body.classList.remove('menu-open');
  });
  }
  /* run whether the script loads in <head> or at the end of <body> */
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initMobileNav);
  else
    initMobileNav();
})();


/* intro-call: constrain the date picker to tomorrow onward */
(function(){
  'use strict';
  const d = document.getElementById('idate');
  if (!d) return;
  const t = new Date(); t.setDate(t.getDate() + 1);
  d.min = t.toISOString().split('T')[0];
})();