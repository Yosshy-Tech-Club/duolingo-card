import { Hono } from "hono";
import type { Context } from "hono";

/* =========================================================
 * Types
 * ========================================================= */
type QiitaUser = {
  id: string;
  name: string | null;
  profile_image_url: string;
  followers_count: number;
};

type QiitaItem = {
  likes_count: number;
  stocks_count: number;
};

type QiitaApiError = {
  message?: string;
  type?: string;
};

/* =========================================================
 * App
 * ========================================================= */
const app = new Hono();

/* =========================================================
 * Qiita API Client
 * ========================================================= */
async function fetchQiita<T>(url: string): Promise<T> {
  const res = await fetch(url);

  if (res.ok) {
    return res.json() as Promise<T>;
  }

  let message = `Qiita API error (${res.status})`;

  try {
    const err: QiitaApiError = await res.json();
    if (err?.message) {
      message = err.message;
    }
  } catch {
    /* non-json response */
  }

  const error = new Error(message) as Error & { status?: number };
  error.status = res.status;
  throw error;
}

async function fetchAllItems(userId: string): Promise<QiitaItem[]> {
  const items: QiitaItem[] = [];
  let page = 1;

  while (true) {
    const data = await fetchQiita<QiitaItem[]>(
      `https://qiita.com/api/v2/users/${userId}/items?per_page=100&page=${page}`
    );

    if (data.length === 0) {
      break;
    }

    items.push(...data);
    page++;
  }

  return items;
}

/* =========================================================
 * Utilities
 * ========================================================= */
function resolveUsername(user: QiitaUser): string {
  if (user.name && user.name.trim() !== "") {
    return user.name;
  }
  return user.id;
}

function escapeXml(str: string): string {
  return str.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!)
  );
}

function makeSafeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}

async function imagetobase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Icon fetch failed");
  }

  const contentType = res.headers.get("content-type") ?? "image/png";
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:${contentType};base64,${btoa(binary)}`;
}

/* =========================================================
 * Route
 * ========================================================= */
app.get("/:user_id", async (c) => {
  const userId = c.req.param("user_id");
  const theme = c.req.query("theme") === "dark" ? "dark" : "light";

  const cache = caches.default;

  const url = new URL(c.req.url);
  url.search = "";
  url.searchParams.set("theme", theme);

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const user = await fetchQiita<QiitaUser>(
      `https://qiita.com/api/v2/users/${userId}`
    );
    const items = await fetchAllItems(userId);

    const posts = items.length;
    const likes = items.reduce((a, b) => a + b.likes_count, 0);
    const stocks = items.reduce((a, b) => a + b.stocks_count, 0);

    const svg = generateSvg({
      username: resolveUsername(user),
      userId: user.id,
      icon: await imagetobase64(user.profile_image_url),
      posts,
      likes,
      stocks,
      followers: user.followers_count,
      theme,
      clipId: `avatar-${makeSafeId(user.id)}`,
    });

    const response = new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control":
          "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
      },
    });

    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err: unknown) {
    let status = 500;
    let message = "Qiita API error";

    if (err instanceof Error) {
      message = err.message;
      if ("status" in err && typeof (err as any).status === "number") {
        status = (err as any).status;
      }
    }

    if (status === 404) {
      return errorSvg(c, `User "${userId}" not found`, 404);
    }

    if (status === 429) {
      return errorSvg(c, "Rate limit exceeded", 429);
    }

    return errorSvg(c, message, status);
  }
});

export default {
  fetch: app.fetch,
};

/* =========================================================
 * SVG Rendering
 * ========================================================= */
