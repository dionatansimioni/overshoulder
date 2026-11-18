import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (!token) showError($('reset-error'), 'Link incompleto. Gere outro com o comando no servidor.');

$('reset-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('reset-error').hidden = true;
  if ($('password').value !== $('password2').value) return showError($('reset-error'), 'As senhas não são iguais.');
  busy(e.target, async () => {
    try {
      await api('/api/admin-reset', { token, password: $('password').value });
      location.replace('/account');
    } catch (err) {
      showError($('reset-error'), err);
    }
  });
});
