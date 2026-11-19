# Sloptic Phone 🎨 🎵

**Sloptic Phone** is a real-time, three-person browser party game. Two people paint **on the same shared canvas** while a composer uploads an MP3 to accompany the final artwork. Everyone has a secret prompt, and everyone rates the reveal.

The game uses **one private, six-character room code**. No accounts or email addresses are needed.

## Quick start

You need Node.js 20+ and an internet connection for the first dependency installation.

```bash
npm install
npm start
```

Open **http://localhost:3000**. Click **Create a room**, copy the invite link, and have two other players join. For people outside your network, deploy to an internet-accessible Node.js host (see below). 

For a containerized version, Docker also works:

```bash
docker build -t sloptic-phone .
docker run --rm -p 3000:3000 -v sloptic_files:/app/uploads sloptic-phone
```

The Docker image includes FFmpeg so you can download complete MP4 videos from the results screen.

## How to play

1. **Lobby:** Three players join with a room link or code. The host chooses a **5-, 10-, or 15-minute** creation mode. Players claim unique roles: **1st Artist**, **2nd Artist**, and **Composer**.
2. **Planning — up to 60 seconds:** Each player writes and submits a secret prompt. You can see exactly **who receives your prompt**. Planning ends when everyone has submitted, or when the timer expires. Recipients **alternate** on the next match, so consecutive rounds never send your prompt to the same person.
3. **Creation — 5/10/15 minutes:** All players have a **single synchronized countdown**. The artists see their own and each other's prompts, and paint **simultaneously on one 1600×900 canvas**. The composer sees their prompt and uploads a high-quality MP3 from their device. An early submit locks that player's work, but **the round does not finish** until everyone submits or the shared clock expires.
4. **Reveal:** All players enter the same results screen, featuring the artwork as a **still image** with full-length MP3 playback. Play, pause, and seek freely. Save the PNG, save the MP3, or use **Export MP4** when FFmpeg is available on the server.
5. **Ratings:** Each person can give **0–5 stars** to each of the three players, including themselves. That produces a maximum of **15 stars per player**; a perfect 15 earns an **MVP** label. When all three click **Finish**, everyone returns to a fresh lobby and chooses the mode and roles again.

### Painting controls

- 28-color palette, plus a custom color picker
- Brush, eraser, paint bucket, eyedropper
- Drag-to-adjust **brush size (1–72 px)** and **opacity (1–100%)**
- Flood fill with opacity blending
- Individual undo and redo, synchronized for both artists
- Pointer/touch support on the canvas
- Hotkeys: **B** brush, **E** eraser, **G** bucket, **I** eyedropper, **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** redo

### Built-in conveniences

- Shareable room URLs (`?room=XXXXXX`), quick room-code joining, clipboard copy
- Automatic reconnection and rejoining after a refresh, as long as the server is still running
- Server-authoritative phase deadlines, prompt routing, voting totals, and canvas command history
- Presence display, teammate submission indicators, and submit locks
- Composer drag-and-drop MP3 upload with progress bar and playback preview
- Responsive UI for desktop, tablets, and smaller screens
- Automatic cleanup of inactive rooms and temporary uploads

## Make it available online

The game is **not hosted by the ZIP file itself**. To let friends join from different locations, put this project on a public Node.js host. The easiest general deployment path is:

1. Upload the contents of this project to a **GitHub repository**.
2. Create a new web service on a host that supports **Node.js and WebSockets** (for example, Railway, Render, or a Docker-compatible host).
3. Configure the build command as `npm install` and the start command as `npm start` (or deploy the included `Dockerfile`).
4. Set `PORT` if required by your host; otherwise the default is **3000**. HTTPS is recommended.
5. Open the supplied public URL, click **Create a room**, and share the invite URL with two friends.

All three participants must reach **the same running server instance**. This version stores room state in server memory. If you use a multi-instance deployment, add a shared store and Socket.IO adapter first. If the server restarts, ongoing rounds reset.

The app writes uploaded MP3s and finished PNGs to `uploads/`. Use persistent disk storage if you want uploads to survive a restart. Files are automatically cleared as rounds reset and expired rooms are removed. Ask participants to download their work **before everyone finishes**.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port |
| `MAX_AUDIO_MB` | `200` | Per-MP3 upload limit, in megabytes |
| `FFMPEG_PATH` | `ffmpeg` | Path to FFmpeg for the optional MP4 export |

**MP3 duration:** There is no length-based limit. An MP3 can play its full duration, but its file size must be within the server's configurable `MAX_AUDIO_MB` limit and any limits enforced by your hosting platform. Audio streams from the server so it is not forced into memory all at once.

**MP4 export:** Optional. If FFmpeg with H.264 and AAC support is available, the results screen displays **Export MP4**. The server combines the static high-resolution PNG with the soundtrack into a download. The MP4 encoder uses high-quality H.264 and 320 kb/s AAC. The built-in Docker image installs FFmpeg.

## Technical overview

- **Server:** Node.js, Express, Socket.IO, Multer
- **Client:** Plain HTML/CSS/JavaScript; HTML Canvas 2D
- **Communication:** Socket.IO WebSockets with fallback transport
- **Rooms:** Ephemeral single-server room registry, three seats per room
- **Draw sync:** Ordered drawing operations broadcast to teammates; operations replay on reconnect and undo/redo
- **Uploads:** Streaming multipart MP3/PNG to local disk, file-header validation, per-player upload secret
- **Results:** Shared rating state and server-computed scores

### Tests

```bash
npm test
```

The backend smoke test and client-template rendering test use stubs and therefore does **not** need npm dependencies installed. It checks room creation, joins, role assignments, host-only mode control, prompt routing and recipient rotation, planning/creation/results transitions, artwork undo/redo, composer upload gating, ratings, MVP qualification, and lobby reset.

For a manual end-to-end check, start the server and open the site in **three separate browser profiles**. Join with three different names and select the three roles. Confirm that each browser displays the same timer and that both artist canvases update when the other person draws.

## Notes

- The game works best when all players are connected throughout a round. Disconnected players can return using the same browser session and room URL; their seat remains reserved. Round finishing still requires all three players to click Finish.
- Bucket filling is pixel-based and may show minor edge differences if two artists perform complex edits at exactly the same time; the server's operation log reconciles canvases on resync.
- This is a lightweight party-game implementation, not an account-based production SaaS. Add a database, CDN/object storage, moderation controls, and rate limiting if deploying to a broad public audience.
- This is an original project inspired by collaborative drawing party games; it does not use Gartic Phone assets or code.

Made for creative chaos. ✨
