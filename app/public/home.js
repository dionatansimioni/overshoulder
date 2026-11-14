const form = document.getElementById('create');
const errorEl = document.getElementById('error');

const randomKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Falha ao criar a sala.');

    // A chave E2EE é gerada aqui e vai só no fragmento (#) da URL: nunca chega ao servidor.
    const params = new URLSearchParams({ k: randomKey(), h: data.hostKey });
    location.href = `/r/${data.roomId}#${params}`;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    button.disabled = false;
  }
});
