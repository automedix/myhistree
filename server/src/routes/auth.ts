import { FastifyInstance } from "fastify";
import { db, logAudit } from "../db/index";
import { randomUUID, createHash } from "crypto";
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const PEPPER = process.env.PASSWORD_PEPPER || "";
if (!PEPPER) throw new Error("PASSWORD_PEPPER environment variable is required");
const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(plain: string): string {
  const peppered = plain + PEPPER;
  return bcrypt.hashSync(peppered, SALT_ROUNDS);
}

function verifyPassword(plain: string, hash: string): boolean {
  const peppered = plain + PEPPER;
  return bcrypt.compareSync(peppered, hash);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

// ─── Simple rate limiter (in-memory) ────────────────────────────
const loginAttempts: Record<string, { count: number; resetAt: number }> = {};
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts[ip];
  if (!entry || now > entry.resetAt) {
    loginAttempts[ip] = { count: 1, resetAt: now + WINDOW_MS };
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

function resetRateLimit(ip: string) {
  delete loginAttempts[ip];
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  // ─── Login Step 1: Email + Password ─────────────────────────────
  fastify.post("/auth/login", async (request, reply) => {
    const clientIp = request.ip || "unknown";
    if (!checkRateLimit(clientIp)) {
      return reply.status(429).send({ error: "Too many attempts. Please try again in a minute." });
    }

    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: "Email and password required" });
    }

    const admin = db.prepare("SELECT * FROM admin_users WHERE email = ?").get(email) as any;
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      logAudit("LOGIN_FAILURE", email, "Invalid credentials", undefined, request.ip);
      return reply.status(401).send({ error: "Invalid credentials" });
    }
    if (admin.active === 0) {
      logAudit("LOGIN_FAILURE", email, "Account deactivated", admin.id, request.ip);
      return reply.status(403).send({ error: "Account deactivated" });
    }

    resetRateLimit(clientIp); // reset on successful password

    if (admin.totp_enabled) {
      logAudit("LOGIN_STEP1", email, "TOTP required", admin.id, request.ip);
      return { requiresTotp: true, adminId: admin.id };
    }

    // No TOTP — issue tokens directly
    const accessToken = (fastify as any).jwt.sign({ adminId: admin.id, email: admin.email, role: admin.role });
    const refreshToken = generateRefreshToken();
    const refreshHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

    db.prepare("INSERT INTO admin_sessions (id, admin_id, refresh_token_hash, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), admin.id, refreshHash, request.ip, request.headers["user-agent"] || null, expiresAt);

    db.prepare("UPDATE admin_users SET last_login = datetime('now') WHERE id = ?").run(admin.id);
    logAudit("LOGIN_SUCCESS", email, undefined, admin.id, request.ip);

    reply.setCookie("access_token", accessToken, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });

    return { success: true, admin: { id: admin.id, email: admin.email, role: admin.role } };
  });

  // ─── Login Step 2: TOTP Verification ────────────────────────────
  fastify.post("/auth/verify-totp", async (request, reply) => {
    const { adminId, token } = request.body as { adminId?: string; token?: string };
    if (!adminId || !token) {
      return reply.status(400).send({ error: "adminId and token required" });
    }

    const admin = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(adminId) as any;
    if (!admin || !admin.totp_secret) {
      return reply.status(404).send({ error: "Admin not found or TOTP not set up" });
    }

    const verified = speakeasy.totp.verify({
      secret: admin.totp_secret,
      encoding: "base32",
      token: token.replace(/\s/g, ""),
      window: 1,
    });

    if (!verified) {
      logAudit("TOTP_FAILED", admin.email, `Token: ${token}`, admin.id, request.ip);
      return reply.status(401).send({ error: "Invalid TOTP code" });
    }

    const accessToken = (fastify as any).jwt.sign({ adminId: admin.id, email: admin.email, role: admin.role });
    const refreshToken = generateRefreshToken();
    const refreshHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

    db.prepare("INSERT INTO admin_sessions (id, admin_id, refresh_token_hash, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), admin.id, refreshHash, request.ip, request.headers["user-agent"] || null, expiresAt);

    db.prepare("UPDATE admin_users SET last_login = datetime('now') WHERE id = ?").run(admin.id);
    logAudit("LOGIN_SUCCESS", admin.email, "TOTP verified", admin.id, request.ip);

    reply.setCookie("access_token", accessToken, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });

    return { success: true, admin: { id: admin.id, email: admin.email, role: admin.role } };
  });

  // ─── Refresh Token ──────────────────────────────────────────────
  fastify.post("/auth/refresh", async (request, reply) => {
    const refreshToken = (request.body as any)?.refreshToken;
    if (!refreshToken) {
      return reply.status(400).send({ error: "refreshToken required" });
    }

    const refreshHash = hashToken(refreshToken);
    const session = db.prepare("SELECT * FROM admin_sessions WHERE refresh_token_hash = ? AND expires_at > datetime('now')").get(refreshHash) as any;
    if (!session) {
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }

    const admin = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(session.admin_id) as any;
    if (!admin) {
      return reply.status(401).send({ error: "Admin not found" });
    }

    const accessToken = (fastify as any).jwt.sign({ adminId: admin.id, email: admin.email, role: admin.role });
    reply.setCookie("access_token", accessToken, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });

    return { success: true };
  });

  // ─── Logout ─────────────────────────────────────────────────────
  fastify.post("/auth/logout", async (request, reply) => {
    const accessToken = request.cookies?.access_token;
    if (accessToken) {
      try {
        const decoded = (fastify as any).jwt.verify(accessToken) as any;
        logAudit("LOGOUT", decoded.email, undefined, decoded.adminId, request.ip);
      } catch {
        // ignore invalid token on logout
      }
    }

    const refreshToken = (request.body as any)?.refreshToken;
    if (refreshToken) {
      db.prepare("DELETE FROM admin_sessions WHERE refresh_token_hash = ?").run(hashToken(refreshToken));
    }

    reply.clearCookie("access_token", { path: "/" });
    return { success: true };
  });

  // ─── Me ─────────────────────────────────────────────────────────
  fastify.get("/auth/me", async (request, reply) => {
    try {
      const decoded = await (request as any).jwtVerify() as any;
      const admin = db.prepare("SELECT id, email, role, practice_id, last_login, totp_enabled FROM admin_users WHERE id = ?").get(decoded.adminId) as any;
      if (!admin) return reply.status(404).send({ error: "Admin not found" });
      return admin;
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  // ─── Setup TOTP (QR Code) ───────────────────────────────────────
  fastify.post("/auth/setup-totp", async (request, reply) => {
    try {
      const decoded = await (request as any).jwtVerify() as any;
      const admin = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(decoded.adminId) as any;
      if (!admin) return reply.status(404).send({ error: "Admin not found" });

      const secret = speakeasy.generateSecret({
        name: `myhistree (${admin.email})`,
        length: 32,
      });

      db.prepare("UPDATE admin_users SET totp_secret = ? WHERE id = ?").run(secret.base32, admin.id);

      const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url || "");
      return { secret: secret.base32, qrCode: qrDataUrl };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  // ─── Confirm TOTP Setup ─────────────────────────────────────────
  fastify.post("/auth/confirm-totp", async (request, reply) => {
    try {
      const decoded = await (request as any).jwtVerify() as any;
      const { token } = request.body as { token?: string };
      if (!token) return reply.status(400).send({ error: "token required" });

      const admin = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(decoded.adminId) as any;
      if (!admin || !admin.totp_secret) return reply.status(400).send({ error: "TOTP not set up" });

      const verified = speakeasy.totp.verify({
        secret: admin.totp_secret,
        encoding: "base32",
        token: token.replace(/\s/g, ""),
        window: 1,
      });

      if (!verified) return reply.status(400).send({ error: "Invalid TOTP code" });

      db.prepare("UPDATE admin_users SET totp_enabled = 1 WHERE id = ?").run(admin.id);
      logAudit("TOTP_ENABLED", admin.email, undefined, admin.id, request.ip);
      return { success: true };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  // ─── Change Password ────────────────────────────────────────────
  fastify.post("/auth/change-password", async (request, reply) => {
    try {
      const decoded = await (request as any).jwtVerify() as any;
      const { currentPassword, newPassword } = request.body as { currentPassword?: string; newPassword?: string };

      if (!currentPassword || !newPassword) {
        return reply.status(400).send({ error: "Current and new password required" });
      }
      if (newPassword.length < 8) {
        return reply.status(400).send({ error: "New password must be at least 8 characters" });
      }

      const admin = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(decoded.adminId) as any;
      if (!admin) return reply.status(404).send({ error: "Admin not found" });

      if (!verifyPassword(currentPassword, admin.password_hash)) {
        logAudit("PASSWORD_CHANGE_FAILURE", admin.email, "Incorrect current password", admin.id, request.ip);
        return reply.status(403).send({ error: "Current password is incorrect" });
      }

      const newHash = hashPassword(newPassword);
      db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(newHash, admin.id);

      // Invalidate all existing sessions for security
      db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(admin.id);

      logAudit("PASSWORD_CHANGED", admin.email, undefined, admin.id, request.ip);
      return { success: true, message: "Password changed. Please log in again." };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

// ─── Helper: Ensure default admin exists ──────────────────────────
export function ensureDefaultAdmin() {
  const count = db.prepare("SELECT COUNT(*) as c FROM admin_users").get() as { c: number };
  if (count.c === 0) {
    const id = randomUUID();
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "";
    if (!defaultPassword) throw new Error("DEFAULT_ADMIN_PASSWORD environment variable is required for first-run admin creation");
    const hash = hashPassword(defaultPassword);
    db.prepare(`INSERT INTO admin_users (id, email, password_hash, role, practice_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run(id, "admin@example.com", hash, "superadmin", "demo-practice");
    console.log("[AUTH] Default admin created: admin@example.com / " + defaultPassword);
    console.log("[AUTH] CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN");
  }
}
