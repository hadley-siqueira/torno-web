import { openDb } from './server/db.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.PORT) || 3000;
const db = openDb();
const app = createApp({ db });

const { n } = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'professor'").get();
if (!n) console.warn('Nenhum professor cadastrado. Crie um com: npm run create-user -- --role professor --username <usuario> --name "<nome>"');

app.listen(PORT, () => console.log(`Simulador de torno em http://localhost:${PORT}`));
