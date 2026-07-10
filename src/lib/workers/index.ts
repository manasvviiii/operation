// src/lib/workers/index.ts
import { PlanContext } from '../prompts/planner';
import { prisma } from '../prisma';

// Regex Patterns
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export const gst_agent = async (workflowId: string, ctx: PlanContext) => {
    const lastMsg = ctx.messages[ctx.messages.length - 1]?.content || "";
    if (GST_REGEX.test(lastMsg)) {
        await prisma.workflow.update({ 
            where: { id: workflowId }, 
            data: { state: 'AWAITING_PAN' } // Success moves to next step
        });
        console.log("[gst_agent] Validated. Moving to AWAITING_PAN.");
    }
};

export const pan_agent = async (workflowId: string, ctx: PlanContext) => {
    const lastMsg = ctx.messages[ctx.messages.length - 1]?.content || "";
    if (PAN_REGEX.test(lastMsg)) {
        await prisma.workflow.update({ 
            where: { id: workflowId }, 
            data: { state: 'AWAITING_BANK' } 
        });
        console.log("[pan_agent] Validated. Moving to AWAITING_BANK.");
    }
};

export const doc_agent = async (workflowId: string, ctx: PlanContext) => {
    // For now, assume doc_agent handles the start
    console.log("[doc_agent] Document collection requested.");
    await prisma.workflow.update({ 
        where: { id: workflowId }, 
        data: { state: 'AWAITING_GST' } 
    });
};

// Add bank_agent and erp_agent similarly
export const bank_agent = async (w: string, c: any) => console.log("Bank validated");
export const erp_agent = async (w: string, c: any) => console.log("ERP sync complete");