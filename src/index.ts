import { Hono } from "hono";
import type { Context } from "hono";

/* =========================================================
 * Types
 * ======================================================= */

type DuomeLang = {
  language?: string;
  code?: string;
  xp?: number;
  points?: number;
  from?: string;
  fromLanguage?: string;
};

type DuomeUserRaw = {
  username?: string;
  name?: string;
  streak?: number;
  site?: { streak?: number };
  has_plus?: boolean;
  hasPlus?: boolean;
  total_xp?: number;
  totalXp?: number;
  languages?: DuomeLang[];
  picture?: string;
  profile_picture?: string;
  avatar?: string;
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

/**
 * GET /:username
 * Optional second path segment `s` enables special courses display.
 */
app.get("/:username", async (c) => {
  const url = new URL(c.req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  const username = pathParts[0];
  const showSpecial = pathParts[1] === "s";

  if (!username || username === "favicon.ico") {
    return c.body(null, 204);
  }

  const theme = c.req.query("theme") ?? "";
  const iconPos = c.req.query("icon") ?? "left";

  const isDark = theme === "dark";
  const isDuolingo = theme === "duolingo";
  const isSuper = theme === "super";

  /* ---------- cache key ---------- */

  const cache = typeof caches !== "undefined" ? caches : undefined;

  const cacheKeyUrl = new URL(c.req.url);
  cacheKeyUrl.search = "";
  cacheKeyUrl.searchParams.set("theme", isDark ? "dark" : "light");

  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

  try {
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const rawUser = await fetchUserData(username, cacheKeyUrl.origin);
    const user = normalizeUser(rawUser, username);

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

    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        /* non-fatal */
      }
    }

    return response;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Duome API error";

    const status =
      err instanceof Error && typeof (err as FetchError).status === "number"
        ? (err as FetchError).status
        : 500;

    if (status === 404) {
      return errorSvg(c, `User "${username}" not found`, 404);
    }

    if (status === 429) {
      return errorSvg(c, "Rate limit exceeded", 429);
    }

    return errorSvg(c, message, status);
  }
});

export default { fetch: app.fetch };

/* =========================================================
 * Configuration
 * ======================================================= */

const DUOME_BASE = "https://www.duome.eu/api/username/";
const FLAG_BASE =
  "https://cdn.jsdelivr.net/gh/Wojix/duolingo-card@main/flag/";

/* =========================================================
 * Fetch helpers
 * ======================================================= */

function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(input, { ...init, signal: controller.signal }).finally(
    () => clearTimeout(id)
  ) as Promise<Response>;
}

async function fetchUserData(
  username: string,
  origin: string
): Promise<DuomeUserRaw> {
  const url = DUOME_BASE + encodeURIComponent(username);
  const cacheKey = new Request(`${origin}/.cache/user/${username}`);

  try {
    if (typeof caches !== "undefined") {
      const cached = await caches.match(cacheKey);
      if (cached) return (await cached.json()) as DuomeUserRaw;
    }
  } catch {
    /* ignore */
  }

  const res = await fetchWithTimeout(url, {}, 6000);

  if (!res.ok) {
    const err = new Error(
      `Duome API error (${res.status})`
    ) as FetchError;
    err.status = res.status;

    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) err.message = json.message;
    } catch {
      /* ignore */
    }

    throw err;
  }

  const json = (await res.json()) as DuomeUserRaw;

  try {
    if (typeof caches !== "undefined") {
      const resp = new Response(JSON.stringify(json), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
      await caches.put(cacheKey, resp.clone());
    }
  } catch {
    /* ignore */
  }

  return json;
}

/* =========================================================
 * Normalization
 * ======================================================= */

function normalizeUser(
  raw: DuomeUserRaw,
  fallbackUsername: string
): User {
  if (raw?.username && Array.isArray(raw.languages)) {
    return {
      name: raw.name || raw.username,
      username: raw.username,
      streak: raw.streak ?? raw.site?.streak ?? 0,
      hasPlus: raw.has_plus ?? raw.hasPlus ?? false,
      total_xp: raw.total_xp ?? raw.totalXp ?? 0,
      languages: raw.languages.map((l) => ({
        learningLanguage: l.language || l.code || "",
        points: l.xp ?? l.points ?? 0,
        from: l.from || l.fromLanguage,
      })),
      picture:
        raw.picture ||
        raw.profile_picture ||
        raw.avatar ||
        null,
    };
  }

  return {
    name: fallbackUsername,
    username: fallbackUsername,
    streak: 0,
    hasPlus: false,
    total_xp: 0,
    languages: [],
    picture: null,
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

  for (const suffix of ["/xlarge", "/large", ""]) {
    try {
      const res = await fetchWithTimeout(src + suffix, {}, 5000);
      if (!res.ok) continue;

      const type = res.headers.get("Content-Type") ?? "image/jpeg";
      const ext = type.split("/").pop() ?? "jpeg";
      const b64 = await responseToBase64(res);

      return `data:image/${ext};base64,${b64}`;
    } catch {
      /* try next */
    }
  }

  return fallback;
}

async function responseToBase64(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < sub.length; j++) {
      binary += String.fromCharCode(sub[j]);
    }
  }

  return btoa(binary);
}

/* =========================================================
 * Courses / Flags
 * ======================================================= */

