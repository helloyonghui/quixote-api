import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/ceremony/leaderboard?epoch=2026-02&limit=10
 * Returns the top ceremony snapshots for a given epoch, sorted by greatness DESC.
 * No authentication required — public leaderboard.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const epoch = searchParams.get('epoch') ?? new Date().toISOString().slice(0, 7);
    const limit = Math.min(Number(searchParams.get('limit') ?? '15'), 50);

    const { data, error } = await supabaseAdmin
        .from('ceremony_snapshots')
        .select('player_name, realm, prof_path, prof_label, sig_skill, greatness, epoch_title, legend, climax_count, auction_won')
        .eq('epoch_period', epoch)
        .order('greatness', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[ceremony/leaderboard] query error:', error);
        return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
    }

    // Map to CeremonySnapshot shape expected by frontend
    const snapshots = (data ?? []).map((row, i) => ({
        id: `lb-${row.player_name}-${i}`,
        name: row.player_name,
        realm: row.realm,
        profPath: row.prof_path,
        profLabel: row.prof_label,
        sigSkill: row.sig_skill,
        greatness: row.greatness,
        epochTitle: row.epoch_title ?? undefined,
        legend: row.legend ?? undefined,
        climaxCount: row.climax_count ?? 0,
    }));

    return NextResponse.json({ epoch, snapshots });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
