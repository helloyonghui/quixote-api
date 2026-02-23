import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/ceremony/snapshot
 * Upsert the authenticated player's ceremony snapshot for the current epoch.
 *
 * Body: {
 *   player_name: string; realm: string; prof_path: string; prof_label: string;
 *   sig_skill: string; greatness: number; epoch_title?: string;
 *   legend?: string; climax_count?: number;
 * }
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const {
        player_name, realm, prof_path, prof_label,
        sig_skill, greatness, epoch_title, legend, climax_count,
    } = body as Record<string, string | number | undefined>;

    if (!player_name || !realm || !prof_path || !sig_skill || greatness === undefined) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Current epoch = YYYY-MM in UTC
    const epoch_period = new Date().toISOString().slice(0, 7);

    const { error } = await supabaseAdmin
        .from('ceremony_snapshots')
        .upsert(
            {
                user_id: user.id,
                epoch_period,
                player_name,
                realm,
                prof_path,
                prof_label,
                sig_skill,
                greatness: Number(greatness),
                epoch_title: epoch_title ?? null,
                legend: legend ?? null,
                climax_count: Number(climax_count ?? 0),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,epoch_period' }
        );

    if (error) {
        console.error('[ceremony/snapshot] upsert error:', error);
        return NextResponse.json({ error: 'Failed to save snapshot' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, epoch_period });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
