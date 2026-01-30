import { Hono } from 'hono'
import type { Context } from 'hono'

/* =====================
 * Types
 * ===================== */

type Theme = 'light' | 'dark'

type DuolingoApiResponse = {
  users?: DuolingoUser[]
}

type DuolingoUser = {
  username: string
  name?: string
  picture: string
  streak?: number
  languages?: DuolingoCourse[]
  courses?: DuolingoCourse[]
}

type DuolingoCourse = {
  learningLanguage?: string
  fromLanguage?: string
  points?: number
  xp?: number
}

/* =====================
 * App
 * ===================== */

const app = new Hono()

app.get('/:username/*', async (c) => {
  const username = c.req.param('username')
  if (!username) return c.body(null, 204)

  const showSpecial = c.req.path.endsWith('/s')
  const theme: Theme = c.req.query('theme') === 'dark' ? 'dark' : 'light'

  try {
    const user = await fetchUser(username)
    const avatar = await loadAvatar(user.picture)
    const { flags, totalXp } = resolveCourses(user, showSpecial)

    const svg = buildSvg({
      user,
      avatar,
      flags,
      totalXp,
      theme,
    })

    return svgResponse(svg)
  } catch (err) {
    return errorSvg(c, err instanceof Error ? err.message : 'Error')
  }
})

export default { fetch: app.fetch }

/* =====================
 * Fetch
 * ===================== */

async function fetchUser(username: string): Promise<DuolingoUser> {
  const res = await fetch(`https://www.duolingo.com/2017-06-30/users?username=${username}`)
  if (!res.ok) throw new Error('User not found')
  const json = (await res.json()) as DuolingoApiResponse
  const user = json.users?.[0]
  if (!user) throw new Error('User not found')
  return user
}

/* =====================
 * Domain
 * ===================== */

function resolveCourses(user: DuolingoUser, showSpecial: boolean) {
  const courses = [...(user.languages ?? []), ...(user.courses ?? [])]

  const flags: { code: string; xp: number; special: boolean }[] = []
  const seen = new Set<string>()
  let totalXp = 0

  for (const c of courses) {
    const xp = c.points ?? c.xp ?? 0
    if (!c.learningLanguage) continue

    totalXp += xp

    if (!seen.has(c.learningLanguage)) {
      seen.add(c.learningLanguage)
      flags.push({ code: c.learningLanguage, xp, special: false })
    }
  }

  if (showSpecial) {
    for (const code of ['zs', 'ms', 'zc']) {
      if (!seen.has(code)) flags.push({ code, xp: 0, special: true })
    }
  }

  flags.sort((a, b) =>
    a.special !== b.special ? Number(b.special) - Number(a.special) : b.xp - a.xp
  )

  return {
    totalXp,
    flags: flags.map((f) => f.code).slice(0, 32),
  }
}

/* =====================
 * Assets
 * ===================== */

async function loadAvatar(picture: string): Promise<string> {
  const base = picture.startsWith('http') ? picture : `https:${picture}`
  const res = await fetch(`${base}/xlarge`)
  if (!res.ok) throw new Error('Avatar fetch failed')
  return toBase64(await res.arrayBuffer(), 'image/jpeg')
}

/* =====================
 * SVG
 * ===================== */

function buildSvg(args: {
  user: DuolingoUser
  avatar: string
  flags: string[]
  totalXp: number
  theme: Theme
}) {
  const dark = args.theme === 'dark'

  const color = {
    bg: dark ? '#0f172a' : '#ffffff',
    panel: dark ? '#020617' : '#f8fafc',
    fg: dark ? '#e5e7eb' : '#020617',
    sub: dark ? '#94a3b8' : '#475569',
    accent: '#58cc02',
  }

  const username = escapeXml(args.user.name || args.user.username)
  const xp = formatNumber(args.totalXp)

  const flags = args.flags
    .map((c, i) => `<text x="${20 + i * 12}" y="130" font-size="10">${escapeXml(c)}</text>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160">
  <rect width="100%" height="100%" rx="12" fill="${color.panel}"/>

  <image href="${args.avatar}" x="20" y="20" width="48" height="48" rx="24"/>

  <text x="84" y="40" font-size="16" font-weight="700" fill="${color.fg}" font-family="system-ui">
    ${username}
  </text>

  <text x="84" y="62" font-size="12" fill="${color.sub}" font-family="system-ui">
    Total XP: ${xp}
  </text>

  ${flags}
</svg>`
}

/* =====================
 * Utils
 * ===================== */

function svgResponse(svg: string) {
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  })
}

function escapeXml(str: string) {
  return str.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)
  )
}

function formatNumber(n: number) {
  try {
    return new Intl.NumberFormat('en-US').format(n)
  } catch {
    return String(n)
  }
}

function toBase64(buf: ArrayBuffer, mime: string) {
  const bin = String.fromCharCode(...new Uint8Array(buf))
  return `data:${mime};base64,${btoa(bin)}`
}

function errorSvg(c: Context, message: string, status = 500) {
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="80">
  <rect width="100%" height="100%" rx="12" fill="#fee2e2"/>
  <text x="20" y="46" font-size="14" fill="#991b1b" font-family="system-ui">
    ${escapeXml(message)}
  </text>
</svg>`,
    status,
    { 'Content-Type': 'image/svg+xml; charset=utf-8' }
  )
}
