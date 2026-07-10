import { NextResponse } from 'next/server';
import { handleInboundUpdate } from '@/lib/inboundHandler';

export async function POST(req: Request) {
  try {
    const update = await req.json();
    await handleInboundUpdate(update);
  } catch (error) {
    console.error('[telegram/webhook] Error handling update:', error);
  }

  return NextResponse.json({ ok: true });
}
