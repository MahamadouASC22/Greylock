/* ============================================================
   GREYLOCK TRUST — auth.js
   Account system built on Supabase Auth.
   - Passwords & sessions are handled entirely by Supabase.
   - This file only builds the screens around their machinery.
   Load AFTER the supabase-js CDN script.

   how to change deployment url on cloudflare 
   we have greylock.pages.dev that im pretty sure is being trnasferred to the custom domain but im not completely sure
   ============================================================ */

'use strict';

/* ---------- configuration ---------- */
const SUPABASE_URL = 'https://otjanvfidvyfhhvteedp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90amFudmZpZHZ5ZmhodnRlZWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTQzNDUsImV4cCI6MjA5OTA5MDM0NX0.Rv8pvoALDawrvxn-xpYaJCpZLFHO0eYi4DL6gSOKAFo';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);

function showMsg(id, text, kind) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'form-msg ' + (kind || 'error');
  el.style.display = 'block';
}
function hideMsg(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}
function pageUrl(file) {
  return new URL(file, window.location.href).href;
}
function friendlyError(err) {
  const m = (err && err.message) || 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(m)) return 'That email and password don\u2019t match our records.';
  if (/rate limit/i.test(m)) return 'Too many attempts \u2014 please wait a moment and try again.';
  if (/already registered/i.test(m)) return 'An account with this email already exists. Try signing in instead.';
  return m;
}

/* ---------- session / guard helpers ---------- */
async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

async function mfaStatus() {
  // currentLevel: what this session has proven; nextLevel: what the account can prove
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return { needsCode: false };
  return {
    needsCode: data.nextLevel === 'aal2' && data.currentLevel !== 'aal2',
    currentLevel: data.currentLevel
  };
}

/* Pages that require a signed-in (and fully verified) user call this. */
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.replace('sign-in.html');
    return null;
  }
  const { needsCode } = await mfaStatus();
  if (needsCode) {
    // signed in with password only, but account has 2FA — finish it on the sign-in page
    window.location.replace('sign-in.html?step=code');
    return null;
  }
  return session;
}

async function listTotpFactor() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error || !data) return null;
  return (data.totp && data.totp[0]) || null;
}

/* ============================================================
   SIGN UP PAGE
   ============================================================ */
async function initSignUp() {
  const form = $('signupForm');
  if (!form) return;

  // already signed in? go to the dashboard
  if (await getSession() && !(await mfaStatus()).needsCode) {
    window.location.replace('dashboard.html');
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('signupMsg');

    const name = $('suname').value.trim();
    const email = $('suemail').value.trim();
    const pass = $('supass').value;
    const pass2 = $('supass2').value;

    if (name.length < 2) return showMsg('signupMsg', 'Please enter your name.');
    if (pass.length < 10) return showMsg('signupMsg', 'Please choose a password of at least 10 characters.');
    if (pass !== pass2) return showMsg('signupMsg', 'Those passwords don\u2019t match.');

    const btn = $('signupBtn');
    btn.disabled = true; btn.textContent = 'Creating your account\u2026';

    const { error } = await sb.auth.signUp({
      email,
      password: pass,
      options: {
        emailRedirectTo: pageUrl('sign-in.html'),
        data: { full_name: name }
      }
    });

    btn.disabled = false; btn.textContent = 'Create my account';
    if (error) return showMsg('signupMsg', friendlyError(error));

    form.style.display = 'none';
    $('signupSuccess').classList.add('active');
    $('signupConfirmText').textContent =
      `We\u2019ve sent a confirmation link to ${email}. Click it to activate your account, then sign in.`;
  });
}

/* ============================================================
   SIGN IN PAGE — password, magic link, and the 2FA code step
   ============================================================ */
function showAuthPane(n) {
  ['authPane1', 'authPane2', 'authPane3'].forEach((id, i) => {
    const el = $(id);
    if (el) el.classList.toggle('active', i + 1 === n);
  });
}

