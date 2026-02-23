import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

/**
 * POST /api/gemini
 * 
 * Proxy for Gemini API. Validates user JWT, then forwards the request
 * to Google's Gemini API with the server-side API key.
 * 
 * Body: { model, body } — same shape as the Google API request
 */
export async function POST(req: NextRequest) {
    // 1. Authenticate
    const user = await getAuthUser(req);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request
    let model: string;
    let geminiBody: unknown;
    try {
        const payload = await req.json();
        model = payload.model ?? 'gemini-2.0-flash';
        geminiBody = payload.body;
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // 3. Forward to Gemini
    const geminiUrl = `${GEMINI_API_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
            // 60s timeout for long AI responses
            signal: AbortSignal.timeout(60_000),
        });

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
            console.error('[gemini-proxy] Gemini API error:', geminiRes.status, data);
            return NextResponse.json(
                { error: 'Gemini API error', details: data },
                { status: geminiRes.status }
            );
        }

        return NextResponse.json(data);
    } catch (err) {
        console.error('[gemini-proxy] fetch error:', err);
        return NextResponse.json({ error: 'Failed to reach Gemini' }, { status: 502 });
    }
}

// Handle CORS preflight
export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
