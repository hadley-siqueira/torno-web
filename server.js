import { openDb } from './server/db.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.PORT) || 3000;
const db = openDb();
const app = createApp({
  db,
  signupsPerHour: Number(process.env.SIGNUPS_PER_HOUR) || 5, // cadastros por IP por hora
});


app.listen(PORT, () => console.log(`Simulador de torno em http://localhost:${PORT}`));
