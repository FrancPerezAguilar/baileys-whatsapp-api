# Bridge Baileys → Chatwoot

## Concepto

Conectar WhatsApp (vía Baileys) con Chatwoot como bandeja de entrada unificada. Los mensajes de WhatsApp aparecen en Chatwoot, permitiendo a los agentes responder desde Chatwoot.

```
┌─────────────────────────────────────────────────────────────┐
│                      WHATSAPP                                 │
│         (Cliente usa WhatsApp normalmente)                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    BAileyS API                               │
│         (Sesión WhatsApp Web - tu servidor)                  │
│  - Recibe mensajes entrantes                                 │
│  - Envía mensajes salientes                                  │
│  - Maneja medios (audio, imágenes, voz)                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  BRIDGE SERVICE                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Message     │  │ Media       │  │ Sync       │       │
│  │ Router     │  │ Handler     │  │ State      │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                              │
│  - Recibe de Baileys                                        │
│  - Convierte a formato Chatwoot                              │
│  - Crea/actualiza conversaciones                             │
│  - Sincroniza estado                                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  CHATWOOT API                                │
│  - Crear conversaciones                                       │
│  - Añadir mensajes                                           │
│  - Recibir webhooks de respuestas                            │
│  - Marcar como leído                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Funcionalidades

### Mensajes Entrantes (WhatsApp → Chatwoot)
- [x] Mensajes de texto
- [x] Imágenes (con preview)
- [x] Audio/Notas de voz
- [x] Videos
- [x] Documentos
- [x] Ubicaciones
- [x] Contactos
- [x] Mensajes de estado

### Mensajes Salientes (Chatwoot → WhatsApp)
- [x] Mensajes de texto
- [x] Imágenes
- [x] Audio/Voz
- [x] Documentos
- [x] Respuestas a mensajes específicos (quoted)
- [ ] Mensajes de estado (limitado por WhatsApp)

### Estado y Sincronización
- [x] Indicadores de lectura (read receipts)
- [x] Status de mensaje (enviado, entregado, leído)
- [x] Presencia online/offline
- [x] Typing indicators
- [x] Sincronización de contactos

---

## Arquitectura del Bridge

```
src/
├── index.js              # Entry point, Baileys socket
├── services/
│   ├── chatwoot.js      # Chatwoot API client
│   ├── media.js          # Media download/upload
│   ├── messageMapper.js  # Map WhatsApp ↔ Chatwoot format
│   └── contactSync.js    # Sync contacts
├── handlers/
│   ├── onMessage.js      # Handle incoming WhatsApp messages
│   ├── onAck.js          # Handle delivery/read receipts
│   ├── onPresence.js     # Handle presence updates
│   └── onWebhook.js      # Handle outgoing from Chatwoot
├── state/
│   ├── conversations.js   # Map WA JID ↔ Chatwoot conv ID
│   └── messages.js        # Map WA msg ID ↔ Chatwoot msg ID
└── utils/
    ├── logger.js
    └── config.js
