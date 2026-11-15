import { mountLanguageSwitch, t, translatePage } from '/static/i18n.js';
import { mountRoomList } from '/static/room-list.js';
import { forgetAllRooms, randomKey, rememberRoom, roomLink } from '/static/rooms-local.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();
mountLanguageSwitch();

let ticket = null;

const showSignedIn = (user) => {
  // Servidor que exige 2FA: quem ainda não configurou vai direto para a conta
  if (user.needs2fa) return location.replace('/conta');
  $('login-view').hidden = true;
  $('signed-in').hidden = false;
  $('me').textContent = user.username;
  $('recommend-2fa').hidden = user.totp;
  $('admin-link').hidden = user.role !== 'admin';
  mountRoomList({ isAdmin: user.role === 'admin' });
  if (user.role === 'admin') {
    showUpdateNotice();
    showUsageNotice();
  }
};

// Franquia de dados do mês passando de 80%
const showUsageNotice = async () => {
  try {
    const usage = await api('/api/admin/usage');
    if (!usage.warning) return;
    $('usage-notice').textContent = t('Este mês o servidor já usou {percent}% da franquia de dados do plano.', usage);
    $('usage-notice').hidden = false;
  } catch {}
};

// Versão nova publicada: o admin vê o aviso aqui e os passos para atualizar em /admin
const showUpdateNotice = async () => {
  try {
    const update = await api('/api/admin/update');
    if (!update.available) return;
    $('update-notice').textContent = t('Versão {version} disponível: veja como atualizar.', { version: update.latest });
    $('update-notice').hidden = false;
  } catch {}
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
$('signup-link').hidden = state.signup === 'invite';
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
  $('login-view').hidden = false;
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

// --- criar sala: janela com os dois tipos -------------------------------------------

const dialog = $('create-dialog');
const openCreate = () => {
  $('create-error').hidden = true;
  dialog.showModal();
};
$('new-room').addEventListener('click', openCreate);
$('new-room-side').addEventListener('click', openCreate);
$('create-close').addEventListener('click', () => dialog.close());
// Clique fora do conteúdo (no fundo escurecido) fecha a janela
dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

for (const card of dialog.querySelectorAll('.type-card')) {
  card.addEventListener('click', async () => {
    const type = card.dataset.type;
    $('create-error').hidden = true;
    for (const c of dialog.querySelectorAll('.type-card')) c.disabled = true;
    try {
      const data = await api('/api/rooms', {
        type,
        ...(type === 'together' && { openScreens: $('open-screens').checked }),
        ...(state.sso && { requireSso: $('require-sso').checked }),
        private: $('private-room').checked,
      });
      // A chave E2EE é gerada aqui e vai só no fragmento (#) da URL: nunca chega ao servidor.
      const room = { code: data.roomId, k: randomKey(), h: data.hostKey, type };
      // Sala privada não fica na lista deste navegador
      if (!data.private) rememberRoom(room);
      location.href = roomLink(room);
    } catch (err) {
      if (err.status === 401) location.reload();
      else showError($('create-error'), err);
      for (const c of dialog.querySelectorAll('.type-card')) c.disabled = false;
    }
  });
}

// Vindo da gaveta da sala ("Criar sala"): abre a janela de criar direto
if (location.hash === '#criar' && !$('signed-in').hidden) {
  history.replaceState(null, '', '/');
  openCreate();
}

$('logout').addEventListener('click', async () => {
  if ($('forget-on-logout').checked) forgetAllRooms();
  await api('/api/logout', {}).catch(() => {});
  location.reload();
});
