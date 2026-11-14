// Chamada à API do próprio site: GET sem corpo, POST com JSON. Erros viram exceção com a mensagem do servidor.
export const api = async (path, body) => {
  const res = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? 'Erro inesperado. Tente de novo.');
    err.status = res.status;
    throw err;
  }
  return data;
};

export const $ = (id) => document.getElementById(id);

export const showError = (el, err) => {
  el.textContent = err?.message ?? String(err);
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
