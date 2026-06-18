// ═══════════════════════════════════════════════════════════════
// AUTH UI — Pantalla de login / registro, antes de mostrar la app
// ═══════════════════════════════════════════════════════════════

const AuthUI = (() => {
  let onLoggedIn = null;

  const eyeOpen = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOff  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.06M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  function render() {
    const root = document.getElementById('auth-root');
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-box">
          <div class="auth-logo">
            <div class="logo-mark">P</div>
            <span class="logo-name">Presupuesta<span class="logo-dot">.</span></span>
          </div>
          <div class="auth-tabs">
            <button class="auth-tab on" id="at-login" onclick="AuthUI.switchTab('login')">Iniciar sesión</button>
            <button class="auth-tab" id="at-signup" onclick="AuthUI.switchTab('signup')">Crear cuenta</button>
          </div>

          <div id="auth-form-login" class="auth-form">
            <div class="m-fld"><label class="m-lbl">Correo</label><input class="m-inp" type="email" id="li-email" placeholder="tu@correo.com" autocomplete="email" onkeydown="AuthUI.onEnter(event,'login')"></div>
            <div class="m-fld">
              <label class="m-lbl">Contraseña</label>
              <div class="pwd-wrap">
                <input class="m-inp" type="password" id="li-pass" placeholder="••••••••" autocomplete="current-password" onkeydown="AuthUI.onEnter(event,'login')">
                <button type="button" class="pwd-eye" onclick="AuthUI.toggleEye('li-pass',this)">${eyeOpen}</button>
              </div>
            </div>
            <div class="auth-err" id="li-err"></div>
            <button class="btn btn-g" style="width:100%;justify-content:center;margin-top:6px" onclick="AuthUI.login()">Entrar</button>
            <div class="auth-link" onclick="AuthUI.forgotPass()">¿Olvidaste tu contraseña?</div>
          </div>

          <div id="auth-form-signup" class="auth-form" style="display:none">
            <div class="m-fld"><label class="m-lbl">Tu nombre</label><input class="m-inp" type="text" id="su-name" placeholder="Ej: Juan" autocomplete="name" onkeydown="AuthUI.onEnter(event,'signup')"></div>
            <div class="m-fld"><label class="m-lbl">Correo</label><input class="m-inp" type="email" id="su-email" placeholder="tu@correo.com" autocomplete="email" onkeydown="AuthUI.onEnter(event,'signup')"></div>
            <div class="m-fld">
              <label class="m-lbl">Contraseña</label>
              <div class="pwd-wrap">
                <input class="m-inp" type="password" id="su-pass" placeholder="Mínimo 6 caracteres" autocomplete="new-password" onkeydown="AuthUI.onEnter(event,'signup')">
                <button type="button" class="pwd-eye" onclick="AuthUI.toggleEye('su-pass',this)">${eyeOpen}</button>
              </div>
            </div>
            <div class="m-fld">
              <label class="m-lbl">Confirmar contraseña</label>
              <div class="pwd-wrap">
                <input class="m-inp" type="password" id="su-pass2" placeholder="Repite la contraseña" autocomplete="new-password" onkeydown="AuthUI.onEnter(event,'signup')">
                <button type="button" class="pwd-eye" onclick="AuthUI.toggleEye('su-pass2',this)">${eyeOpen}</button>
              </div>
            </div>
            <div class="auth-err" id="su-err"></div>
            <button class="btn btn-g" style="width:100%;justify-content:center;margin-top:6px" onclick="AuthUI.signup()">Crear cuenta</button>
          </div>

          <div id="auth-confirm" class="auth-confirm" style="display:none">
            <div style="font-size:32px;margin-bottom:10px">📬</div>
            <div style="font-weight:700;margin-bottom:6px">Revisa tu correo</div>
            <div style="font-size:13px;color:var(--t2);line-height:1.6">Te enviamos un link de confirmación. Ábrelo para activar tu cuenta y poder iniciar sesión.</div>
          </div>
        </div>
      </div>`;
  }

  function onEnter(e, form) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (form === 'login') login(); else signup();
  }

  function switchTab(t) {
    document.getElementById('at-login').classList.toggle('on', t === 'login');
    document.getElementById('at-signup').classList.toggle('on', t === 'signup');
    document.getElementById('auth-form-login').style.display = t === 'login' ? '' : 'none';
    document.getElementById('auth-form-signup').style.display = t === 'signup' ? '' : 'none';
    document.getElementById('auth-confirm').style.display = 'none';
  }

  function toggleEye(inputId, btn) {
    const inp = document.getElementById(inputId);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = show ? eyeOff : eyeOpen;
  }

  function showErr(id, msg) { const e = document.getElementById(id); e.textContent = msg; }

  async function login() {
    showErr('li-err', '');
    const email = document.getElementById('li-email').value.trim();
    const password = document.getElementById('li-pass').value;
    if (!email || !password) { showErr('li-err', 'Completa ambos campos.'); return; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showErr('li-err', error.message.includes('Invalid') ? 'Correo o contraseña incorrectos.' : error.message);
      return;
    }
    if (onLoggedIn) onLoggedIn(data.session);
  }

  async function signup() {
    showErr('su-err', '');
    const name = document.getElementById('su-name').value.trim();
    const email = document.getElementById('su-email').value.trim();
    const password = document.getElementById('su-pass').value;
    const password2 = document.getElementById('su-pass2').value;
    if (!name || !email || !password || !password2) { showErr('su-err', 'Completa todos los campos.'); return; }
    if (password.length < 6) { showErr('su-err', 'La contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== password2) { showErr('su-err', 'Las contraseñas no coinciden.'); return; }
    const { error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (error) { showErr('su-err', error.message); return; }
    document.getElementById('auth-form-signup').style.display = 'none';
    document.getElementById('auth-confirm').style.display = 'block';
  }

  async function forgotPass() {
    const email = document.getElementById('li-email').value.trim();
    if (!email) { showErr('li-err', 'Escribe tu correo arriba primero.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email);
    showErr('li-err', error ? error.message : '✓ Te enviamos un link para restablecer tu contraseña.');
  }

  function init(callback) {
    onLoggedIn = callback;
    render();
  }

  return { init, switchTab, login, signup, forgotPass, toggleEye, onEnter };
})();
