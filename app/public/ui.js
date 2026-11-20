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

// App instalável: o service worker só mostra uma página própria quando o servidor não responde
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

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

// Copia o texto e mostra "Copiado!" no botão. A API moderna só existe em páginas seguras (HTTPS ou localhost) e
// pode ser negada; aí tenta o método antigo e, se ainda assim falhar, seleciona o texto e avisa no botão, para o
// usuário nunca achar que copiou quando a área de transferência ficou com outra coisa.
const copyFallback = (text) => {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
};

export const copyText = async (text, button, input) => {
  const label = button.textContent;
  let ok = false;
  try {
    // Sem permissão ou foco, o navegador pode deixar a promessa pendurada: sem limite, o botão parecia não fazer nada
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    ok = true;
  } catch {
    ok = copyFallback(text);
  }
  if (!ok) input?.select();
  button.textContent = ok ? t('Copiado!') : t('Não foi possível copiar: selecione e copie à mão');
  setTimeout(() => (button.textContent = label), ok ? 1500 : 3500);
};

// Mostrar a senha: um olho dentro de todo campo de senha da página. Clicar alterna entre ver e esconder;
// o campo volta a ficar escondido quando o formulário é enviado (para o navegador não guardar como texto).
const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF =
  '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>';
export const addPasswordToggles = (root = document) => {
  for (const input of root.querySelectorAll('input[type="password"]:not([data-reveal])')) {
    input.dataset.reveal = '';
    const form = input.form;
    const wrap = document.createElement('div');
    wrap.className = 'password-field';
    input.replaceWith(wrap);
    // Não é um <button>: assim não vira o "primeiro botão" do formulário nem é enviado com ele
    const toggle = document.createElement('span');
    toggle.setAttribute('role', 'button');
    toggle.tabIndex = 0;
    toggle.className = 'reveal';
    toggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${EYE}</svg>`;
    const set = (shown) => {
      input.type = shown ? 'text' : 'password';
      toggle.firstChild.innerHTML = shown ? EYE_OFF : EYE;
      const label = t(shown ? 'Esconder senha' : 'Mostrar senha');
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', String(shown));
    };
    set(false);
    const flip = () => {
      set(input.type === 'password');
      input.focus();
    };
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      flip();
    });
    form?.addEventListener('submit', () => set(false), { capture: true });
    wrap.append(input, toggle);
  }
};
addPasswordToggles();

// Botão Voltar ([data-back]): volta à página ou seção anterior. Aberta numa aba nova (a partir da
// sala, para a live continuar), não há para onde voltar: a aba fecha e a sala reaparece; se o
// navegador não deixar fechar, vai para a página inicial.
const goBack = () => {
  if (history.length > 1) return history.back();
  window.close();
  setTimeout(() => location.assign('/'), 150);
};
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', goBack);
