# Baileys-Chatwoot Bridge

Bridge bidireccional entre WhatsApp (vía Baileys) y Chatwoot.

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
```

## Características

- ✅ Mensajes de texto
- ✅ Imágenes
- ✅ Audio / Notas de voz
- ✅ Videos
- ✅ Documentos
- ✅ Conversaciones en Chatwoot
- ✅ Agentes responden desde Chatwoot
- ✅ Sincronización de estado

## Requisitos

- Node.js 20+
- Docker (opcional)
- Cuenta Chatwoot con API enabled
- Número de WhatsApp (no se puede usar el mismo que en WhatsApp Web)

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

### Local

```bash
npm install
npm run dev
```

## Configuración

### 1. Chatwoot

1. Crear una cuenta en tu instancia de Chatwoot
2. Ir a **Settings → Integrations → Webhooks**
3. Crear webhook con URL: `http://tu-dominio:3002/`
4. Seleccionar eventos: `message_created`
5. Copiar el API token del profile

### 2. Variables de Entorno

```bash
CHATWOOT_URL=https://tu-chatwoot.com
CHATWOOT_API_KEY=tu_api_key
CHATWOOT_INBOX_ID=1
WEBHOOK_SECRET=secreto_opcional
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health` | Estado del bridge |
| `GET` | `/qr` | QR code para escanear |
| `POST` | `/send` | Enviar mensaje |
| `POST` | `/webhook` | Webhook de Chatwoot |

### Enviar Mensaje

```bash
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "34612345678",
    "text": "Hola desde el bridge!"
  }'
```

### Configurar Webhook en Chatwoot

En Chatwoot Settings → Integrations → Webhooks:
- URL: `http://tu-ip-publica:3002/`
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
- Mantener el API key segura

## Licencia

MIT
