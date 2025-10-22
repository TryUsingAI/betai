// src/lib/supabase-browser.ts
'use client'

import { createBrowserClient } from '@supabase/ssr'

export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// backward compatibility for old imports
export const supabase = supabaseBrowser
export default supabaseBrowser
