import { Hono } from "hono";
import type { Context } from "hono";

/* =========================================================
 * Types
 * ======================================================= */

type DuolingoApiResponse = {
  users: DuolingoUser[];
};

type DuolingoUser = {
  username: string;
  name: string;
  streak?: number;
  hasPlus?: boolean;
  totalXp?: number;
  picture?: string;
  courses?: {
    learningLanguage: string;
    fromLanguage: string;
    xp: number;
  }[];
};

type Language = {
  learningLanguage: string;
  points: number;
  from?: string;
};

type User = {
  name: string;
  username: string;
  streak: number;
  hasPlus: boolean;
  total_xp: number;
  languages: Language[];
  picture: string | null;
};

type FetchError = Error & { status?: number };

/* =========================================================
 * App
 * ======================================================= */

const app = new Hono();

app.get("/:username", async (c) => {
  const url = new URL(c.req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  const username = parts[0];
  const showSpecial = parts[1] === "s";

  if (!username || username === "favicon.ico") {
    return c.body(null, 204);
  }

  const theme = c.req.query("theme") ?? "";
  const iconPos = c.req.query("icon") ?? "left";

  const isDark = theme === "dark";
  const isDuolingo = theme === "duolingo";
  const isSuper = theme === "super";

  const cache = caches.default;

  const cacheKeyUrl = new URL(c.req.url);
  cacheKeyUrl.search = "";
  cacheKeyUrl.searchParams.set("theme", theme);

  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const raw = await fetchUserData(username);
    const user = normalizeUser(raw);

    const avatar = await fetchAvatarDataUri(user.picture);
    const { detectedCodes, calculatedTotalXp } = detectCourses(
      user.languages,
      showSpecial
    );

    const flags = await fetchFlags(detectedCodes);

    const svg = generateSvg({
      user,
      avatar,
      flags,
      iconPos,
      isDark,
      isDuolingo,
      isSuper,
      calculatedTotalXp,
    });

    const response = new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });

    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Duolingo API error";

    const status =
      err instanceof Error && typeof (err as FetchError).status === "number"
        ? (err as FetchError).status
        : 500;

    return errorSvg(c, message, status);
  }
});

export default { fetch: app.fetch };

/* =========================================================
 * Fetch helpers
 * ======================================================= */

function fetchWithTimeout(
  input: RequestInfo,
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(input, { signal: controller.signal }).finally(() =>
    clearTimeout(id)
  ) as Promise<Response>;
}

async function fetchUserData(username: string): Promise<DuolingoUser> {
  const url =
    "https://www.duolingo.com/2017-06-30/users?username=" +
    encodeURIComponent(username);

  const res = await fetchWithTimeout(url, 6000);

  if (!res.ok) {
    const err = new Error(`Duolingo API error (${res.status})`) as FetchError;
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as DuolingoApiResponse;

  if (!data.users || data.users.length === 0) {
    const err = new Error("User not found") as FetchError;
    err.status = 404;
    throw err;
  }

  return data.users[0];
}

/* =========================================================
 * Normalization
 * ======================================================= */

function normalizeUser(raw: DuolingoUser): User {
  return {
    name: raw.name,
    username: raw.username,
    streak: raw.streak ?? 0,
    hasPlus: raw.hasPlus ?? false,
    total_xp: raw.totalXp ?? 0,
    languages: (raw.courses ?? []).map((c) => ({
      learningLanguage: c.learningLanguage,
      points: c.xp,
      from: c.fromLanguage,
    })),
    picture: raw.picture ?? null,
  };
}

/* =========================================================
 * Avatar helpers
 * ======================================================= */

async function fetchAvatarDataUri(
  picture: string | null
): Promise<string> {
  const fallbackSvg =
    `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="120" height="120" rx="60" fill="#50C800"/></svg>`;

  const fallback = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`;
  if (!picture) return fallback;

  const src =
    picture.startsWith("http")
      ? picture
      : picture.startsWith("//")
      ? `https:${picture}`
      : `https:${picture}`;

  try {
    const res = await fetchWithTimeout(src, 5000);
    if (!res.ok) return fallback;

    const type = res.headers.get("Content-Type") ?? "image/jpeg";
    const ext = type.split("/").pop() ?? "jpeg";
    const b64 = await responseToBase64(res);

    return `data:image/${ext};base64,${b64}`;
  } catch {
    return fallback;
  }
}

async function responseToBase64(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* =========================================================
 * Courses / Flags
 * ======================================================= */

const FLAG_BASE =
  "https://cdn.jsdelivr.net/gh/Wojix/duolingo-card@main/flag/";

function detectCourses(langs: Language[], showSpecial: boolean) {
  const xpMap = new Map<string, number>();
  const seen = new Set<string>();
  const detected: { code: string; points: number; isSpecial: boolean }[] = [];

  for (const l of langs) {
    const from = l.from ?? "unknown";
    const key = `${l.learningLanguage}_from_${from}`;
    xpMap.set(key, Math.max(l.points, xpMap.get(key) ?? 0));

    if (!seen.has(l.learningLanguage) && l.points > 0) {
      seen.add(l.learningLanguage);
      detected.push({
        code: l.learningLanguage,
        points: l.points,
        isSpecial: false,
      });
    }
  }

  if (showSpecial) {
    for (const code of ["zs", "ms", "zc"]) {
      if (!seen.has(code)) {
        detected.push({ code, points: -1, isSpecial: true });
      }
    }
  }

  return {
    detectedCodes: detected.map((d) => d.code).slice(0, 50),
    calculatedTotalXp: [...xpMap.values()].reduce((a, b) => a + b, 0),
  };
}

async function fetchFlags(codes: string[]): Promise<string[]> {
  const result: string[] = [];

  for (const code of codes) {
    try {
      const res = await fetchWithTimeout(`${FLAG_BASE}${code}.svg`, 4000);
      if (!res.ok) continue;
      const b64 = await responseToBase64(res);
      result.push(`data:image/svg+xml;base64,${b64}`);
    } catch {}
  }

  return result;
}

/* =========================================================
 * SVG generator
 * ======================================================= */

function generateSvg(opts: {
  user: User;
  avatar: string;
  flags: string[];
  iconPos: string;
  isDark: boolean;
  isDuolingo: boolean;
  isSuper: boolean;
  calculatedTotalXp: number;
}): string {
  const { user, avatar, flags, iconPos, isDark, isDuolingo, isSuper } = opts;

  const bg = isDuolingo
    ? "#58cc02"
    : isSuper
    ? "url(#g)"
    : isDark
    ? "#1a1a1a"
    : "#F5FBFF";

  const rows = Math.ceil(flags.length / 10);
  const height = 130 + rows * 30;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="350" height="${height}">
  <rect width="100%" height="100%" rx="15" fill="${bg}"/>
  <image x="25" y="20" width="50" height="50" href="${avatar}"/>
  <text x="90" y="42" font-size="20">${escapeXml(user.name)}</text>
  <text x="90" y="62" font-size="14">@${escapeXml(user.username)}</text>
  ${flags
    .map(
      (f, i) =>
        `<image x="${25 + (i % 10) * 30}" y="${
          100 + Math.floor(i / 10) * 30
        }" width="22" height="22" href="${f}"/>`
    )
    .join("")}
</svg>`;
}

/* =========================================================
 * Utilities / Error
 * ======================================================= */

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" } as any)[c]
  );
}

function errorSvg(c: Context, message: string, status = 500) {
  return c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="120">
       <text x="20" y="60">${escapeXml(message)}</text>
     </svg>`,
    status,
    { "Content-Type": "image/svg+xml; charset=utf-8" }
  );
}
