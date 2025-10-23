// auth.ts
// Lightweight auth with optional n8n endpoints.
// If VITE_N8N_AUTH_* envs are set, we'll POST to those; otherwise we fall back to localStorage.

export type User = { id: string; name: string; email: string };
const STORAGE_KEY = "ai_slide_studio_user";
const DB_KEY = "ai_slide_studio_users_db"; // demo-only local DB for register/login

// FIX: Safely access Vite environment variables. `import.meta.env` may not be defined
// in all execution contexts. This check prevents a runtime error and allows the app to
// gracefully fall back to localStorage.
// FIX: Cast `import.meta` to `any` to avoid TypeScript errors in environments where Vite
// types are not available. Optional chaining (`?.`) safely handles cases where `env` is undefined.
const LOGIN_URL = (import.meta as any).env?.VITE_N8N_AUTH_LOGIN_URL;
const REGISTER_URL = (import.meta as any).env?.VITE_N8N_AUTH_REGISTER_URL;

function readDB(): Record<string, { id: string; name: string; email: string; password: string }> {
  try {
    const dbString = localStorage.getItem(DB_KEY);
    if (!dbString) {
        const initialDb = {
            "demo@demo.com": {
                id: "d4e21a12-6a28-4f7a-9b8b-3e5f7d2f9c1d",
                name: "Demo User",
                email: "demo@demo.com",
                password: "demo"
            }
        };
        localStorage.setItem(DB_KEY, JSON.stringify(initialDb));
        return initialDb;
    }
    return JSON.parse(dbString);
  } catch {
    return {};
  }
}
function writeDB(db: Record<string, any>) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function currentUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}
export function logout() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function register(name: string, email: string, password: string): Promise<User> {
  if (REGISTER_URL) {
    const res = await fetch(REGISTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) throw new Error(`Register failed (${res.status})`);
    const data = await res.json();
    const user: User = { id: data.id ?? crypto.randomUUID(), name: data.name ?? name, email: data.email ?? email };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return user;
  }

  // fallback: local demo
  const key = email.toLowerCase();
  const db = readDB();
  if (db[key]) throw new Error("Email already registered");
  const newUser = { id: crypto.randomUUID(), name, email, password };
  db[key] = newUser;
  writeDB(db);
  const user: User = { id: newUser.id, name, email };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

export async function login(email: string, password: string): Promise<User> {
  if (LOGIN_URL) {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`Login failed (${res.status})`);
    const data = await res.json();
    const user: User = { id: data.id ?? crypto.randomUUID(), name: data.name ?? data.email?.split("@")[0] ?? "", email: data.email ?? email };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return user;
  }

  // fallback: local demo
  const key = email.toLowerCase();
  const db = readDB();
  const found = db[key];
  if (!found || found.password !== password) throw new Error("Invalid credentials");
  const user: User = { id: found.id, name: found.name, email: found.email };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}