function generateSvg(data: {
  username: string;
  userId: string;
  icon: string;
  posts: number;
  likes: number;
  stocks: number;
  followers: number;
  theme: string;
  clipId: string;
}): string {
  const dark = data.theme === "dark";

  const bgTop = dark ? "#071018" : "#ffffff";
  const bgBottom = dark ? "#04060a" : "#f8fafc";
  const cardBg = dark ? "#071018" : "#fbfdff";
  const fg = dark ? "#e6f0e0" : "#0b1220";
  const sub = dark ? "#93a09a" : "#6b7280";
  const accent = "#55c500";

  const uid = makeSafeId(data.userId);

  const usernameEsc = escapeXml(data.username);
  const userIdEsc = escapeXml(data.userId);

  const postsStr = formatNumber(data.posts);
  const likesStr = formatNumber(data.likes);
  const stocksStr = formatNumber(data.stocks);
  const followersStr = formatNumber(data.followers);

  const accentGradId = `accentGrad-${uid}`;
  const panelGlossId = `panelGloss-${uid}`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160" viewBox="0 0 420 160" role="img" aria-label="Qiita profile card for ${usernameEsc}">
  <defs>
    <linearGradient id="bgGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>

    <linearGradient id="${accentGradId}" x1="0" x2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="#7ce24a" stop-opacity="0.95"/>
    </linearGradient>

    <clipPath id="${data.clipId}">
      <circle cx="44" cy="44" r="22"/>
    </clipPath>

    <linearGradient id="${panelGlossId}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="${dark ? 0.02 : 0.06}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="420" height="160" rx="12" fill="${cardBg}"/>
  <rect width="420" height="160" rx="12" fill="url(#${panelGlossId})" style="mix-blend-mode:overlay"/>

  <circle cx="44" cy="44" r="26" fill="${dark ? "#071617" : "#f1f5f9"}"/>
  <circle cx="44" cy="44" r="26" stroke="url(#${accentGradId})" stroke-width="2" fill="none"/>

  <image href="${data.icon}" x="22" y="22" width="44" height="44"
         clip-path="url(#${data.clipId})" preserveAspectRatio="xMidYMid slice"/>

  <text x="84" y="36" font-size="16" font-weight="700" fill="${fg}" font-family="system-ui">
    ${usernameEsc}
  </text>

  <text x="84" y="56" font-size="12" fill="${sub}" font-family="system-ui">
    @${userIdEsc}
  </text>

  <g transform="translate(16,84)">
    ${createStatBox(0, postsStr, "Posts", postsIconSvg, fg, sub)}
    ${createStatBox(98, likesStr, "LGTM", heartIconSvg, fg, sub)}
    ${createStatBox(196, stocksStr, "Stocks", bookmarkIconSvg, fg, sub)}
    ${createStatBox(294, followersStr, "Followers", userIconSvg, fg, sub)}
  </g>
</svg>
`;
}

/* =========================================================
 * SVG Components
 * ========================================================= */
function createStatBox(
  x: number,
  value: string,
  label: string,
  icon: (c: string) => string,
  valueColor: string,
  labelColor: string
): string {
  return `
<g transform="translate(${x},0)">
  <svg x="10" y="10" width="20" height="20" viewBox="0 0 32 32">
    ${icon(valueColor)}
  </svg>
  <text x="34" y="18" font-size="14" font-weight="700" fill="${valueColor}" font-family="system-ui">
    ${value}
  </text>
  <text x="34" y="34" font-size="11" fill="${labelColor}" font-family="system-ui">
    ${label}
  </text>
</g>`;
}

/* =========================================================
 * Icons
 * ========================================================= */
function postsIconSvg(color: string): string {
  return `<path d="M15 8H17M15 12H17M17 16H7M7 8V12H11V8H7ZM5 20H19C20.1 20 21 19.1 21 18V6C21 4.9 20.1 4 19 4H5C3.9 4 3 4.9 3 6V18C3 19.1 3.9 20 5 20Z"
    stroke="${color}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function heartIconSvg(color: string): string {
  return `<path d="M12 6C10.2 3.9 7.2 3.3 4.9 5.2C2.6 7.1 2.4 10.3 4.1 12.6C5.6 14.5 10.1 18.4 11.5 19.7"
    stroke="${color}" fill="none" stroke-width="2"/>`;
}

function bookmarkIconSvg(color: string): string {
  return `<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-3z" fill="${color}"/>`;
}

function userIconSvg(color: string): string {
  return `<path d="M11 14c-3.3 0-6 2.7-6 6M11 11a4 4 0 1 0 0-8"
    stroke="${color}" fill="none" stroke-width="2"/>`;
}

/* =========================================================
 * Error SVG
 * ========================================================= */
function errorSvg(c: Context, message: string, status = 500) {
  return c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="80">
      <rect width="100%" height="100%" rx="12" fill="#fee2e2"/>
      <text x="20" y="46" font-size="14" fill="#991b1b" font-family="system-ui">
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
