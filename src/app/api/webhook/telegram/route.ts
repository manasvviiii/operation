import { NextResponse } from 'next/server';
import { handleInboundUpdate } from '@/lib/inboundHandler';

export async function POST(req: Request) {
  try {
    const update = await req.json();
    await handleInboundUpdate('telegram', update);
  } catch (error) {
    console.error('Webhook Error:', error);
  }

  return NextResponse.json({ ok: true });
}
