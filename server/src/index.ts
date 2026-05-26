import fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { join } from "path";
import { initSchema, ensurePracticeDefaults } from "./db/index";
import apiRoutes from "./routes/api";

const app = fastify({ logger: true });
const PORT = Number(process.env.PORT || 3456);

initSchema();
ensurePracticeDefaults();

app.register(cors, { origin: true, credentials: true });

app.register(staticPlugin, {
  root: join(__dirname, "../../web"),
  prefix: "/",
  wildcard: false,
});

app.register(apiRoutes, { prefix: "/api" });

app.get("/anamnese/:token", async (request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/admin", async (request, reply) => {
  return reply.sendFile("admin/index.html");
});
app.get("/admin/*", async (request, reply) => {
  return reply.sendFile("admin/index.html");
});

app.get("/health", async () => ({ status: "ok", version: "0.4.0" }));

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`myhistoree läuft auf http://0.0.0.0:${PORT}`);
});
