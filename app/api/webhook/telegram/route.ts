// app/api/webhook/telegram/route.ts
import { NextResponse } from 'next/server';
import { handleInbound } from '@/lib/inboundHandler';

export async function POST(req: Request) {
  try {
    const update = await req.json();
    
    // Process the inbound message asynchronously
    // We don't await this so Telegram gets a 200 OK immediately
    // TODO: Extract workflowId from update payload or URL parameters
    handleInbound('telegram', update, '').catch(console.error);
    
    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}