// Cria um usuário pela linha de comando (necessário para o primeiro professor).
// Uso: npm run create-user -- --username prof --name "Nome" [--role professor|aluno] [--turma T1] [--password xxx]
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { openDb } from '../server/db.js';
import { hashPassword, validPassword, validUsername } from '../server/auth.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'professor' },
    turma: { type: 'string', default: '' },
    password: { type: 'string' },
  },
});

if (!validUsername(values.username) || !values.name || !['professor', 'aluno'].includes(values.role)) {
  console.error('Uso: npm run create-user -- --username <usuario> --name "<nome>" [--role professor|aluno] [--turma T] [--password senha]');
  process.exit(1);
}
const password = values.password ?? randomBytes(6).toString('base64url');
if (!validPassword(password)) {
  console.error('A senha precisa ter pelo menos 6 caracteres');
  process.exit(1);
}
const db = openDb();
try {
  db.prepare('INSERT INTO users (username, name, role, turma, password_hash) VALUES (?, ?, ?, ?, ?)').run(
    values.username, values.name, values.role, values.turma, hashPassword(password)
  );
} catch (e) {
  console.error(e.message.includes('UNIQUE') ? 'Usuário já existe' : e.message);
  process.exit(1);
}
console.log(`Usuário "${values.username}" (${values.role}) criado.`);
if (!values.password) console.log(`Senha gerada: ${password}  (troque após o primeiro acesso)`);