async function initSignIn() {
  const form = $('signinForm');
  if (!form) return;

  // If a session already exists (including arriving from an email link):
  const session = await getSession();
  if (session) {
    const { needsCode } = await mfaStatus();
    if (needsCode) { showAuthPane(3); } else { window.location.replace('dashboard.html'); return; }
  }
  // arriving mid-2FA (e.g. redirected from a protected page)
  if (new URLSearchParams(location.search).get('step') === 'code' && session) {
    showAuthPane(3);
  }

  /* --- password sign-in --- */
  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('signinMsg');
    const email = $('siemail').value.trim();
    const pass = $('sipass').value;

    const btn = $('signinBtn');
    btn.disabled = true; btn.textContent = 'Signing in\u2026';
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    btn.disabled = false; btn.textContent = 'Sign in';

    if (error) return showMsg('signinMsg', friendlyError(error));

    const { needsCode } = await mfaStatus();
    if (needsCode) showAuthPane(3);
    else window.location.replace('dashboard.html');
  });

  /* --- magic link --- */
  const magicToggle = $('magicToggle');
  if (magicToggle) magicToggle.addEventListener('click', () => showAuthPane(2));
  const backToPass = $('backToPassword');
  if (backToPass) backToPass.addEventListener('click', () => showAuthPane(1));

  const magicForm = $('magicForm');
  if (magicForm) magicForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('magicMsg');
    const email = $('mlemail').value.trim();
    const btn = $('magicBtn');
    btn.disabled = true; btn.textContent = 'Sending\u2026';
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: pageUrl('sign-in.html') }
    });
    btn.disabled = false; btn.textContent = 'Email me a secure link';
    if (error) return showMsg('magicMsg', friendlyError(error));
    showMsg('magicMsg', `Link sent to ${email} \u2014 check your inbox and click it on this device.`, 'success');
  });

  /* --- 2FA code step --- */
  const codeForm = $('codeForm');
  if (codeForm) codeForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('codeMsg');
    const code = $('sicode').value.trim();
    const factor = await listTotpFactor();
    if (!factor) return showMsg('codeMsg', 'No authenticator found on this account.');

    const btn = $('codeBtn');
    btn.disabled = true; btn.textContent = 'Verifying\u2026';
    const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: factor.id });
    if (chErr) { btn.disabled = false; btn.textContent = 'Verify'; return showMsg('codeMsg', friendlyError(chErr)); }
    const { error: vErr } = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code });
    btn.disabled = false; btn.textContent = 'Verify';
    if (vErr) return showMsg('codeMsg', 'That code didn\u2019t match \u2014 check your authenticator app and try again.');
    window.location.replace('dashboard.html');
  });
}

/* ============================================================
   ACCOUNT PAGE — profile, 2FA enrollment & removal, sign out
   ============================================================ */
async function initAccount() {
  if (!$('accountRoot')) return;
  const session = await requireAuth();
  if (!session) return;

  const user = session.user;
  $('accName').textContent = (user.user_metadata && user.user_metadata.full_name) || 'Client';
  $('accEmail').textContent = user.email;

  const factor = await listTotpFactor();
  renderMfaState(!!factor && factor.status === 'verified');

  /* --- start enrollment --- */
  $('mfaEnrollBtn').addEventListener('click', async () => {
    hideMsg('mfaMsg');
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
    if (error) return showMsg('mfaMsg', friendlyError(error));

    window._enrollingFactorId = data.id;
    const qr = data.totp.qr_code;
    $('mfaQr').src = qr.startsWith('data:') ? qr
      : 'data:image/svg+xml;utf8,' + encodeURIComponent(qr);
    $('mfaSecret').textContent = data.totp.secret;
    $('mfaSetup').style.display = 'block';
    $('mfaEnrollBtn').style.display = 'none';
  });

  /* --- confirm enrollment --- */
  $('mfaConfirmForm').addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('mfaMsg');
    const code = $('mfaCode').value.trim();
    const factorId = window._enrollingFactorId;
    const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId });
    if (chErr) return showMsg('mfaMsg', friendlyError(chErr));
    const { error: vErr } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (vErr) return showMsg('mfaMsg', 'That code didn\u2019t match \u2014 try the current code from your app.');
    $('mfaSetup').style.display = 'none';
    renderMfaState(true);
    showMsg('mfaMsg', 'Two-factor authentication is now protecting your account.', 'success');
  });

  /* --- remove 2FA (requires a current code) --- */
  $('mfaRemoveForm').addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg('mfaMsg');
    const code = $('mfaRemoveCode').value.trim();
    const f = await listTotpFactor();
    if (!f) return;
    // prove possession before allowing removal
    const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: f.id });
    if (chErr) return showMsg('mfaMsg', friendlyError(chErr));
    const { error: vErr } = await sb.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code });
    if (vErr) return showMsg('mfaMsg', 'That code didn\u2019t match \u2014 removal cancelled.');
    const { error: uErr } = await sb.auth.mfa.unenroll({ factorId: f.id });
    if (uErr) return showMsg('mfaMsg', friendlyError(uErr));
    renderMfaState(false);
    showMsg('mfaMsg', 'Two-factor authentication removed. You can re-enroll a new device any time.', 'success');
  });

  $('signOutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.replace('sign-in.html');
  });
}

function renderMfaState(enabled) {
  $('mfaOn').style.display = enabled ? 'block' : 'none';
  $('mfaOff').style.display = enabled ? 'none' : 'block';
  $('mfaEnrollBtn').style.display = enabled ? 'none' : 'inline-flex';
}

/* ============================================================
   DASHBOARD PAGE — gated shell
   ============================================================ */
async function initDashboard() {
  if (!$('dashRoot')) return;
  const session = await requireAuth();
  if (!session) return;

  const name = (session.user.user_metadata && session.user.user_metadata.full_name) || '';
  $('dashGreeting').textContent = name ? `Welcome back, ${name.split(' ')[0]}.` : 'Welcome back.';
  $('dashRoot').style.visibility = 'visible';

  $('dashSignOut').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.replace('sign-in.html');
  });
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initSignUp();
  initSignIn();
  initAccount();
  initDashboard();
});

