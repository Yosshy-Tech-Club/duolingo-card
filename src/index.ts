import { Hono } from "hono";

type DuoApiError = {
  message?: string;
  type?: string;
};

type DuoUser = {
  name: string | null;
  username: string;
  streak: number;
  picture: string;
  languages?: Array<{
    learningLanguage: string;
    fromLanguage: string;
    points?: number;
    xp?: number;
  }>;
  courses?: Array<{
    learningLanguage: string;
    fromLanguage: string;
    points?: number;
    xp?: number;
  }>;
};

const app = new Hono();

async function fetchDuo<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.ok) {
    return res.json() as Promise<T>;
  }
  let message = `Duolingo API error (${res.status})`;
  try {
    const err: DuoApiError = await res.json();
    if (err?.message) {
      message = err.message;
    }
  } catch { /* Ignore */ }
  const error = new Error(message) as Error & {
    status?: number;
    type?: string;
  };
  error.status = res.status;
  throw error;
}

function toBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchDuolingoUser(username: string): Promise<DuoUser> {
  const data = await fetchDuo<{ users: DuoUser[] }>(
    `https://www.duolingo.com/2017-06-30/users?username=${username}`
  );
  const user = data.users && data.users.length > 0 ? data.users[0] : null;
  if (!user) {
    const error = new Error("User not found");
    (error as any).status = 404;
    throw error;
  }
  return user;
}

/**
 * GET /{username}
 */
