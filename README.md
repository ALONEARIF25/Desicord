# Desicord

Desicord is a Discord-styled chat interface for small realtime rooms. It uses Next.js for the application, Neon Postgres for persistent data and PostgreSQL notifications for realtime message delivery.

This is a room-based chat application, not a full Discord replacement. It has username/password authentication, room access controls, basic moderation, profile editing, and S3-compatible file storage. It does not currently include OAuth, roles beyond the configured admin list, direct messages, reactions, threads, or a separate channel model.

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Neon Postgres through the `postgres` client
- PostgreSQL `LISTEN`/`NOTIFY` for server-sent realtime events
- Tailwind CSS 4
- S3-compatible object storage for avatars and payload uploads

## Pages

### `/`

The main Desicord interface:

- Register and log in with a username, password, and college roll
- List available rooms and show whether the current user can read or write
- Join rooms
- Read paginated message history
- Load older messages
- Send messages up to 1,000 characters
- Receive new messages over Server-Sent Events
- View room members
- Edit a profile bio and avatar
- Log out

The current user ID is stored in browser `localStorage` under `neon-chat-user`. There are no server-side sessions or cookies.

### `/admin/manage`

The admin management console. Access is granted only when the signed-in username appears in `ADMIN_USERNAMES`.

Admins can:

- Create rooms
- Edit room names, descriptions, accent colors, and access modes
- Configure room allowlists
- Delete a room
- Delete all messages in a room
- Delete messages in a date range
- Delete users and their related records
- View room message counts and registered users

## API routes

All routes are implemented in the Next.js App Router.

### `GET /api/chat`

Returns the room list, the current user, joined room IDs, and access flags.

Query parameters:

- `userId` - optional user UUID
- `serverId` - optional room ID; when provided, also returns members and messages
- `before` - optional message timestamp used to load an older page

Messages are returned in pages of 30. Private rooms require the user to be on the room allowlist.

### `POST /api/chat`

Accepts a JSON body with an `action` field.

Supported actions:

- `register` - create a user; requires `username`, `password`, and `roll`
- `login` - authenticate with `username` and `password`
- `join` - add a user to a room
- `send` - create a message with `userId`, `serverId`, and `content`
- `profile` - update the stored text avatar and bio

Passwords are hashed with Node's `scryptSync`. The endpoint returns JSON errors with HTTP status codes for invalid or unauthorized actions.

### `GET /api/chat/stream`

Opens a Server-Sent Events connection for a room.

Query parameters:

- `serverId` - required room ID
- `userId` - user UUID used for private-room authorization

Messages are published through PostgreSQL `NOTIFY` on the `chat_messages` channel. The stream only forwards events for the subscribed room.

### `POST /api/profile`

Accepts `multipart/form-data` to update a profile:

- `userId` - required user UUID
- `bio` - optional bio, limited to 160 characters
- `avatar` - optional image, limited to 5 MB

Avatars are stored in the `assets` object-storage bucket and returned as signed URLs.

### `POST /api/payload`

Accepts `multipart/form-data` for a text message and optional file:

- `message` - optional text
- `file` - optional file, limited to 10 MB

The file is written to the `assets` bucket and metadata is stored in the `payloads` table. This route is available as a backend upload endpoint; the current main chat composer does not use it for normal messages.

### `GET /api/admin`

Returns room and user management data for an authenticated admin.

Query parameters:

- `userId` - required ID of a user whose username must be listed in `ADMIN_USERNAMES`

### `POST /api/admin`

Requires an admin `userId` and accepts an `action` field.

Supported actions:

- `createServer`
- `updateServer`
- `deleteServer`
- `deleteServerMessages`
- `deleteMessagesByDate`
- `deleteUser`

Room access modes are:

- `public` - anyone can read and write
- `read-only` - anyone can read; only allowlisted users can write
- `private` - only allowlisted users can read and write

## Data model

The application creates its tables at runtime if they do not exist:

- `chat_users`
- `chat_servers`
- `chat_server_allowlist`
- `chat_memberships`
- `chat_messages`
- `payloads` when `/api/payload` is first used

There are no separate migration files in this repository. The API handlers perform the initial table creation and small schema updates.

## Requirements

- Node.js compatible with the installed Next.js version
- A Neon Postgres database
- An S3-compatible object-storage provider if avatar or payload uploads are needed

## Environment variables

Create a local `.env.local` file. Do not commit it.

```env
DB_URL=postgresql://user:password@host/database?sslmode=require

# Optional. If omitted, the chat stream derives a non-pooler URL from DB_URL.
REALTIME_DB_URL=postgresql://user:password@direct-host/database?sslmode=require

# Comma-separated usernames allowed to use /admin/manage.
ADMIN_USERNAMES=admin,moderator

# S3-compatible storage
AWS_ENDPOINT_URL_S3=https://your-storage-endpoint
AWS_REGION=auto
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

The object-storage bucket is hard-coded as `assets` in the upload and avatar helpers. Create that bucket and configure credentials with permission to write objects and generate signed read URLs before using uploads.

## Run locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other available scripts:

```bash
npm run build
npm run start
npm run lint
```

## Deployment notes

The chat API uses the Node.js runtime because it connects directly to Postgres and uses Node crypto APIs. The realtime route needs a direct Neon connection that supports PostgreSQL `LISTEN`; a pooled connection may not reliably support that use case. Set `REALTIME_DB_URL` explicitly when the derived URL is not valid for the deployment.

The application does not seed an initial room or admin account. Set `ADMIN_USERNAMES`, register one of those usernames, and then open `/admin/manage` to create the first room.
