import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // API only — no pages needed
    output: 'standalone',
    // Allow CORS from any origin (Vite frontend on Vercel, local dev, etc.)
    async headers() {
        return [
            {
                source: '/api/:path*',
                headers: [
                    { key: 'Access-Control-Allow-Origin', value: '*' },
                    { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
                    { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
                ],
            },
        ];
    },
};

export default nextConfig;
