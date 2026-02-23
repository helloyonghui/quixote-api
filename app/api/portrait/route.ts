import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getAuthUser } from '@/lib/supabase';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const IMAGEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`;
const BUCKET = 'portraits';

/**
 * POST /api/portrait
 *
 * Lazy portrait generation with Supabase Storage cache.
 * Body: { key: string, prompt: string, aspectRatio?: '1:1' | '2:3' }
 *
 * Cache key → portraits/{key}.webp
 * On miss: calls Imagen 3, uploads, returns URL.
 * On hit:  returns existing public URL immediately.
 */
export async function POST(req: NextRequest) {
    // 1. Auth
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Parse body
    let key: string;
    let prompt: string;
    let aspectRatio: string;
    try {
        const body = await req.json();
        key = body.key?.replace(/[^a-zA-Z0-9_\-:]/g, '_');   // sanitise path
        prompt = body.prompt;
        aspectRatio = body.aspectRatio ?? '2:3';
        if (!key || !prompt) throw new Error('missing key or prompt');
    } catch (e) {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const storagePath = `${key}.webp`;

    // 3a. Ensure bucket exists (idempotent — ignores error if already exists)
    await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 2 * 1024 * 1024,  // 2 MB
        allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
    }).catch(() => { /* bucket already exists — ignore */ });

    // 3b. Cache check — Supabase Storage
    const { data: existing } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    if (existing?.publicUrl) {
        // Verify file actually exists (getPublicUrl always returns a URL shape, even if 404)
        try {
            const head = await fetch(existing.publicUrl, { method: 'HEAD' });
            if (head.ok) {
                return NextResponse.json({ url: existing.publicUrl, cached: true });
            }
        } catch { /* file doesn't exist, fall through */ }
    }

    // 4. Generate with Imagen 3
    const imagenRes = await fetch(IMAGEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio,
                safetyFilterLevel: 'block_few',
                personGeneration: 'allow_adult',
            },
        }),
        signal: AbortSignal.timeout(45_000),
    });

    if (!imagenRes.ok) {
        const err = await imagenRes.text();
        console.error('[portrait] Imagen error:', err);
        return NextResponse.json({ error: 'Imagen failed', detail: err }, { status: 502 });
    }

    const imagenData = await imagenRes.json();
    const b64 = imagenData?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
        return NextResponse.json({ error: 'No image returned from Imagen' }, { status: 502 });
    }

    // 5. Upload to Supabase Storage
    const buffer = Buffer.from(b64, 'base64');
    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType: 'image/webp',
            cacheControl: '31536000',   // 1 year CDN cache
            upsert: true,
        });

    if (uploadErr) {
        console.error('[portrait] Storage upload error:', uploadErr);
        // Return base64 as data URI fallback — not cached but usable
        return NextResponse.json({ url: `data:image/webp;base64,${b64}`, cached: false });
    }

    // 6. Return public URL
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({ url: pub.publicUrl, cached: false });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
