import { translatePage } from '/static/i18n.js';

translatePage();
document.getElementById('retry').addEventListener('click', () => location.reload());
