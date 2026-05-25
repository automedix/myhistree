"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = require("path");
const index_1 = require("./db/index");
const api_1 = __importDefault(require("./routes/api"));
const app = (0, fastify_1.default)({ logger: true });
const PORT = Number(process.env.PORT || 3456);
// Datenbank initialisieren
(0, index_1.initSchema)();
(0, index_1.ensurePracticeDefaults)();
// CORS
app.register(cors_1.default, { origin: true, credentials: true });
// Statische Dateien (Web UI)
app.register(static_1.default, {
    root: (0, path_1.join)(__dirname, '../../web'),
    prefix: '/',
    wildcard: false,
});
// API Routes
app.register(api_1.default, { prefix: '/api' });
// SPA fallback: /anamnese/:token -> index.html
app.get('/anamnese/:token', async (request, reply) => {
    return reply.sendFile('index.html');
});
// Admin Dashboard
app.get('/admin', async (request, reply) => {
    return reply.sendFile('admin/index.html');
});
app.get('/admin/*', async (request, reply) => {
    return reply.sendFile('admin/index.html');
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
//# sourceMappingURL=index.js.map