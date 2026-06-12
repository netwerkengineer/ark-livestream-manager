import { NextRequest } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import { getSettings } from "./settingsStore";

// Helper to get encryption key from settings
function getSessionKey(): Buffer {
  const settings = getSettings();
  const secret = settings.nextAuthSecret || "default-secret-key-32-chars-long!!";
  // Make sure key is exactly 32 bytes
  return crypto.createHash("sha256").update(secret).digest();
}

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Encrypt session payload: { username, role }
export function encryptSession(payload: any): string {
  const key = getSessionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// Decrypt session payload
export function decryptSession(sessionStr: string): any {
  try {
    const key = getSessionKey();
    const parts = sessionStr.split(":");
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch (e) {
    return null;
  }
}

// Check authorization
export async function isAuthorized(
  req: NextRequest,
  requiredRole?: "admin" | "operator",
  requiredPermission?: string
): Promise<any | null> {
  // 1. Check Google OAuth session (granted full admin status)
  const session = await auth();
  if (session) {
    const adminUser = {
      username: session.user?.name || "Google User",
      role: "admin" as const,
      permissions: ["planner", "control", "monitor", "lights", "freeshow"]
    };
    if (!requiredRole || requiredRole === "admin" || requiredRole === "operator") {
      if (!requiredPermission || adminUser.permissions.includes(requiredPermission)) {
        return adminUser;
      }
    }
  }

  // 2. Check local operator cookie session
  const cookieVal = req.cookies.get("operator_session")?.value;
  if (cookieVal) {
    const payload = decryptSession(cookieVal);
    if (payload && payload.username && payload.role) {
      const settings = getSettings();
      const user = settings.users?.find(u => u.username.toLowerCase() === payload.username.toLowerCase());
      
      const userPermissions = user?.role === "admin"
        ? ["planner", "control", "monitor", "lights", "freeshow"]
        : (user?.permissions || []);

      const resolvedUser = {
        username: payload.username,
        role: user?.role || payload.role,
        permissions: userPermissions
      };

      if (requiredRole === "admin" && resolvedUser.role !== "admin") {
        return null; // Operator trying to access Admin-only route
      }
      
      if (requiredPermission && !resolvedUser.permissions.includes(requiredPermission)) {
        return null; // Missing required permission for this theme
      }

      return resolvedUser; // Valid session matching role/permission requirements
    }
  }

  return null;
}
