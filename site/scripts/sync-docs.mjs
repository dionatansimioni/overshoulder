// Gera as páginas de documentação do Starlight a partir dos guias do repositório, para não haver duas
// cópias: ../docs/*.md (inglês, padrão) → src/content/docs/docs/ e ../docs/pt-BR/*.md → src/content/docs/pt-br/docs/.
// O título sai do "# …" da primeira linha, a linha de navegação entre idiomas sai (o Starlight tem a
// sua) e os links entre guias (install.md#x) viram endereços do site (/overshoulder/docs/install/#x).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDocs = path.resolve(here, '../../docs');
const out = path.resolve(here, '../src/content/docs');
const BASE = '/overshoulder/';
// O plano de trabalho fica no repositório, não no site
const SKIP = new Set(['PLANO.md']);

const pageUrl = (prefix, file, anchor = '') =>
  `${BASE}${prefix}docs/${file === 'README.md' ? '' : `${file.replace(/\.md$/, '')}/`}${anchor ? `#${anchor}` : ''}`;

const convert = (source, prefix) => {
  const lines = source.split('\n');
  const title = lines.shift().replace(/^#\s+/, '').trim();
  const body = lines
    // Navegação entre idiomas e de volta ao índice: o Starlight já tem as suas
    .filter((l) => !/^\[← (Documentation|Documentação)\]|^English · \[Português\]|^\[English\]\(\.\.\/README\.md\) · Português/.test(l))
    .join('\n')
    .replace(/\]\((?!https?:|#)([\w-]+\.md)(?:#([^)]+))?\)/g, (_, file, anchor) => `](${pageUrl(prefix, file, anchor)})`)
    .replace(/^\n+/, '');
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`;
};

fs.rmSync(out, { recursive: true, force: true });
for (const [dir, prefix] of [
  [repoDocs, ''],
  [path.join(repoDocs, 'pt-BR'), 'pt-br/'],
]) {
  const target = path.join(out, prefix, 'docs');
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !SKIP.has(f))) {
    const name = file === 'README.md' ? 'index.md' : file;
    fs.writeFileSync(path.join(target, name), convert(fs.readFileSync(path.join(dir, file), 'utf8'), prefix));
  }
}
console.log(`documentação gerada em ${path.relative(process.cwd(), out)}`);
