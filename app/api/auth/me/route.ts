import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase';

/**
 * GET /api/auth/me
 * Returns basic user info from the validated JWT.
 * Useful for the frontend to check login state on page load.
 */
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ user: null }, { status: 401 });

    return NextResponse.json({
        user: {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
        },
    });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
