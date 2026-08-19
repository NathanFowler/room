# Room

Nathan’s spatial 360. An infinite canvas for pinning files, notes, decks and links next to their subject. Projects are regions, not folders.

Public shell: https://nathanfowler.github.io/room/

The shell can stay public. The canvas — notes, uploads, positions, and raise files — saves to the private repo `NathanFowler/room-data` after you Connect. It is never committed to this Pages repo. IndexedDB is a cache in the browser, not the source of truth.

On first visit (no token): the public Xplorr seed cluster from `/seed`. Connect with a fine-grained PAT that can only read/write `NathanFowler/room-data` (Contents). The token lives in this browser’s localStorage. Sign out clears it; the private repo is unchanged.

Another machine: Connect with the same token, see the same canvas.

## Move around
- Wheel zooms toward the cursor. Pinch / ctrl-wheel also zooms.
- Space-drag, middle-drag, empty-canvas drag, or sideways / shift-wheel pans.
- Drop files on the canvas. Double-click empty space (or `N`) for a note.
- Double-click a memo, deck or image to open it.

## Seed
Public seed on Pages: the three regions (Xplorr, Nosis, QRE), the site links, the market brief, and a short note to connect. Everything else stays in the private repo after Connect.
