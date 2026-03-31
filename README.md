# Baileys WhatsApp API + Bridge

WhatsApp Web API usando Baileys con integración opcional a Chatwoot.

## ⚠️ Aviso Legal

Este proyecto usa la librería Baileys para interactuar con WhatsApp Web. WhatsApp no avala ni apoya este proyecto. Uselo bajo su propia responsabilidad y cumpla con los Términos de Servicio de WhatsApp.

## 📦 Proyectos

Este repo contiene:

1. **Baileys WhatsApp API** - API REST para enviar/recibir mensajes de WhatsApp
2. **Chatwoot Bridge** - Integración con Chatwoot como bandeja de entrada

## 🚀 Inicio Rápido

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
```

## 📡 API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/session/:sessionId` | Iniciar sesión (genera QR) |
| `GET` | `/qr/:sessionId` | Obtener QR como imagen base64 |
| `POST` | `/send` | Enviar mensaje |
| `POST` | `/broadcast` | Broadcast a múltiples números |
| `GET` | `/contacts/:sessionId` | Obtener contactos |
| `DELETE` | `/session/:sessionId` | Eliminar sesión (logout) |
| `GET` | `/sessions` | Listar sesiones activas |
| `GET` | `/health` | Health check |

## 🔌 Chatwoot Bridge

Ver [PLAN_CHATWOOT_BRIDGE.md](./PLAN_CHATWOOT_BRIDGE.md) para documentación de integración con Chatwoot.

### Características del Bridge

- Mensajes de texto, imágenes, audio, video, documentos
- Sincronización de estado (entregado, leído)
- Indicadores de typing
- Conversaciones en Chatwoot

## 🔒 Seguridad

- Las credenciales se guardan en disco localmente
- No exponga los puertos públicamente sin firewall
- WhatsApp puede banear cuentas por uso automatizado

## 📝 Notas

- WhatsApp puede banear cuentas por uso automatizado
- No recomendado para spam o mensajes masivos
- Una sesión puede desconectarse si WhatsApp detecta uso sospechoso

## 📄 Documentación

- [README.md](./README.md) - Documentación principal
- [PLAN_CHATWOOT_BRIDGE.md](./PLAN_CHATWOOT_BRIDGE.md) - Integración Chatwoot

## 📜 Licencia

MIT
