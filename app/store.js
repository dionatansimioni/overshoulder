// Estado persistente (contas, convites, configurações) num arquivo JSON no volume de dados.
// Um processo só escreve nele; cada alteração grava um arquivo novo e troca de uma vez.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ version: 1, users: [], invites: [], settings: {} });

export const createStore = (dataDir) => {
  const file = path.join(dataDir, 'state.json');
  fs.mkdirSync(dataDir, { recursive: true });
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : EMPTY();

  const save = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  return {
    get state() {
      return state;
    },
    // Altera o estado e grava; devolve o que a função devolver
    update(fn) {
      const result = fn(state);
      save();
      return result;
    },
    dataDir,
  };
};
