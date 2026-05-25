import fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { join } from 'path';
import { initSchema, ensurePracticeDefaults } from './db/index';
import apiRoutes from './routes/api';

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 3456);

// Datenbank initialisieren
initSchema();
ensurePracticeDefaults();

// CORS
app.register(cors, { origin: true, credentials: true });

// Statische Dateien (Web UI)
app.register(staticPlugin, {
  root: join(__dirname, '../../web'),
  prefix: '/',
  wildcard: false,
});

// API Routes
app.register(apiRoutes, { prefix: '/api' });

// SPA fallback: /anamnese/:token -> index.html
app.get('/anamnese/:token', async (request, reply) => {
  reply.sendFile('index.html');
});

// Admin Dashboard
app.get('/admin', async (request, reply) => {
  reply.sendFile('admin/index.html');
});
app.get('/admin/*', async (request, reply) => {
  reply.sendFile('admin/index.html');
});

// Health
app.get('/health', async () => ({ status: 'ok', version: '0.2.0-nostr' }));

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`myhistoree läuft auf http://0.0.0.0:${PORT}`);
});