app.get("/:username", async (c) => {
  const usernameParam = c.req.param("username");
  const themeParam = c.req.query("theme");
  const theme = ["dark", "super"].includes(themeParam ?? "") ? themeParam : null;

  const cache = caches.default; // Cloudflare Workers default cache
  const url = new URL(c.req.url);
  url.search = "";
  if (theme) url.searchParams.set("theme", theme);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const user = await fetchDuolingoUser(usernameParam);
    const name = user.name || user.username;
    const handle = user.username;
    const streak = user.streak ?? 0;
    let avatarBase64 = "";
    const fallbackSvg = `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="120" rx="60" fill="#50C800"/><path fill-rule="evenodd" clip-rule="evenodd" d="M68.8659 39.2716L85.2931 21.6616C86.2224 20.6438 87.5094 20.8152 88.2033 21.9987C89.7131 24.5794 90.3746 27.4857 90.23 30.3602C90.2465 30.3613 90.2631 30.3628 90.2796 30.3642C90.3052 30.3664 90.331 30.3687 90.3571 30.3698L94.1614 26.2021C95.0908 25.1842 96.755 25.3556 97.4488 26.5401C98.6127 28.5286 99.2655 30.7126 99.4414 32.9265C106.324 36.5955 111 43.7725 111 52.0252V66.0231C111 78.0083 101.14 87.7247 88.9762 87.7247H87.3267C78.214 87.7247 70.3943 82.2704 67.0453 74.4934C64.4333 74.4818 62.0998 74.4729 60.0452 74.4668C57.9688 74.4729 55.6052 74.4819 52.9547 74.4937C49.6057 82.2707 41.786 87.725 32.6733 87.725H31.0238C18.8602 87.725 9 78.0086 9 66.0233V52.0255C9 43.7728 13.676 36.5957 20.5586 32.9268C20.7345 30.7129 21.3873 28.5289 22.5512 26.5403C23.245 25.3559 24.9093 25.1845 25.8386 26.2023L29.6429 30.3701C29.669 30.3689 29.6948 30.3667 29.7204 30.3645C29.7369 30.363 29.7535 30.3616 29.77 30.3605C29.6253 27.486 30.2869 24.5797 31.7967 21.9989C32.4906 20.8154 33.7776 20.644 34.7069 21.6619L51.1341 39.2718C53.7249 41.0717 56.8266 41.9791 59.9283 41.9985C63.0777 42.0066 66.2352 41.0992 68.8659 39.2716Z" fill="#8EE000"/><path fill-rule="evenodd" clip-rule="evenodd" d="M32.4217 39.7778C41.0572 39.7778 48.0664 46.7773 48.0664 55.4225V64.6873C48.0664 73.3228 41.0669 80.3319 32.4217 80.3319C23.7862 80.3319 16.7771 73.3325 16.7771 64.6873V55.4225C16.7771 46.7773 23.7862 39.7778 32.4217 39.7778Z" fill="white"/><path fill-rule="evenodd" clip-rule="evenodd" d="M87.381 39.7778C96.0165 39.7778 103.026 46.7773 103.026 55.4225V64.6873C103.026 73.3228 96.0262 80.3319 87.381 80.3319C78.7454 80.3319 71.7363 73.3325 71.7363 64.6873V55.4225C71.7363 46.7773 78.7358 39.7778 87.381 39.7778Z" fill="white"/><path fill-rule="evenodd" clip-rule="evenodd" d="M34.8321 48.7622C38.9272 48.7622 42.2575 52.0828 42.2575 56.1876V64.1164C42.2575 68.2115 38.9369 71.5418 34.8321 71.5418C30.737 71.5418 27.4067 68.2212 27.4067 64.1164V56.1876C27.4067 52.0828 30.737 48.7622 34.8321 48.7622Z" fill="#4B4B4B"/><path fill-rule="evenodd" clip-rule="evenodd" d="M60.0037 66.7622C64.699 66.7622 68.5036 70.5669 68.5036 75.2622V78.2149C68.5036 82.9103 64.699 86.7149 60.0037 86.7149C55.3083 86.7149 51.5037 82.9103 51.5037 78.2149V75.2622C51.5037 70.5669 55.3083 66.7622 60.0037 66.7622Z" fill="#F48000"/><path d="M48.27 76.0748C49.2865 70.6533 54.311 66.7422 60.323 66.7422C65.7928 66.7422 70.7398 70.7502 71.737 76.0748V76.5104C71.737 76.8492 71.6208 76.9848 71.311 76.9461L60.3326 78.9016C60.0325 78.9016 59.9938 78.9016 59.684 78.9016L48.696 76.9364C48.3862 76.9751 48.27 76.8396 48.27 76.5007V76.0748Z" fill="#FFC200"/><path fill-rule="evenodd" clip-rule="evenodd" d="M58.2029 68.6207C58.7741 68.4852 59.3646 68.4077 59.9552 68.4077C60.5844 68.4077 61.2234 68.4852 61.8526 68.6497C63.1305 68.9789 64.0212 70.1309 64.0212 71.4476C64.0212 72.5125 63.1596 73.3644 62.1044 73.3644H57.9028C56.8379 73.3644 55.9859 72.5028 55.9859 71.4476C55.9762 70.1116 56.8959 68.9402 58.2029 68.6207Z" fill="#FFE747"/><path fill-rule="evenodd" clip-rule="evenodd" d="M84.9703 48.7622C89.0654 48.7622 92.3957 52.0828 92.3957 56.1876V64.1164C92.3957 68.2115 89.0751 71.5418 84.9703 71.5418C80.8752 71.5418 77.5449 68.2212 77.5449 64.1164V56.1876C77.5546 52.0828 80.8752 48.7622 84.9703 48.7622Z" fill="#4B4B4B"/><path d="M28.5587 57.7653C31.2054 57.7653 33.3509 55.6284 33.3509 52.9925C33.3509 50.3566 31.2054 48.2197 28.5587 48.2197C25.9121 48.2197 23.7666 50.3566 23.7666 52.9925C23.7666 55.6284 25.9121 57.7653 28.5587 57.7653Z" fill="white"/><path d="M77.9708 57.7653C80.6175 57.7653 82.763 55.6284 82.763 52.9925C82.763 50.3566 80.6175 48.2197 77.9708 48.2197C75.3242 48.2197 73.1787 50.3566 73.1787 52.9925C73.1787 55.6284 75.3242 57.7653 77.9708 57.7653Z" fill="white"/></svg>`;
    const fallbackBase64 = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`;

    try {
      const imgUrl = user.picture.startsWith("http") ? user.picture : `https:${user.picture}`;
      let imgRes = await fetch(imgUrl + "/xlarge");
      if (!imgRes.ok) {
        imgRes = await fetch(imgUrl + "/large");
      }
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        avatarBase64 = `data:image/jpeg;base64,${toBase64(buffer)}`;
      }
    } catch { /**/ }

    if (!avatarBase64) avatarBase64 = fallbackBase64;

    const allPossibleCourses = [...(user.languages || []), ...(user.courses || [])];
    let detectedCodes: { code: string; points: number }[] = [];
    const seenForFlags = new Set<string>();
    const xpCounter = new Map<string, number>();
    allPossibleCourses.forEach((l) => {
      const points = l.points ?? l.xp ?? 0;
      const learningLanguage = l.learningLanguage;
      const fromLanguage = l.fromLanguage;
      const courseKey = `${learningLanguage}_from_${fromLanguage}`;
      if (points > (xpCounter.get(courseKey) || 0)) xpCounter.set(courseKey, points);
      if (learningLanguage && !seenForFlags.has(learningLanguage)) {
        if (!(learningLanguage === "en" && fromLanguage === "en") && points > 0) {
          seenForFlags.add(learningLanguage);
          detectedCodes.push({ code: learningLanguage, points: points });
        }
      }
    });

    let calculatedTotalXp = 0;
    for (let xp of xpCounter.values()) calculatedTotalXp += xp;

    detectedCodes.sort((a, b) => { return b.points - a.points; });

    const finalCodes = detectedCodes.map((c) => c.code).slice(0, 50);
    const flagBaseUrl = "https://cdn.jsdelivr.net/gh/Yosshy-Tech-Club/duolingo-card@main/flag/";
    let duoBase64 = "";
    try {
      const duoRes = await fetch(`${flagBaseUrl}duo.svg`);
      if (duoRes.ok) {
        const blob = await duoRes.arrayBuffer();
        duoBase64 = `data:image/svg+xml;base64,${toBase64(blob)}`;
      }
    } catch {
      /* Ignore */
    }

    const flagImages = await Promise.all(
      finalCodes.map(async (code) => {
        try {
          const imgRes = await fetch(`${flagBaseUrl}${code}.svg`);
          if (!imgRes.ok) return null;
          const blob = await imgRes.arrayBuffer();
          return `data:image/svg+xml;base64,${toBase64(blob)}`;
        } catch {
          return null;
        }
      })
    );

    const validFlags = flagImages.filter((img): img is string => img !== null);
    const flagsSvg = validFlags
      .map((src, i) => {
        const x = 25 + (i % 10) * 30;
        const y = 132 + Math.floor(i / 10) * 30;
        return `<image x="${x}" y="${y}" width="22" height="22" href="${src}" />`;
      })
      .join("");

    const rowCount = Math.ceil(validFlags.length / 10);
    const svgHeight = 130 + rowCount * 30 + 10;

    const customWhite = "#F5FBFF";
    const isDark = theme === "dark";
    const isSuper = theme === "super";
    let colors = {
      bg: isDark ? "#1a1a1a" : customWhite,
      name: isDark ? customWhite : "#000000",
      handle: isDark ? "#aaa" : "#666",
      line: isDark ? "#333" : "#e5e5e5",
    };
    if (isSuper) {
      colors = {
        bg: "url(#paint0_linear_852_38759)",
        name: customWhite,
        handle: "rgba(245, 251, 255, 0.7)",
        line: "rgba(255, 255, 255, 0.25)",
      };
    }

    const avatarX = 25;
    const textBaseX = 90;
    const streakBaseX = 90;
    const duoLogoX = textBaseX + (handle.length * 8) + 20;
    const fontStack = "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif";

    const svg = `
        <svg width="350" height="${svgHeight}" viewBox="0 0 350 ${svgHeight}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
          <style>image { image-rendering: -webkit-optimize-contrast; }</style>
          <defs>
            <linearGradient id="paint0_linear_852_38759" x1="0" y1="0" x2="350" y2="${svgHeight}" gradientUnits="userSpaceOnUse">
              <stop stop-color="#26FF55"/><stop offset="0.52" stop-color="#268AFF"/><stop offset="1" stop-color="#FC55FF"/></linearGradient>
            <radialGradient id="paint_super_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(21.5609 3.41217) rotate(23.2164) scale(52.2261 67.7741)">
              <stop stop-color="#26FF55"/><stop offset="0.523569" stop-color="#268AFF"/><stop offset="1" stop-color="#FC55FF"/></radialGradient>
            <clipPath id="cp"><circle cx="${avatarX + 25}" cy="45" r="25"/></clipPath>
            <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/></filter>
          </defs>
          <rect width="100%" height="100%" fill="${colors.bg}" rx="15"/>
          <text x="${textBaseX}" y="42" font-family="${fontStack}" font-size="20" fill="${colors.name}" font-weight="bold">${name}</text>
          <text x="${textBaseX}" y="62" font-family="${fontStack}" font-size="14" fill="${colors.handle}">@${handle}</text>
          <image x="${duoLogoX}" y="46" width="20" height="20" href="${duoBase64}"/>
          <g filter="url(#sh)">
            <circle cx="${avatarX + 25}" cy="45" r="26" fill="${colors.line}"/>
            <image x="${avatarX}" y="20" width="50" height="50" href="${avatarBase64}" clip-path="url(#cp)"/>
          </g>
          <g transform="translate(${streakBaseX}, 80)">
            <svg width="16" height="20" viewBox="0 0 16 20">
              <path d="M6.77271 0.532617C7.336 -0.177539 8.414 -0.177539 8.97729 0.532616L14.0623 6.94342C15.1193 8.23421 15.75 9.86374 15.75 11.6351C15.75 15.8233 12.2242 19.2185 7.875 19.2185C3.52576 19.2185 0 15.8233 0 11.6351C0 11.3414 0.0173457 11.0515 0.0511046 10.7664L0.0333507 4.37841C0.0307386 3.43858 0.542464 2.74527 1.41725 2.89269C1.59157 2.92207 1.9601 3.0331 2.12522 3.12149L3.94611 4.09617L6.77271 0.532617Z" fill="#FF9600"/>
              <path d="M8.40677 8.24144C8.1299 7.86443 7.5667 7.86443 7.28982 8.24144L5.30202 10.9482C5.28343 10.9735 5.2689 11 5.25814 11.027C4.7842 11.5866 4.5 12.3011 4.5 13.0796C4.5 14.8745 6.01104 16.3296 7.875 16.3296C9.73896 16.3296 11.25 14.8745 11.25 13.0796C11.25 12.2008 10.8878 11.4035 10.2993 10.8185L8.40677 8.24144Z" fill="#FFC800"/>
            </svg>
            <text x="23" y="16" font-family="${fontStack}" font-size="15" fill="#ff9600" font-weight="600">${streak} streak</text>
            <g transform="translate(120, 0)">
              <svg width="16" height="22" viewBox="0 0 22 30">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M14.0367 2.67272C13.8379 0.718003 11.3282 0.0455378 10.1787 1.63898L0.717665 14.7538C-0.157342 15.9667 0.452676 17.6801 1.89732 18.0672L7.2794 19.5093L8.07445 27.3273C8.27323 29.282 10.7829 29.9545 11.9324 28.361L21.3935 15.2462C22.2685 14.0333 21.6585 12.3199 20.2138 11.9328L14.8317 10.4907L14.0367 2.67272Z" fill="#FFD900"/>
                <path d="M2.574 16.4882C2.08457 16.3561 2.03731 15.6803 2.50359 15.4813L6.24415 13.8853C6.58188 13.7412 6.96093 13.973 6.98654 14.3393L7.17226 16.9952C7.19787 17.3615 6.85477 17.6438 6.50027 17.5481L2.574 16.4882Z" fill="#F7C100"/>
                <path d="M19.717 13.2505C20.2064 13.3826 20.2537 14.0584 19.7874 14.2573L16.0469 15.8533C15.7091 15.9974 15.3301 15.7656 15.3045 15.3993L15.1188 12.7435C15.0931 12.3772 15.4362 12.0949 15.7907 12.1906L19.717 13.2505Z" fill="#FFEF8F"/>
              </svg>
              <text x="21" y="16" font-family="${fontStack}" font-size="15" fill="#ffd900" font-weight="600">${calculatedTotalXp.toLocaleString()} XP</text>
            </g>
          </g>
          <line x1="25" y1="115" x2="325" y2="115" stroke="${colors.line}" stroke-width="1"/>
          ${flagsSvg}
        </svg>
      `;

    const response = new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err: unknown) {
    let message = "Duolingo API error";
    let status = 500;
    if (err instanceof Error) {
      message = err.message;
      if ("status" in err && typeof (err as any).status === "number") {
        status = (err as any).status;
      }
    }
    if (status === 404) {
      return errorSvg(c, `User "${usernameParam}" not found`, 404);
    }
    if (status === 429) {
      return errorSvg(c, "Rate limit exceeded", 429);
    }
    return errorSvg(c, message, status);
  }
});

function errorSvg(c: any, message: string, status = 500) {
  const safeMessage = escapeXml(message);
  return c.body(
    `
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="80">
  <rect width="100%" height="100%" rx="12" fill="#fee2e2"/>
  <text x="20" y="46"
        font-size="14"
        fill="#991b1b"
        font-family="system-ui">
    ${safeMessage}
  </text>
</svg>
`,
    status,
    {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    }
  );
}

function escapeXml(str: string) {
  return str.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!)
  );
}

export default {
  fetch: app.fetch,
};
