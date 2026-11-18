// Site do Overshoulder (GitHub Pages): página inicial própria e a documentação pelo Starlight,
// gerada a partir de ../docs (inglês, padrão) e ../docs/pt-BR (português).
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://dionatansimioni.github.io',
  base: '/overshoulder',
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()] },
  integrations: [
    starlight({
      title: 'Overshoulder',
      description: 'Self-hosted screen sharing for playing with friends, end-to-end encrypted.',
      logo: { src: './public/icon.svg', alt: '' },
      favicon: '/icon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'pt-br': { label: 'Português', lang: 'pt-BR' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/dionatansimioni/overshoulder' }],
      customCss: ['./src/styles/starlight.css'],
      // A busca (Pagefind) usa um binário que não roda em processadores sem AVX2: o build.sh a desliga
      // nessas máquinas, só para testar; no GitHub Actions ela fica ligada
      pagefind: !process.env.SITE_NO_SEARCH,
      sidebar: [
        {
          label: 'Run a server',
          translations: { 'pt-BR': 'Para quem administra' },
          items: ['docs/install', 'docs/configuration', 'docs/proxy', 'docs/accounts', 'docs/troubleshooting'],
        },
        {
          label: 'Broadcast',
          translations: { 'pt-BR': 'Para quem transmite' },
          items: ['docs/rooms', 'docs/broadcasting'],
        },
      ],
    }),
  ],
});