```

---

## Formato de Mensajes

### WhatsApp → Chatwoot

```javascript
// onMessage.js
async function handleIncomingMessage(msg) {
  const jid = msg.key.remoteJid;
  const contact = await getContact(msg.key.participant || jid);
  
  // Crear o obtener conversación en Chatwoot
  let conversation = await findOrCreateConversation(
    contact,           // number como identifier
    'whatsapp',       // channel
    inboxId            // WhatsApp inbox ID
  );
  
  // Descargar media si existe
  let attachments = [];
  if (msg.message?.imageMessage) {
    const mediaBuffer = await downloadMedia(msg.message.imageMessage);
    const upload = await chatwoot.uploadAttachment(mediaBuffer, 'image');
    attachments.push(upload);
  }
  
  // Mapear tipo de mensaje
  const messageType = getMessageType(msg.message);
  
  // Crear mensaje en Chatwoot
  const chatwootMsg = await chatwoot.createMessage({
    conversation_id: conversation.id,
    content: getMessageText(msg.message),
    message_type: 'incoming',
    content_type: messageType,
    attachments: attachments,
    sender: {
      id: contact.id,
      name: contact.name || contact.number,
      avatar: contact.avatar
    }
  });
  
  // Guardar mapping para respuestas
  state.saveMessageMapping(msg.key.id, chatwootMsg.id);
}
```

### Chatwoot → WhatsApp

```javascript
// onWebhook.js - Chatwoot envía webhook cuando agente responde
async function handleChatwootMessage(payload) {
  const { conversation, message, user } = payload;
  
  // Ignorar mensajes entrantes (solo procesar outgoing)
  if (message.message_type !== 'outgoing') return;
  
  // Obtener JID de WhatsApp desde la conversación
  const jid = state.getJidFromConversation(conversation.id);
  if (!jid) return;
  
  // Obtener mensaje padre (reply) si existe
  const quotedMsgId = state.getWaMsgId(message.in_reply_to);
  
  // Enviar mensaje vía Baileys
  const sent = await sock.sendMessage(jid, {
    text: message.content,
    quotedKey: quotedMsgId ? { id: quotedMsgId } : undefined
  });
  
  // Mapear mensaje saliente
  state.saveMessageMapping(sent.key.id, message.id, 'outgoing');
}
```

---

## Media Handling

### Descargar de WhatsApp

```javascript
// media.js
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function downloadMedia(msg) {
  const stream = await downloadContentFromMessage(msg, 'media');
  let buffer = Buffer.from([]);
  
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  
  return buffer;
}

async function downloadAudio(msg) {
  const stream = await downloadContentFromMessage(msg, 'audio');
  let buffer = Buffer.from([]);
  
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  
  return buffer;
}
```

### Subir a Chatwoot

```javascript
async function uploadAttachment(buffer, type) {
  const formData = new FormData();
  formData.append('attachment', new Blob([buffer]), {
    filename: `media.${getExtension(type)}`,
    type: getMimeType(type)
  });
  
  const response = await fetch(`${CHATWOOT_URL}/api/v1/attachments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHATWOOT_API_KEY}`,
      'Content-Type': 'multipart/form-data'
    },
    body: formData
  });
  
  return response.json();
}
```

---

## Chatwoot API

### Autenticación

```javascript
// chatwoot.js
const CHATWOOT_URL = process.env.CHATWOOT_URL;
const CHATWOOT_API_KEY = process.env.CHATWOOT_API_KEY;
const INBOX_ID = process.env.CHATWOOT_INBOX_ID;

const chatwoot = {
  headers: {
    'Authorization': `Bearer ${CHATWOOT_API_KEY}`,
    'Content-Type': 'application/json'
  },
  
  // Crear contacto
  async createContact(identifier, name, avatar) {
    // POST /api/v1/contacts
  },
  
  // Buscar contacto por identifier
  async findContact(identifier) {
    // GET /api/v1/contacts/search?q={identifier}
  },
  
  // Crear conversación
  async createConversation(contact, inboxId) {
    // POST /api/v1/conversations
  },
  
  // Crear mensaje
  async createMessage(conversationId, message) {
    // POST /api/v1/conversations/{id}/messages
  },
  
  // Upload attachment
  async uploadAttachment(buffer, type) {
    // POST /api/v1/attachments (multipart)
  },
  
  // Marcar como leído
  async markAsRead(conversationId) {
    // POST /api/v1/conversations/{id}/update_last_seen
  }
};
```

### Webhooks (Recibir de Chatwoot)

Chatwoot puede enviar webhooks cuando hay nuevos mensajes. Configurar en:
`Settings → Integrations → Webhooks`

```javascript
// Webhook payload de Chatwoot
{
  "event": "message_created",
  "conversation_id": 123,
  "message": {
    "id": 456,
    "content": "Hola!",
    "message_type": "outgoing",
    "in_reply_to": 455
  },
  "sender": {
    "id": 789,
    "name": "Agent Name"
  }
}
```

---

## Estado y Mapeos

```javascript
// state/conversations.js
const conversations = new Map(); // waJid → chatwootConvId

