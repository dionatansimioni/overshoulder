import { mountLanguageSwitch, t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();
mountLanguageSwitch();

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

// Mensagens de volta do login corporativo
const SSO_ERRORS = {
  sem_permissao: 'Login feito, mas sua conta da empresa não tem permissão para transmitir. Peça ao administrador.',
  dominio: 'O e-mail da sua conta não pertence a um domínio permitido neste servidor.',
  falhou: 'Não foi possível concluir o login da empresa. Tente de novo.',
  expirou: 'O login da empresa expirou. Tente de novo.',
  cancelado: 'O login da empresa foi cancelado.',
  provedor: 'O provedor de login da empresa não respondeu. Tente mais tarde.',
  desligado: 'O login da empresa está desligado neste servidor.',
};
const ssoError = new URLSearchParams(location.search).get('erro_sso');
if (ssoError) history.replaceState(null, '', '/');

const state = await api('/api/state');
$('sso-login').hidden = !state.sso;
if (state.sso) {
  $('require-sso-row').hidden = false;
  $('require-sso').checked = state.sso.forceRooms || state.sso.roomsDefault;
  $('require-sso').disabled = state.sso.forceRooms;
}
if (!state.setupDone) {
  location.replace('/configurar');
} else if (state.user) {
  showSignedIn(state.user);
} else {
  $('login-form').hidden = false;
}
if (ssoError) showError($('login-error'), t(SSO_ERRORS[ssoError] ?? SSO_ERRORS.falhou));

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
      const type = document.querySelector('input[name="room-type"]:checked').value;
      const data = await api('/api/rooms', {
        type,
        ...(type === 'together' && { openScreens: $('open-screens').checked }),
        ...(state.sso && { requireSso: $('require-sso').checked }),
      });
      // A chave E2EE é gerada aqui e vai só no fragmento (#) da URL: nunca chega ao servidor.
      const params = new URLSearchParams({ k: randomKey(), h: data.hostKey });
      location.href = `/r/${data.roomId}#${params}`;
    } catch (err) {
      if (err.status === 401) location.reload();
      else showError($('create-error'), err);
    }
  });
});

// "Qualquer um pode mostrar a tela" só faz sentido na sala Jogando juntos
for (const radio of document.querySelectorAll('input[name="room-type"]')) {
  radio.addEventListener('change', () => {
    $('open-screens-row').hidden = !$('type-together').checked;
  });
}

$('logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  location.reload();
});
