import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getConnector } from './connectors/registry';
import { runAgentLoop } from './runAgentLoop';
import {
  extractAttachment,
  type NormalizedAttachment,
} from './connectors/telegramAttachment';
import {
  ingestDocument,
  type DocumentMetadata,
} from './document/ingestion';
import { extractPan } from './agents/workers/pan_agent';



function getExtractedFields(
  value: unknown
): Record<string, unknown> {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return {
      ...(value as Record<string, unknown>),
    };
  }

  return {};
}

async function handleOutOfOrderInput(
  workflow: {
    id: string;
    state: string;
    chatId: string | null;
    extractedFields?: unknown;
  },
  body: string,
  hasAttachment: boolean,
  connectorId: string
): Promise<boolean> {
  if (
    workflow.state !== 'AWAITING_GST' ||
    hasAttachment
  ) {
    return false;
  }

  const panNumber = extractPan(body);

  if (!panNumber) {
    return false;
  }

  const existingExtractedFields = getExtractedFields(
    workflow.extractedFields
  );

  await prisma.workflow.update({
    where: {
      id: workflow.id,
    },
    data: {
      extractedFields: {
        ...existingExtractedFields,
        panNumber,
      } as Prisma.InputJsonValue,
    },
  });

  if (workflow.chatId) {
    const connector = getConnector(connectorId);
    await connector.sendMessage({
      channelId: workflow.chatId,
      text:
        'That looks like a valid PAN — noted and saved for later. I still need your GST registration certificate first. Please upload the GST certificate as a PDF or clear image.',
    });
  }

  return true;
}

export async function handleInboundUpdate(
  connectorId: string,
  rawUpdate: any
): Promise<void> {
  const connector = getConnector(connectorId);
  const inbound = await connector.handleInbound?.(rawUpdate);

  if (!inbound) {
    return;
  }

  const {
    channelId: chatId,
    senderId,
    body,
    externalMessageId,
    ts,
    workflowId,
  } = inbound;

  let workflow;

  if (workflowId) {
    workflow = await prisma.workflow.findUnique({
      where: {
        id: workflowId,
      },
    });

    if (!workflow) {
      console.warn(
        `[inbound] Unknown workflowId from /start link: ${workflowId}`
      );

      return;
    }

    if (!workflow.chatId) {
      workflow = await prisma.workflow.update({
        where: {
          id: workflow.id,
        },
        data: {
          chatId,
        },
      });
    }
  } else {
    workflow = await prisma.workflow.findFirst({
      where: {
        chatId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!workflow) {
      await connector.sendMessage({
        channelId: chatId,
        text:
          "I don't recognize this chat — please use your onboarding link to start.",
      });

      return;
    }
  }

  const message = rawUpdate.message;

  let attachmentMetadata: NormalizedAttachment | null =
    null;

  let documentId: string | null = null;

  if (message) {
    attachmentMetadata = extractAttachment(message);

    if (attachmentMetadata) {
      try {
        console.log(
          '[inbound] Processing attachment:',
          attachmentMetadata.kind
        );

        const {
          data: fileData,
          mime,
        } = await connector.downloadAttachment!(
          attachmentMetadata.fileId
        );

        /*
         * Telegram file downloads may return
         * application/octet-stream even when the uploaded
         * file is actually a PDF or image.
         *
         * Prefer a specific Content-Type from the download.
         * Otherwise fall back to Telegram attachment metadata.
         * Telegram photos are always JPEG-compatible here.
         */
        const finalMime =
          mime &&
          mime !== 'application/octet-stream'
            ? mime
            : attachmentMetadata.mime ||
              (attachmentMetadata.kind === 'photo'
                ? 'image/jpeg'
                : 'application/octet-stream');

        console.log(
          '[inbound] Resolved attachment MIME:',
          {
            downloadMime: mime,
            attachmentMime:
              attachmentMetadata.mime,
            finalMime,
          }
        );

        const docMetadata: DocumentMetadata = {
          workflowId: workflow.id,

          type: attachmentMetadata.kind,

          originalFilename:
            attachmentMetadata.originalFilename ||
            `${attachmentMetadata.kind}.${
              finalMime.split('/')[1] || 'bin'
            }`,

          fileSize:
            attachmentMetadata.fileSize ||
            fileData.length,

          mime: finalMime,

          telegramFileId:
            attachmentMetadata.fileId,

          telegramFileUniqueId:
            attachmentMetadata.fileUniqueId,

          caption: attachmentMetadata.caption,

          width: attachmentMetadata.width,

          height: attachmentMetadata.height,
        };

        const ingested = await ingestDocument(
          fileData,
          docMetadata
        );

        documentId = ingested.id;

        console.log(
          '[inbound] Document ingested:',
          documentId
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          '[inbound] Failed to process attachment:',
          errorMessage
        );

        /*
         * Do not continue into runAgentLoop when attachment
         * ingestion failed.
         *
         * Continuing would make the worker see no Document
         * record and incorrectly ask for the same document
         * again.
         */
        await connector.sendMessage({
          channelId: chatId,
          text:
            'I received your file, but I could not store or process it. Please upload the document again.',
        });

        return;
      }
    }
  }

  try {
    await prisma.message.create({
      data: {
        workflowId: workflow.id,

        connectorId: connectorId,

        direction: 'INBOUND',

        role: 'user',

        channel: connectorId,

        senderId,

        content: body,

        attachments: attachmentMetadata
          ? {
              kind: attachmentMetadata.kind,

              fileId: attachmentMetadata.fileId,

              fileUniqueId:
                attachmentMetadata.fileUniqueId,

              originalFilename:
                attachmentMetadata.originalFilename,

              mime: attachmentMetadata.mime,

              fileSize: attachmentMetadata.fileSize,

              caption: attachmentMetadata.caption,

              width: attachmentMetadata.width,

              height: attachmentMetadata.height,

              documentId,
            }
          : undefined,

        externalMessageId,

        createdAt: ts,
      },
    });

    const outOfOrderInputHandled =
      await handleOutOfOrderInput(
        workflow,
        body,
        attachmentMetadata !== null,
        connectorId
      );

    if (outOfOrderInputHandled) {
      return;
    }

    await runAgentLoop(
      workflow.id,
      'inbound_message'
    );
  } catch (error) {
    console.error(
      `[inbound] Failed to process message for workflow ${workflow.id}:`,
      error instanceof Error
        ? error.message
        : error
    );
  }
}