function findOrCreateConversation(contact, channel, inboxId) {
  const existing = [...conversations.entries()]
    .find(([jid]) => jid === contact.jid);
  
  if (existing) {
    return existing.chatwootConv;
  }
  
  // Crear en Chatwoot
  const conv = await chatwoot.createConversation(contact, inboxId);
  conversations.set(contact.jid, conv.id);
  return conv;
}
```

```javascript
// state/messages.js
const messageMap = new Map(); // waMsgId → chatwootMsgId

function saveMapping(waMsgId, cwMsgId, direction) {
  messageMap.set(waMsgId, { cwMsgId, direction });
}

function getMapping(waMsgId) {
  return messageMap.get(waMsgId);
}
```

---

## Docker Compose

```yaml
version: '3.8'

services:
  whatsapp-bridge:
    build: .
    container_name: whatsapp-bridge
    restart: unless-stopped
    ports:
      - "3001:3001"  # API REST (opcional)
      - "3002:3002"  # Webhook receiver
    volumes:
      - ./auth:/app/auth          # Sesiones Baileys
      - ./data:/app/data          # Estado y cache
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - CHATWOOT_URL=${CHATWOOT_URL}
      - CHATWOOT_API_KEY=${CHATWOOT_API_KEY}
      - CHATWOOT_INBOX_ID=${CHATWOOT_INBOX_ID}
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## Configuración

```bash
# .env
CHATWOOT_URL=https://tu-chatwoot.com
CHATWOOT_API_KEY=tu_api_key_del_profile
CHATWOOT_INBOX_ID=1
WEBHOOK_SECRET=secreto_para_validar
SESSION_ID=default
PORT=3001
```

---

## Instalación

```bash
# 1. Clonar repo
git clone https://github.com/FrancPerezAguilar/baileys-chatwoot-bridge.git
cd baileys-chatwoot-bridge

# 2. Configurar
cp .env.example .env
# Editar .env con tus credenciales

# 3. Construir y ejecutar
docker compose up -d

# 4. Ver logs
docker compose logs -f

# 5. Escanear QR (la primera vez)
# POST /session/start → devuelve QR como base64
curl -X POST http://localhost:3001/session/start
```

---

## API Endpoints (Opcional - para debugging)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/session/start` | Iniciar sesión WhatsApp |
| `GET` | `/qr` | Obtener QR actual |
| `GET` | `/status` | Estado de conexión |
| `POST` | `/send` | Enviar mensaje manualmente |
| `POST` | `/webhook/test` | Test webhook Chatwoot |
| `DELETE` | `/session` | Cerrar sesión |

---

## Problemas Conocidos

1. **Ban de WhatsApp**: Usar Baileys puede resultar en ban si WhatsApp detecta uso automatizado
2. **Límite de medios**: WhatsApp tiene límites en tamaño de archivos
3. **Mensajes de grupo**: Soporte limitado para grupos
4. **Estados de WhatsApp**: No se pueden enviar (solo recibir)

---

## Alternativa: WhatsApp Business API

Si el ban es un riesgo, considerar usar WhatsApp Business API oficial con Chatwoot:
- Más estable
- No riesgo de ban
- Requiere cuenta de desarrollador de Meta
- Proceso de aprobación

---

## Roadmap

- [ ] MVP funcional (texto + imágenes)
- [ ] Audio y notas de voz
- [ ] Sincronización de estado de mensajes
- [ ] Typing indicators
- [ ] Presencia online/offline
- [ ] Soporte para grupos (básico)
- [ ] Tests automatizados
- [ ] Panel de control básico
