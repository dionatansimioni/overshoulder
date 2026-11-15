import { mountLanguageSwitch, t, translatePage } from '/static/i18n.js';
import { forgetAllRooms, forgetRoom, getFixedKey, randomKey, recentRooms, rememberRoom, roomLink } from '/static/rooms-local.js';
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
  renderRooms();
  refreshStatus();
  setInterval(refreshStatus, 15_000);
  if (user.role === 'admin') loadFixedRooms();
};

// --- barra lateral: salas deste navegador e salas fixas ------------------------------

const TYPE_LABEL = { together: 'Jogando juntos', live: 'Live' };
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

const roomItem = ({ href, title, detail, live, onForget }) => {
  const li = document.createElement('li');
  const a = Object.assign(document.createElement('a'), { href, className: 'room-link' });
  const dot = Object.assign(document.createElement('span'), { className: `dot${live ? ' live' : ''}` });
  dot.title = t(live ? 'Ao vivo' : 'Fora do ar');
  const text = Object.assign(document.createElement('span'), { className: 'room-link-text' });
  text.append(
    Object.assign(document.createElement('b'), { textContent: title }),
    Object.assign(document.createElement('span'), { className: 'muted small', textContent: detail }),
  );
  a.append(dot, text);
  li.append(a);
  if (onForget) {
    const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'forget', textContent: '✕' });
    forget.setAttribute('aria-label', t('Esquecer {name}', { name: title }));
    forget.title = t('Esquecer esta sala neste navegador');
    forget.addEventListener('click', () => {
      forgetRoom(onForget);
      renderRooms();
    });
    li.append(forget);
  }
  return li;
};

let roomStatus = {};

const renderRooms = () => {
  // Salas encerradas somem da lista; as fixas e as que ainda não foram consultadas ficam
  const list = recentRooms().filter((r) => roomStatus[r.code]?.exists !== false);
  $('my-rooms').replaceChildren(
    ...list.map((r) => {
      const status = roomStatus[r.code];
      const parts = [t(TYPE_LABEL[r.type] ?? 'Sala')];
      parts.push(status?.online ? t('{n} pessoa(s) agora', { n: status.online }) : when(r.at));
      if (!r.h) parts.push(t('convidado'));
      return roomItem({
        href: roomLink(r),
        title: r.title ?? t(r.h ? 'Sua sala' : 'Sala de outra pessoa'),
        detail: parts.join(' · '),
        live: !!status?.online,
        onForget: r.code,
      });
    }),
  );
  $('no-rooms').hidden = list.length > 0;
};

const refreshStatus = async () => {
  const codes = recentRooms().map((r) => r.code);
  if (!codes.length) return;
  try {
    roomStatus = (await api('/api/rooms/status', { codes })).status;
  } catch {
    return;
  }
  for (const [code, s] of Object.entries(roomStatus)) if (!s.exists) forgetRoom(code);
  renderRooms();
};

// Salas fixas do admin: só as que têm a chave guardada neste navegador entram como anfitrião
const loadFixedRooms = async () => {
  const { rooms } = await api('/api/admin/rooms').catch(() => ({ rooms: [] }));
  const withKey = rooms.filter((r) => getFixedKey(r.id));
  $('fixed-section').hidden = rooms.length === 0;
  $('fixed-rooms').replaceChildren(
    ...withKey.map((r) =>
      roomItem({
        href: `/r/${r.roomId}#${new URLSearchParams({ k: getFixedKey(r.id), h: r.hostKey })}`,
        title: r.title,
        detail: [t(TYPE_LABEL[r.type]), r.online ? t('{n} pessoa(s) agora', { n: r.online }) : t('vazia')].join(' · '),
        live: r.online > 0,
      }),
    ),
  );
  if (withKey.length < rooms.length) {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = t('{n} sala(s) com a chave em outro navegador: veja em Administração.', { n: rooms.length - withKey.length });
    $('fixed-rooms').append(li);
  }
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

$('logout').addEventListener('click', async () => {
  if ($('forget-on-logout').checked) forgetAllRooms();
  await api('/api/logout', {}).catch(() => {});
  location.reload();
});
