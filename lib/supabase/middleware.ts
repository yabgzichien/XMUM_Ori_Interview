import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Only staff/committee areas require a login. /book is public (no-login interviewees).
const PROTECTED = ['/head', '/practice', '/admin', '/profile']

export async function updateSession(request: NextRequest) {
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
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // `getClaims` verifies the access token locally against the project's
  // asymmetric (ES256) signing key — no network call on the happy path, where
  // `getUser` would spend ~140ms round-tripping to the Auth server on *every*
  // request the matcher below covers, including each client-side navigation.
  // Session refresh is unaffected: `getClaims` still reads the session (and
  // renews an expired one) through `getSession`, so `setAll` above keeps
  // writing refreshed cookies.
  const { data: claims } = await supabase.auth.getClaims()
  const user = claims?.claims.sub

  if (!user && PROTECTED.some((p) => request.nextUrl.pathname.startsWith(p))) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }
  return response
}
