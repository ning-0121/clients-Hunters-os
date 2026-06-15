/**
 * Auth gate (Next 16 "proxy" — the renamed middleware convention).
 *
 * ARAOS pages read with the service-role key, so without this gate every
 * route is publicly readable. Required before binding a public domain.
 *
 *   unauthenticated → /login
 *   authenticated on /login → /bd/today
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Public auth pages reachable without a session.
  const PUBLIC = ['/login', '/register', '/forgot', '/reset']
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  // Logged-in users skip login/register, but /reset must stay reachable
  // (password recovery establishes a temporary session).
  if (user && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/bd/today', request.url))
  }

  return response
}

export const config = {
  // Gate everything except Next internals, static assets, and cron endpoints.
  // /api/cron/* must NOT be gated — Vercel Cron calls them server-side without a
  // session cookie; they protect themselves with CRON_SECRET instead.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)'],
}
