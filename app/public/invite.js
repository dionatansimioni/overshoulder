import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

// /invite#<token>: convite do admin. /signup: cadastro sem convite, se o admin permitir.
const isSignup = location.pathname === '/signup';
// O convite vem no fragmento (#) e sai da barra de endereço, para não vazar num copiar/colar
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);

let mode = 'invite';
if (isSignup) {
  mode = (await api('/api/state')).signup;
  $('intro-invite').hidden = true;
  if (mode === 'invite') {
    $('signup-closed').hidden = false;
    $('invite-form').hidden = true;
  } else {
    $(`intro-${mode}`).hidden = false;
  }
} else if (!token) {
  showError($('invite-error'), 'Link de convite incompleto. Peça o link de novo.');
}

$('invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('invite-error').hidden = true;
  if ($('password').value !== $('password2').value) return showError($('invite-error'), t('As senhas não são iguais.'));
  busy(e.target, async () => {
    try {
      const credentials = { username: $('username').value, password: $('password').value };
      if (!isSignup) {
        await api('/api/invites/accept', { token, ...credentials });
        return location.replace('/');
      }
      const result = await api('/api/signup', credentials);
      if (!result.pending) return location.replace('/');
      $('invite-form').hidden = true;
      $(`intro-${mode}`).hidden = true;
      $('signup-done').hidden = false;
    } catch (err) {
      showError($('invite-error'), err);
    }
  });
});