function detectCourses(langs: Language[], showSpecial: boolean) {
  const xpMap = new Map<string, number>();
  const seen = new Set<string>();

  const detected: {
    code: string;
    points: number;
    isSpecial: boolean;
  }[] = [];

  for (const l of langs) {
    const points = l.points ?? 0;
    const from = l.from ?? "unknown";
    const key = `${l.learningLanguage}_from_${from}`;

    xpMap.set(key, Math.max(points, xpMap.get(key) ?? 0));

    if (
      l.learningLanguage &&
      !seen.has(l.learningLanguage) &&
      !(l.learningLanguage === "en" && from === "en") &&
      points > 0
    ) {
      seen.add(l.learningLanguage);
      detected.push({
        code: l.learningLanguage,
        points,
        isSpecial: false,
      });
    }
  }

  if (showSpecial) {
    for (const code of ["zs", "ms", "zc"]) {
      if (!seen.has(code)) {
        detected.push({
          code,
          points: -1,
          isSpecial: true,
        });
      }
    }
  }

  const calculatedTotalXp = [...xpMap.values()].reduce(
    (a, b) => a + b,
    0
  );

  detected.sort((a, b) => {
    if (a.isSpecial !== b.isSpecial) {
      return a.isSpecial ? -1 : 1;
    }
    if (a.isSpecial && b.isSpecial) {
      return ["zs", "ms", "zc"].indexOf(a.code) -
             ["zs", "ms", "zc"].indexOf(b.code);
    }
    return b.points - a.points;
  });

  return {
    detectedCodes: detected.map((d) => d.code).slice(0, 50),
    calculatedTotalXp,
  };
}

async function fetchFlags(codes: string[]): Promise<string[]> {
  const result: string[] = [];

  for (const code of codes) {
    try {
      const res = await fetchWithTimeout(
        `${FLAG_BASE}${code}.svg`,
        {},
        4000
      );
      if (!res.ok) continue;

      const b64 = await responseToBase64(res);
      result.push(`data:image/svg+xml;base64,${b64}`);
    } catch {
      /* ignore */
    }
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
  const {
    user,
    avatar,
    flags,
    iconPos,
    isDark,
    isDuolingo,
    isSuper,
    calculatedTotalXp,
  } = opts;

  const customWhite = "#F5FBFF";

  const colors = isDuolingo
    ? {
        bg: "#58cc02",
        name: customWhite,
        handle: "rgba(245,251,255,0.7)",
        line: "rgba(255,255,255,0.25)",
      }
    : isSuper
    ? {
        bg: "url(#g)",
        name: customWhite,
        handle: "rgba(245,251,255,0.7)",
        line: "rgba(255,255,255,0.25)",
      }
    : {
        bg: isDark ? "#1a1a1a" : customWhite,
        name: isDark ? customWhite : "#000",
        handle: isDark ? "#aaa" : "#666",
        line: isDark ? "#333" : "#e5e5e5",
      };

  const rows = Math.ceil(flags.length / 10);
  const height = 130 + rows * 30 + 10;

  const isRight = iconPos === "right";

  const ax = isRight ? 275 : 25;
  const tx = isRight ? 25 : 90;
  const sx = isRight ? 25 : 90;
  const px = isRight ? 180 : 245;

  const font =
    "'Noto Sans JP','Hiragino Kaku Gothic ProN','Meiryo',sans-serif";

  const badge = user.hasPlus
    ? `<g transform="translate(${px},15)">
         <circle cx="8" cy="8" r="8" fill="#3C4DFF" fill-opacity="0.3"/>
       </g>`
    : "";

  const flagsSvg = flags
    .map(
      (src, i) =>
        `<image x="${25 + (i % 10) * 30}"
                y="${132 + Math.floor(i / 10) * 30}"
                width="22"
                height="22"
                href="${src}"/>`
    )
    .join("");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="350" height="${height}" viewBox="0 0 350 ${height}">
  <defs>
    ${
      isSuper
        ? `<linearGradient id="g" x1="0" y1="0" x2="350" y2="${height}">
             <stop stop-color="#26FF55"/>
             <stop offset="0.52" stop-color="#268AFF"/>
             <stop offset="1" stop-color="#FC55FF"/>
           </linearGradient>`
        : ""
    }
    <clipPath id="cp">
      <circle cx="${ax + 25}" cy="45" r="25"/>
    </clipPath>
  </defs>

  <rect width="100%" height="100%" rx="15" fill="${colors.bg}"/>

  <text x="${tx}" y="42" font-family="${font}" font-size="20" font-weight="700" fill="${colors.name}">
    ${escapeXml(user.name)}
  </text>

  <text x="${tx}" y="62" font-family="${font}" font-size="14" fill="${colors.handle}">
    @${escapeXml(user.username)}
  </text>

  <g>
    <circle cx="${ax + 25}" cy="45" r="26" fill="${colors.line}"/>
    <image x="${ax}" y="20" width="50" height="50" href="${avatar}" clip-path="url(#cp)"/>
  </g>

  ${badge}

  <g transform="translate(${sx},80)">
    <text x="0" y="16" font-family="${font}" font-size="15" fill="#ff9600">
      ${user.streak.toLocaleString()} streak
    </text>
    <g transform="translate(120,0)">
      <text x="0" y="16" font-family="${font}" font-size="15" fill="#ffd900">
        ${(user.total_xp || calculatedTotalXp).toLocaleString()} XP
      </text>
    </g>
  </g>

  <line x1="25" y1="115" x2="325" y2="115" stroke="${colors.line}" stroke-width="1"/>

  ${flagsSvg}
</svg>`;
}

/* =========================================================
 * Utilities / Error
 * ======================================================= */

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    } as Record<string, string>)[c]
  );
}

function errorSvg(
  c: Context,
  message: string,
  status = 500
) {
  return c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="120">
       <rect width="100%" height="100%" fill="#fff" rx="12"/>
       <text x="20" y="50" font-size="14">
         ${escapeXml(message)}
       </text>
     </svg>`,
    status,
    {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    }
  );
}
