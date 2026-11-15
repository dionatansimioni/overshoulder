import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

const state = await api('/api/state');
if (state.setupDone) location.replace('/');

// Três passos no mesmo formulário: os campos continuam preenchidos ao voltar, e cada passo é uma
// entrada no histórico (#passo-2), então o Voltar do navegador também funciona.
const LAST = 3;
let step = 1;
let reached = 1;

const show = (n) => {
  step = n;
  for (const fs of document.querySelectorAll('fieldset.step')) {
    const current = Number(fs.dataset.step) === n;
    fs.hidden = !current;
    fs.disabled = !current;
  }
  for (const li of document.querySelectorAll('.steps li')) {
    const s = Number(li.dataset.step);
    li.classList.toggle('done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  $('step-status').textContent = t('Passo {n} de {total}', { n, total: LAST });
  $('back').hidden = n === 1;
  $('next').textContent = t(n === LAST ? 'Criar administrador' : 'Continuar');
  $('setup-error').hidden = true;
  document.querySelector(`fieldset[data-step="${n}"] input`)?.focus();
};

const go = (n) => {
  reached = Math.max(reached, n);
  history.pushState({ step: n }, '', `#passo-${n}`);
  show(n);
};

// Voltar e avançar do navegador: só até o passo já alcançado
addEventListener('popstate', () => {
  const n = Number(/^#passo-(\d)$/.exec(location.hash)?.[1] ?? 1);
  show(Math.min(Math.max(n, 1), reached));
});
// Recarregar a página no meio começa do primeiro passo (os campos podem ter sido limpos)
history.replaceState({ step: 1 }, '', location.pathname);
show(1);

$('back').addEventListener('click', () => history.back());

// Volta ao passo do campo que precisa mudar e mostra o erro lá
const fail = (n, message) => {
  if (step !== n) {
    history.replaceState({ step: n }, '', `#passo-${n}`);
    show(n);
  }
  showError($('setup-error'), message);
};

// Código errado ou tentativas demais: passo 1; limite de pessoas: passo 3; o resto é da conta
const stepFor = (err) => {
  if (err.status === 403 || err.status === 429) return 1;
  if (/^(Limite de pessoas|People per room)/.test(err.message)) return 3;
  return step === 1 ? 1 : 2;
};

// Confere o passo atual antes de seguir; o servidor confere tudo de novo no fim
const checkStep = async () => {
  if (step === 1) {
    if (!$('code').value.trim()) return fail(1, t('Informe o código de configuração.'));
    await api('/api/setup/check', { code: $('code').value });
    return true;
  }
  if (step === 2) {
    if (!$('username').value.trim()) return fail(2, t('Informe o usuário do administrador.'));
    if ($('password').value.length < 12) return fail(2, t('A senha precisa de pelo menos 12 caracteres.'));
    if ($('password').value !== $('password2').value) return fail(2, t('As senhas não são iguais.'));
    return true;
  }
  return true;
};

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('setup-error').hidden = true;
  busy(e.target, async () => {
    try {
      if (!(await checkStep())) return;
      if (step < LAST) return go(step + 1);
      await api('/api/setup', {
        code: $('code').value,
        username: $('username').value,
        password: $('password').value,
        maxParticipants: Number($('max').value),
      });
      location.replace('/');
    } catch (err) {
      fail(stepFor(err), err.message);
    }
  });
});
