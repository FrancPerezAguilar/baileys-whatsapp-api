import { downloadContentFromMessage } from '@WhiskeySockets/baileys';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const MEDIA_DIR = './media';
const MAX_MEDIA_SIZE = 50 * 1024 * 1024; // 50MB

export async function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) {
    await mkdir(MEDIA_DIR, { recursive: true });
  }
}

export async function downloadMedia(msg, type = 'media') {
  try {
    const stream = await downloadContentFromMessage(msg, type);
    const chunks = [];
    let totalSize = 0;

    for await (const chunk of stream) {
      totalSize += chunk.length;
      if (totalSize > MAX_MEDIA_SIZE) {
        throw new Error(`Media too large (${Math.round(totalSize / 1024 / 1024)}MB, max ${MAX_MEDIA_SIZE / 1024 / 1024}MB)`);
      }
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Error downloading media:', error);
    throw error;
  }
}

export async function downloadImage(msg) {
  return downloadMedia(msg, 'image');
}

export async function downloadAudio(msg) {
  return downloadMedia(msg, 'audio');
}

export async function downloadVideo(msg) {
  return downloadMedia(msg, 'video');
}

export async function downloadDocument(msg) {
  return downloadMedia(msg, 'document');
}

export async function downloadAndSave(msg, type, filename) {
  await ensureMediaDir();
  const buffer = await downloadMedia(msg, type);
  const filepath = path.join(MEDIA_DIR, filename);
  await writeFile(filepath, buffer);
  return filepath;
}

export function getMimeType(msg) {
  if (msg.imageMessage) return msg.imageMessage.mimetype;
  if (msg.audioMessage) return msg.audioMessage.mimetype;
  if (msg.videoMessage) return msg.videoMessage.mimetype;
  if (msg.documentMessage) return msg.documentMessage.mimetype;
  if (msg.stickerMessage) return 'image/webp';
  return 'application/octet-stream';
}

export function getFileExtension(mimetype) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
    'application/doc': 'doc',
    'application/docx': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mimetype] || 'bin';
}

export function getMsgContent(msg) {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage) return msg.extendedTextMessage.text;
  return '';
}

export function getQuotedMsg(msg) {
  if (msg.extendedTextMessage?.contextInfo?.quotedMessage) {
    return msg.extendedTextMessage.contextInfo.quotedMessage;
  }
  return null;
}

export function getQuotedMsgId(msg) {
  if (msg.extendedTextMessage?.contextInfo?.stanzaId) {
    return msg.extendedTextMessage.contextInfo.stanzaId;
  }
  return null;
}

export async function downloadAllMedia(msg) {
  const attachments = [];
  
  try {
    if (msg.imageMessage) {
      const buffer = await downloadImage(msg.imageMessage);
      const ext = getFileExtension(msg.imageMessage.mimetype);
      attachments.push({
        type: 'image',
        mimetype: msg.imageMessage.mimetype,
        buffer,
        filename: `img_${Date.now()}.${ext}`
      });
    }
    
    if (msg.audioMessage) {
      const buffer = await downloadAudio(msg.audioMessage);
      const ext = getFileExtension(msg.audioMessage.mimetype || 'audio/ogg');
      attachments.push({
        type: 'audio',
        mimetype: msg.audioMessage.mimetype || 'audio/ogg',
        buffer,
        filename: `audio_${Date.now()}.${ext}`
      });
    }
    
    if (msg.videoMessage) {
      const buffer = await downloadVideo(msg.videoMessage);
      const ext = getFileExtension(msg.videoMessage.mimetype);
      attachments.push({
        type: 'video',
        mimetype: msg.videoMessage.mimetype,
        buffer,
        filename: `video_${Date.now()}.${ext}`
      });
    }
    
    if (msg.documentMessage) {
      const buffer = await downloadDocument(msg.documentMessage);
      const ext = getFileExtension(msg.documentMessage.mimetype);
      attachments.push({
        type: 'file',
        mimetype: msg.documentMessage.mimetype,
        buffer,
        filename: msg.documentMessage.fileName || `doc_${Date.now()}.${ext}`
      });
    }
  } catch (error) {
    console.error('Error downloading media:', error);
  }
  
  return attachments;
}
