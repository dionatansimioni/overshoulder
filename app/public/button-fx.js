// Retorno visual dos botões: ao ligar ou desligar um botão redondo (microfone, câmera, gravar, mudo…),
// um anel sai dele (roxo ao ligar, cinza ao desligar). O clique em si é o :active do CSS (o botão afunda).
// Observa as mudanças de estado (classe e aria-pressed) em vez de depender de cada tela avisar.

const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const STATE_CLASSES = ['on', 'recording'];

const stateOf = (button) => STATE_CLASSES.some((c) => button.classList.contains(c)) || button.getAttribute('aria-pressed') === 'true';

export const mountButtonFeedback = (root = document) => {
  const last = new WeakMap();
  const play = (button, on) => {
    if (REDUCED()) return;
    button.classList.remove('fx-on', 'fx-off');
    // Reinicia a animação mesmo se ela ainda estiver rodando
    void button.offsetWidth;
    button.classList.add(on ? 'fx-on' : 'fx-off');
    button.addEventListener('animationend', () => button.classList.remove('fx-on', 'fx-off'), { once: true });
  };
  const seen = (button) => {
    const now = stateOf(button);
    const before = last.get(button);
    last.set(button, now);
    if (before !== undefined && before !== now) play(button, now);
  };
  for (const b of root.querySelectorAll('button.round, button.mute-toggle, button.person-mute')) last.set(b, stateOf(b));
  new MutationObserver((records) => {
    for (const r of records) {
      const b = r.target;
      if (b instanceof HTMLButtonElement && b.matches('button.round, button.mute-toggle, button.person-mute')) seen(b);
    }
  }).observe(root.body ?? root, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
};
