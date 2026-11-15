// Página do link de nova senha que o admin gera para um transmissor
import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

// O link sai da barra de endereço e do histórico assim que a página abre
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (!token) showError($('reset-error'), t('Link incompleto. Peça outro ao administrador.'));

$('reset-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('reset-error').hidden = true;
  if ($('password').value !== $('password2').value) return showError($('reset-error'), t('As senhas não são iguais.'));
  busy(e.target, async () => {
    try {
      await api('/api/password-reset', { token, password: $('password').value });
      $('reset-form').querySelectorAll('input, button').forEach((el) => (el.disabled = true));
      $('reset-ok').hidden = false;
      setTimeout(() => location.replace('/'), 2000);
    } catch (err) {
      showError($('reset-error'), err);
    }
  });
});
