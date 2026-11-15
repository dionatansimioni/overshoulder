import { lang, t } from '/static/i18n.js';

// Chamada à API do próprio site: GET sem corpo, POST com JSON. Erros viram exceção com a mensagem do
// servidor, que responde no idioma da página.
export const api = async (path, body) => {
  const headers = { 'Accept-Language': lang };
  const res = await fetch(
    path,
    body === undefined
      ? { headers }
      : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? t('Erro inesperado. Tente de novo.'));
    err.status = res.status;
    throw err;
  }
  return data;
};

export const $ = (id) => document.getElementById(id);

export const showError = (el, err) => {
  el.textContent = err?.message ?? t(String(err));
  el.hidden = false;
};

// Desabilita o botão do formulário enquanto a ação roda
export const busy = async (form, fn) => {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
};

// Copia o texto e mostra "Copiado!" no botão; sem acesso à área de transferência, seleciona o campo
export const copyText = async (text, button, input) => {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = t('Copiado!');
    setTimeout(() => (button.textContent = label), 1500);
  } catch {
    input?.select();
  }
};
