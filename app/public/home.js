import { $, api, busy, showError } from '/static/ui.js';

const randomKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let ticket = null;

const showSignedIn = (user) => {
  // Servidor que exige 2FA: quem ainda não configurou vai direto para a conta
  if (user.needs2fa) return location.replace('/conta');
  $('login-form').hidden = true;
  $('totp-form').hidden = true;
  $('signed-in').hidden = false;
  $('me').textContent = user.username;
  $('recommend-2fa').hidden = user.totp;
  $('admin-link').hidden = user.role !== 'admin';
};

const state = await api('/api/state');
if (!state.setupDone) {
  location.replace('/configurar');
} else if (state.user) {
  showSignedIn(state.user);
} else {
  $('login-form').hidden = false;
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('login-error').hidden = true;
  busy(e.target, async () => {
    try {
      const result = await api('/api/login', { username: $('username').value, password: $('password').value });
      $('password').value = '';
      if (result.next === 'totp') {
        ticket = result.ticket;
        $('login-form').hidden = true;
        $('totp-form').hidden = false;
        $('totp-code').focus();
      } else {
        showSignedIn(result.user);
      }
    } catch (err) {
      showError($('login-error'), err);
    }
  });
});

$('totp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('totp-error').hidden = true;
  busy(e.target, async () => {
    try {
      const { user } = await api('/api/login/totp', { ticket, code: $('totp-code').value });
      showSignedIn(user);
    } catch (err) {
      $('totp-code').value = '';
      // Tíquete expirado ou tentativas demais: volta para a senha
      if (/expirou/.test(err.message)) {
        $('totp-form').hidden = true;
        $('login-form').hidden = false;
        showError($('login-error'), err);
      } else {
        showError($('totp-error'), err);
      }
    }
  });
});

$('create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('create-error').hidden = true;
  busy(e.target, async () => {
    try {
      const data = await api('/api/rooms', {});
      // A chave E2EE é gerada aqui e vai só no fragmento (#) da URL: nunca chega ao servidor.
      const params = new URLSearchParams({ k: randomKey(), h: data.hostKey });
      location.href = `/r/${data.roomId}#${params}`;
    } catch (err) {
      if (err.status === 401) location.reload();
      else showError($('create-error'), err);
    }
  });
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  location.reload();
});
