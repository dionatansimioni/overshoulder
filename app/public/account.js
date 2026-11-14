import { $, api, busy, showError } from '/static/ui.js';

const state = await api('/api/state');
if (!state.user) location.replace('/');

// Mostra o bloco certo do 2FA; com o 2FA exigido pelo servidor, ele não pode ser desativado
const render = (user) => {
  $('me').textContent = user.username;
  $('required-2fa').hidden = !user.needs2fa;
  $('twofa-off').hidden = user.totp || !$('enable-form').hidden;
  $('disable-form').hidden = !user.totp || state.require2fa;
  $('twofa-locked').hidden = !user.totp || !state.require2fa;
};

if (state.user) render(state.user);

$('start-2fa').addEventListener('click', async () => {
  const { secret, qr } = await api('/api/2fa/setup', {});
  $('qr').src = qr;
  $('secret').textContent = secret.match(/.{1,4}/g).join(' ');
  $('twofa-off').hidden = true;
  $('enable-form').hidden = false;
  $('enable-code').focus();
});

$('enable-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('enable-error').hidden = true;
  busy(e.target, async () => {
    try {
      const { recoveryCodes, user } = await api('/api/2fa/enable', { code: $('enable-code').value });
      $('enable-form').hidden = true;
      $('recovery').hidden = false;
      $('recovery-codes').replaceChildren(
        ...recoveryCodes.map((c) => Object.assign(document.createElement('li'), { textContent: c })),
      );
      render(user);
      // Logo depois de ativar, a tela mostra só os códigos de recuperação
      $('disable-form').hidden = true;
      $('twofa-locked').hidden = true;
    } catch (err) {
      showError($('enable-error'), err);
    }
  });
});

$('copy-recovery').addEventListener('click', async () => {
  const codes = [...$('recovery-codes').children].map((li) => li.textContent).join('\n');
  await navigator.clipboard.writeText(codes).catch(() => {});
  $('copy-recovery').textContent = 'Copiados!';
});

$('disable-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('disable-error').hidden = true;
  busy(e.target, async () => {
    try {
      const { user } = await api('/api/2fa/disable', { password: $('disable-password').value });
      $('disable-password').value = '';
      $('recovery').hidden = true;
      render(user);
    } catch (err) {
      showError($('disable-error'), err);
    }
  });
});

$('password-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('password-error').hidden = true;
  $('password-ok').hidden = true;
  if ($('new-password').value !== $('new-password2').value) {
    showError($('password-error'), 'As senhas novas não são iguais.');
    return;
  }
  busy(e.target, async () => {
    try {
      await api('/api/account/password', { current: $('current').value, password: $('new-password').value });
      e.target.reset();
      $('password-ok').hidden = false;
    } catch (err) {
      showError($('password-error'), err);
    }
  });
});
