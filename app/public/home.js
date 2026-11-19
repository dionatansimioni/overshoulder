import { lang, mountLanguageSwitch, t, translatePage } from '/static/i18n.js';
import { mountRoomList } from '/static/room-list.js';
import { forgetAllRooms, randomKey, rememberRoom, roomLink } from '/static/rooms-local.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();
mountLanguageSwitch();

let ticket = null;
// /login: o formulário de entrar, mesmo quando a página inicial não o mostra (servidor só por convite)
const loginPage = location.pathname === '/login';

// Salvar a senha: o usuário fica neste navegador e a senha vai para o gerenciador de senhas dele
// (o servidor nunca guarda nada no navegador além do cookie de sessão)
const REMEMBER_KEY = 'login-username';
const remembered = (() => {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
})();
const rememberLogin = (username, password) => {
  try {
    if ($('remember').checked) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {}
  if ($('remember').checked && window.PasswordCredential) {
    navigator.credentials.store(new PasswordCredential({ id: username, password, name: username })).catch(() => {});
  }
};
const prefillLogin = () => {
  if (!remembered) return;
  $('username').value = remembered;
  if (!window.PasswordCredential) return;
  // Sem janela: só preenche se o navegador já tem a senha guardada e liberada para este site
  navigator.credentials
    .get({ password: true, mediation: 'silent' })
    .then((cred) => {
      if (cred?.password && cred.id === $('username').value && !$('password').value) $('password').value = cred.password;
    })
    .catch(() => {});
};

const showSignedIn = (user) => {
  // Servidor que exige 2FA: quem ainda não configurou vai direto para a conta
  if (user.needs2fa) return location.replace('/account');
  $('login-view').hidden = true;
  $('private-view').hidden = true;
  $('signed-in').hidden = false;
  if (loginPage) history.replaceState(null, '', '/');
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
  location.replace('/setup');
} else if (state.user) {
  showSignedIn(state.user);
} else if (state.signup === 'invite' && !loginPage && !ssoError) {
  // Servidor particular: nada de formulário na página inicial (menos tentativas de senha e de cadastro)
  $('own-server').href = `https://dionatansimioni.github.io/overshoulder/${lang === 'pt-BR' ? 'pt-br/' : ''}`;
  $('private-view').hidden = false;
} else {
  $('login-view').hidden = false;
  $('login-form').hidden = false;
  prefillLogin();
}
if (ssoError) showError($('login-error'), t(SSO_ERRORS[ssoError] ?? SSO_ERRORS.falhou));

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('login-error').hidden = true;
  busy(e.target, async () => {
    try {
      const username = $('username').value;
      const password = $('password').value;
      const result = await api('/api/login', { username, password });
      rememberLogin(username, password);
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

// Menu Configurações (Minha conta e Administração): abre para cima, fecha com Esc ou clique fora
const menu = $('settings-menu');
const menuBtn = $('settings-menu-btn');
const toggleMenu = (open) => {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('a:not([hidden])')?.focus();
};
menuBtn.addEventListener('click', () => toggleMenu(menu.hidden));
document.addEventListener('click', (e) => !menu.hidden && !menu.parentElement.contains(e.target) && toggleMenu(false));
document.addEventListener('keydown', (e) => {
  if (menu.hidden) return;
  if (e.key === 'Escape') {
    toggleMenu(false);
    menuBtn.focus();
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...menu.querySelectorAll('a:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
});

$('logout').addEventListener('click', async () => {
  if ($('forget-on-logout').checked) forgetAllRooms();
  await api('/api/logout', {}).catch(() => {});
  location.reload();
});
