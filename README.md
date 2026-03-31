# Baileys WhatsApp API

WhatsApp Web API usando Baileys (WebSocket-based library).

## ⚠️ Aviso Legal

Este proyecto usa la librería Baileys para interactuar con WhatsApp Web. WhatsApp no avala ni apoya este proyecto. Uselo bajo su propia responsabilidad y cumpla con los Términos de Servicio de WhatsApp.

## 🚀 Inicio Rápido

### Docker (Recomendado)

```bash
# Construir y ejecutar
docker compose up -d

# Ver logs
docker compose logs -f

# Parar
docker compose down
```

### Local (Desarrollo)

```bash
npm install
npm run dev
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

## 📖 Uso

### 1. Iniciar Sesión

```bash
curl -X POST http://localhost:3001/session/default
```

### 2. Obtener QR Code

```bash
curl http://localhost:3001/qr/default
```

Respuesta:
```json
{
  "qr": "data:image/png;base64,..."
}
```

Abre la imagen en el navegador o usa Postman.

### 3. Enviar Mensaje

```bash
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "default",
    "jid": "34612345678@s.whatsapp.net",
    "text": "Hola desde la API!"
  }'
```

### 4. Broadcast

```bash
curl -X POST http://localhost:3001/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "default",
    "numbers": ["34612345678", "34698765432"],
    "text": "Mensaje broadcast!"
  }'
```

## 🔧 Configuración

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto de la API |
| `NODE_ENV` | `development` | Entorno |

### Almacenamiento

- **Auth:** `./auth/` - Credenciales de sesión (persistente)
- **Logs:** `./logs/` - Archivos de log

## 📁 Estructura

```
baileys-whatsapp-api/
├── src/
│   └── index.js          # Servidor API
├── auth/                  # Sesiones (gitignored)
├── logs/                  # Logs
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## 🔒 Seguridad

- Cada sesión tiene su propia carpeta de auth
- Las credenciales se guardan en disco localmente
- No exponga el puerto 3001 públicamente sin firewall

## 🐳 Producción

Para producción, considere:
- Usar reverse proxy (nginx) con SSL
- Firewall para limitar acceso
- backup de la carpeta auth/
- Variables de entorno para configuración sensible

## 📝 Notas

- WhatsApp puede banear cuentas por uso automatizado
- No recomendado para spam o mensajes masivo
- Una sesión puede desconectarse si WhatsApp detecta uso sospechoso
- Escanee el QR dentro de los 60 segundos
