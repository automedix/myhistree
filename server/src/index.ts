import fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import staticPlugin from "@fastify/static";
import { join } from "path";
import { initSchema, ensurePracticeDefaults } from "./db/index";
import apiRoutes from "./routes/api";
import { registerAuthRoutes, ensureDefaultAdmin } from "./routes/auth";

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 3456);

initSchema();
ensurePracticeDefaults();
ensureDefaultAdmin();

// Security headers
app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()");
  reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  reply.header("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  return payload;
});

app.register(cors, { origin: true, credentials: true });
app.register(cookie);
app.register(jwt, {
  secret: process.env.JWT_SECRET || (() => { throw new Error("JWT_SECRET environment variable is required"); })(),
  cookie: {
    cookieName: "access_token",
    signed: false,
  },
  sign: { expiresIn: "15m" },
});

app.register(staticPlugin, {
  root: join(__dirname, "../../web"),
  prefix: "/",
  wildcard: true,
});

// Auth routes
app.register(registerAuthRoutes, { prefix: "/api" });

// API routes (includes admin routes with auth middleware inside)
app.register(apiRoutes, { prefix: "/api" });

app.get("/anamnese/:token", async (request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/admin", async (request, reply) => {
  return reply.sendFile("admin/index.html");
});

app.get("/health", async () => ({ status: "ok", version: "0.5.6" }));

// SPA fallback for client-side routing
app.setNotFoundHandler(async (request, reply) => {
  const url = request.raw.url || "";
  if (url.startsWith("/admin/")) {
    return reply.sendFile("admin/index.html");
  }
  reply.status(404).send({ error: "Not found" });
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`myhistree läuft auf http://0.0.0.0:${PORT}`);
});
