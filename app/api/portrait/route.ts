import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getAuthUser } from '@/lib/supabase';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

// Imagen 4 Fast via :predict (confirmed working with Gemini Developer API key)
const IMAGEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${GEMINI_API_KEY}`;

// Gemini Flash Lite for fast prompt enhancement (low latency, low cost)
const GEMINI_FLASH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

const BUCKET = 'portraits';

// ─── Gemini prompt enhancer ────────────────────────────────────────────────────
// Converts raw NPC data into an optimized English Imagen 4 portrait prompt.
// Critical: parses Chinese name keywords into visual descriptors (铁面 = iron mask, etc.)

async function enhancePortraitPrompt(rawPrompt: string, isItem: boolean): Promise<string> {
    const systemHint = isItem
        ? `You are a visual prompt engineer for Imagen 4.
Convert this Chinese fantasy item description into an optimized English image generation prompt.
Focus on: material, shape, magical glow, surface detail. No people. 
Style: mystical Chinese artifact, dark atmospheric background, dramatic golden light.
Output ONLY the image prompt in English, 60-80 words max, no explanation.`
        : `You are a visual prompt engineer for Imagen 4.
Convert this Chinese xianxia NPC description into an optimized English portrait prompt.

CRITICAL — parse the Chinese name for visual traits:
- 铁面 = iron mask completely covering the face
- 行刑者 = executioner with heavy cleaving blade, dark hood
- 守墓 = tomb keeper in burial ceremonial robes, holding ritual lantern
- 血 = blood-stained features or crimson robes
- 刀/剑 = carrying a large blade prominently
- 影/暗 = shadow operative, half-face in darkness
- 仙/道 = ethereal immortal with spiritual energy wisps
- 帝/皇 = supreme emperor in golden dragon imperial robes
- 老人 = elderly weathered face with long white beard
- 狱 = prison warden with heavy chains and iron keys

Rules:
- Start with: "Portrait of a [male/female] character,"
- Describe: face features or mask, costume, weapon/accessory, expression, aura — all in visual detail
- Style: "Chinese xianxia fantasy, semi-realistic digital art, detailed, cinematic lighting"
- 60-90 words max, pure English only
Output ONLY the image prompt, no explanation, no quotes.`;

    try {
        const res = await fetch(GEMINI_FLASH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemHint}\n\nInput: ${rawPrompt}` }] }],
                generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
            }),
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return rawPrompt;
        const data = await res.json();
        const enhanced = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (enhanced && enhanced.length > 20) {
            console.log('[portrait] Gemini prompt:', enhanced.slice(0, 120));
            return enhanced;
        }
    } catch (err) {
        console.warn('[portrait] Gemini enhancement failed, using raw prompt:', err);
    }
    return rawPrompt;  // graceful fallback
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/portrait
 *
 * Two-phase portrait generation:
 *   1. Gemini: parse NPC data → optimized English Imagen prompt
 *   2. Imagen 4: generate image from optimized prompt
 *   3. Supabase Storage: cache result by key
 *
 * Body: { key: string, prompt: string, aspectRatio?: string }
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
        aspectRatio = body.aspectRatio ?? '3:4';
        if (!key || !prompt) throw new Error('missing key or prompt');
    } catch {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const storagePath = `${key}.webp`;
    const isItem = aspectRatio === '1:1';

    // 3a. Ensure bucket exists
    await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 2 * 1024 * 1024,
        allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
    }).catch(() => { /* already exists */ });

    // 3b. Cache check
    const { data: existing } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    if (existing?.publicUrl) {
        try {
            const head = await fetch(existing.publicUrl, { method: 'HEAD' });
            if (head.ok) return NextResponse.json({ url: existing.publicUrl, cached: true });
        } catch { /* fall through */ }
    }

    // 4. Gemini: enhance prompt (parse Chinese name → visual English descriptors)
    const enhancedPrompt = await enhancePortraitPrompt(prompt, isItem);

    // 5. Negative prompts by type
    const negativePrompt = isItem
        ? 'people, characters, human face, text, watermark, blurry, low quality, cluttered'
        : 'empty landscape, scenery only, no face, multiple people, crowd, text, watermark, extra limbs, disfigured, blurry, low quality';

    // 6. Imagen 4: generate image from enhanced prompt
    const imagenRes = await fetch(IMAGEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [{ prompt: enhancedPrompt, negativePrompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio,
                safetyFilterLevel: 'block_few',
                personGeneration: 'allow_adult',
            },
        }),
        signal: AbortSignal.timeout(40_000),
    });

    if (!imagenRes.ok) {
        const errText = await imagenRes.text().catch(() => '');
        console.error('[portrait] Imagen error:', imagenRes.status, errText || '(empty)');
        return NextResponse.json(
            { error: 'Imagen failed', detail: JSON.stringify(errText), status: imagenRes.status },
            { status: 502 }
        );
    }

    const imagenData = await imagenRes.json();
    const b64 = imagenData?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
        return NextResponse.json({ error: 'No image returned from Imagen' }, { status: 502 });
    }

    // 7. Upload to Supabase Storage
    const buffer = Buffer.from(b64, 'base64');
    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType: 'image/webp',
            cacheControl: '31536000',
            upsert: true,
        });

    if (uploadErr) {
        console.error('[portrait] Storage upload error:', uploadErr);
        return NextResponse.json({ url: `data:image/webp;base64,${b64}`, cached: false });
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({ url: pub.publicUrl, cached: false });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
