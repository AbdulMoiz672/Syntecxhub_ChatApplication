# Relay — MERN real-time chat

React + Vite frontend, Express/Node.js API, Socket.io messaging, and MongoDB persistence.

## Run locally

Requires Node.js 20.19+ and MongoDB (local installation, Docker, or Atlas).

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d
npm run dev
```

Open http://localhost:5173, register with a display name, email, and password, then join a room. To test two users, use separate browser profiles or a normal and private window. If you already have MongoDB or use Atlas, skip Docker and set `MONGODB_URI` in `.env` instead. Never commit database credentials.

For a local MongoDB installation without Docker, start MongoDB in a separate terminal:

```powershell
New-Item -ItemType Directory -Force .local-data | Out-Null
mongod --dbpath .local-data --bind_ip 127.0.0.1
```

## Features

- Join and create rooms; messages only broadcast to the joined room.
- Messages saved in MongoDB before delivery, with paginated room history.
- Online members, typing indicators, reconnect handling, and account-based identities.
- Responsive interface and server-side input validation.
- One-to-one direct messages with a people directory, online status, live unread counts, and MongoDB history. Offline recipients can read saved messages when they return.

## One-to-one conversations

Choose **Direct messages** in the sidebar, then select another user. Registered accounts appear in the people list. Conversations are independent of public rooms; only the sender and recipient receive the direct-message events or can retrieve that conversation's history. Use **Load earlier messages** for older history.

Log in to the same account on another browser or device to access the same direct-message history. Unread counts reflect messages received during the current session; saved history also includes messages received while offline.

## Friends

Open **Friends** in the sidebar, then use **Add friends** to search registered users by display name and send a request. Incoming and outgoing requests appear in **Requests**. Recipients can accept or decline; senders can cancel. Accepted friends appear in **Friends**, with **Message** and **Remove** actions.

Friendships and requests are saved in MongoDB and restored after login, including on other devices. Changes update both participants in real time. Removing a friend keeps existing message history. Direct messaging remains available to other registered users as before.

## Accounts

- Switch between **Log in** and **Register** on the opening screen. Registration requires a display name, email, password (8?128 characters), and password confirmation.
- Email addresses are normalized and unique. Display names can be duplicated. Email verification and password reset are not implemented.
- Passwords are salted and hashed with Node.js scrypt. Seven-day sessions use HttpOnly, SameSite=Strict cookies, with only session-token hashes stored in MongoDB.
- Room APIs and Socket.io connections require a valid session. Sender identity comes from the account, regardless of client payloads. Logging out revokes that session and disconnects its sockets.
- Use the logout button beside your profile to switch accounts. Other devices stay signed in independently.
- Existing guest direct-message history is claimed automatically when registering in the original browser while its old local-storage secret is still present. Guest accounts cannot log in; histories without that secret cannot be claimed.

## Production build

```powershell
npm run build
npm start
```

Express serves the built frontend at http://localhost:3001. Set `CLIENT_ORIGIN` to your public origin and `MONGODB_URI` to your database connection string. Set NODE_ENV=production and serve over HTTPS to enable Secure session cookies. Serve the frontend and API on the same origin. Deploy on a host that supports long-running Node.js processes and WebSocket connections.

## Verification

```powershell
npm test
npm run build
```

Integration tests launch a temporary MongoDB instance and verify registration, login, password hashing, session revocation/expiry, guest-history migration, sender spoofing prevention, room isolation, and direct-message persistence. The first test run downloads a MongoDB binary and needs network access.

To use an installed MongoDB binary instead of downloading one (PowerShell):

```powershell
$env:MONGOMS_SYSTEM_BINARY = (Get-Command mongod).Source
npm test
```

Rooms are shared with all logged-in users. Direct-message history is restricted to the authenticated participants. The default implementation runs on one Node.js server; multiple instances need a Socket.io adapter, shared rate limits, and shared presence handling.
