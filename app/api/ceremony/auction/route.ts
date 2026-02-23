import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/ceremony/auction
 * Record the item the authenticated player won in the karma auction.
 *
 * Body: { item_id: string }
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let item_id: string;
    try {
        const body = await req.json();
        item_id = body.item_id;
        if (!item_id) throw new Error('item_id required');
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const epoch_period = new Date().toISOString().slice(0, 7);

    const { error } = await supabaseAdmin
        .from('ceremony_snapshots')
        .update({ auction_won: item_id, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('epoch_period', epoch_period);

    if (error) {
        console.error('[ceremony/auction] update error:', error);
        return NextResponse.json({ error: 'Failed to record auction win' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, item_id });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
