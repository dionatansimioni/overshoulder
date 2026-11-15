// Aviso de nova versão: consulta a última release publicada no GitHub, uma vez por dia.
// Só sai do servidor um GET sem dados da instalação; o GitHub vê apenas o IP do servidor.

export const RELEASES_PAGE = 'https://github.com/dionatansimioni/overshoulder/releases';
export const DEFAULT_URL = 'https://api.github.com/repos/dionatansimioni/overshoulder/releases/latest';
export const INSTALL_METHODS = ['installer', 'compose', 'compose-build', 'docker', 'coolify'];

const SEMVER_RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export const parseVersion = (v) => {
  const m = typeof v === 'string' && v.match(SEMVER_RE);
  return m ? m.slice(1).map(Number) : null;
};

export const newer = (a, b) => {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

// Resposta do GitHub → { version, notesUrl }, ou null se algo não tiver a forma esperada.
// O link das notas só é aceito se apontar para as releases do próprio projeto.
export const parseRelease = (body) => {
  if (!body || typeof body !== 'object' || body.draft || body.prerelease) return null;
  const parsed = parseVersion(body.tag_name);
  if (!parsed) return null;
  const version = parsed.join('.');
  const notesUrl =
    typeof body.html_url === 'string' && body.html_url.startsWith(`${RELEASES_PAGE}/`) && !/[\s"'<>]/.test(body.html_url)
      ? body.html_url
      : `${RELEASES_PAGE}/tag/v${version}`;
  return { version, notesUrl };
};

export const createUpdateChecker = ({ current, url = DEFAULT_URL, log, timeoutMs = 10_000 }) => {
  const state = { latest: null, notesUrl: null, checkedAt: null, error: null };

  const check = async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'overshoulder-update-check' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 512 * 1024) throw new Error('resposta grande demais');
      const release = parseRelease(JSON.parse(text));
      if (!release) throw new Error('resposta sem versão válida');
      Object.assign(state, { latest: release.version, notesUrl: release.notesUrl, error: null });
      if (newer(release.version, current)) log.info('nova versão disponível', { atual: current, nova: release.version });
    } catch (err) {
      state.error = 'Não foi possível consultar a versão mais recente.';
      log.warn('consulta de nova versão falhou', { motivo: err.message });
    }
    state.checkedAt = new Date().toISOString();
  };

  const view = () => ({
    current,
    latest: state.latest,
    available: !!state.latest && newer(state.latest, current),
    notesUrl: state.notesUrl ?? RELEASES_PAGE,
    checkedAt: state.checkedAt,
    error: state.error,
  });

  return { check, view };
};
