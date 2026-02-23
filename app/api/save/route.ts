import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/save?slot=1
 * Load the game state for the authenticated user.
 */
export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const slot = Number(req.nextUrl.searchParams.get('slot') ?? '1');

    const { data, error } = await supabaseAdmin
        .from('game_saves')
        .select('game_state, updated_at')
        .eq('user_id', user.id)
        .eq('save_slot', slot)
        .maybeSingle();

    if (error) {
        console.error('[save] load error:', error);
        return NextResponse.json({ error: 'Failed to load save' }, { status: 500 });
    }

    if (!data) {
        // No save found — return null so client knows to start fresh
        return NextResponse.json({ game_state: null });
    }

    return NextResponse.json({
        game_state: data.game_state,
        updated_at: data.updated_at,
    });
}

/**
 * POST /api/save
 * Upsert the game state for the authenticated user.
 * 
 * Body: { slot?: number, game_state: object }
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let slot: number;
    let game_state: unknown;
    try {
        const body = await req.json();
        slot = Number(body.slot ?? 1);
        game_state = body.game_state;
        if (!game_state) throw new Error('game_state required');
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
        .from('game_saves')
        .upsert(
            {
                user_id: user.id,
                save_slot: slot,
                game_state,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,save_slot' }
        );

    if (error) {
        console.error('[save] upsert error:', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
