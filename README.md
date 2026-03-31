# Baileys-Chatwoot Bridge

Bridge bidireccional entre WhatsApp (vía Baileys) y Chatwoot con cache y cola de reintentos.

## Arquitectura

```
WhatsApp ←→ Baileys ←→ Bridge ←→ Chatwoot
                              ↓
                    ┌─────────────────┐
                    │ Mensajes        │
                    │ Imágenes        │
                    │ Audio/Voz      │
                    │ Videos          │
                    │ Documentos      │
                    └─────────────────┘
                              ↓
                    ┌─────────────────┐
                    │ Redis           │
                    │ (Cache + Retry) │
                    └─────────────────┘
```

## Características

- ✅ Mensajes de texto
- ✅ Imágenes
- ✅ Audio / Notas de voz
- ✅ Videos
- ✅ Documentos
- ✅ Conversaciones en Chatwoot
- ✅ Agentes responden desde Chatwoot
- ✅ Cache en Redis
- ✅ Cola de reintentos si falla Chatwoot API
- ✅ Rate limiting

## Requisitos

- Node.js 20+
- Docker + Docker Compose
- Redis (incluido en docker-compose)
- Cuenta Chatwoot con API enabled
- Número de WhatsApp

## Instalación

### Docker (Recomendado)

```bash
# Clonar repo
git clone https://github.com/FrancPerezAguilar/baileys-whatsapp-api.git
cd baileys-whatsapp-api

# Configurar
cp .env.example .env
# Editar .env con tus credenciales

# Construir y ejecutar
docker compose up -d

# Ver logs
docker compose logs -f

# Escanear QR (la primera vez)
curl http://localhost:3001/qr
```

## Configuración

### Variables de Entorno

```bash
# Chatwoot
CHATWOOT_URL=https://tu-chatwoot.com
CHATWOOT_API_KEY=tu_api_key
CHATWOOT_INBOX_ID=1

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=tu_password

# Webhook
WEBHOOK_SECRET=secreto_opcional
```

## Redis - Cache y Retry

El bridge usa Redis para:

### Cache
- Conversaciones (JID → Chatwoot ID)
- Mensajes (mappings WhatsApp ↔ Chatwoot)
- Contactos
- Rate limiting por usuario

### Cola de Reintentos
Si la API de Chatwoot falla:
1. El mensaje se guarda en Redis
2. Se reintenta con backoff: 1s, 5s, 15s, 30s, 1min
3. Máximo 5 intentos
4. Si falla definitivamente, se puede revisar

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health` | Estado del bridge |
| `GET` | `/qr` | QR code para escanear |
| `POST` | `/send` | Enviar mensaje |
| `POST` | `/webhook` | Webhook de Chatwoot |

## Configurar Webhook en Chatwoot

En Chatwoot Settings → Integrations → Webhooks:
- URL: `http://tu-ip:3002/`
- Events: `message_created`
- Secret: (opcional)

## Uso

1. **Iniciar**: El bridge arranca y genera un QR
2. **Escanear**: Abre `/qr` y escanea con WhatsApp
3. **Usar**: Los mensajes de WhatsApp aparecen en Chatwoot
4. **Responder**: Los agentes responden desde Chatwoot y llegan a WhatsApp

## Problemas Conocidos

⚠️ **Ban de WhatsApp**: Usar Baileys puede resultar en ban si WhatsApp detecta uso automatizado.

## Seguridad

- No exponer los puertos públicamente sin firewall
- Usar HTTPS en producción
- Mantener el API key y Redis password seguras

## Estructura

```
src/
├── index.js              # Main + Express API
├── config.js             # Configuration
├── services/
│   ├── chatwoot.js      # Chatwoot API client
│   ├── media.js          # Media download/upload
│   ├── cache.js          # Redis cache
│   └── retryQueue.js     # Retry queue
├── handlers/
│   ├── incoming.js       # WhatsApp → Chatwoot
│   └── outgoing.js        # Chatwoot → WhatsApp
└── state/
    └── store.js          # Local state (backup)
```

## Licencia

MIT
