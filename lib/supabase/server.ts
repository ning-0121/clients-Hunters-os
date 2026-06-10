import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookies set by middleware
          }
        },
      },
    }
  )
}

export async function createServiceClient() {
  // If we're inside a Next.js request context, use the SSR client
  // Otherwise (e.g. standalone worker), fall back to the direct client
  try {
    const cookieStore = await cookies()
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
  } catch (err) {
    // Only fall back when truly outside a Next.js request context
    const msg = String(err)
    const isOutsideRequestContext = msg.includes('cookies') || msg.includes('request scope') || msg.includes('async-context')
    if (!isOutsideRequestContext) {
      // Re-throw unexpected errors so they're visible in logs
      console.error('[Supabase] createServiceClient unexpected error:', err)
    }
    return createDirectClient()
  }
}

/**
 * Direct Supabase service-role client — works outside Next.js request context.
 * Use this in queue workers, scripts, and cron jobs.
 */
export function createDirectClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
