import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

/**
 * Admin client — bypasses RLS. Only for server-side operations.
 * Never expose this key to the frontend.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * User client — scoped to a specific user's JWT.
 * Respects RLS policies set in Supabase.
 */
export function supabaseUser(accessToken: string) {
    return createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/**
 * Extract Bearer token from an incoming request.
 */
export function extractToken(req: NextRequest): string | null {
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return null;
    return auth.slice(7);
}

/**
 * Validate JWT and return the user, or null if invalid.
 */
export async function getAuthUser(req: NextRequest) {
    const token = extractToken(req);
    if (!token) return null;
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user;
}
