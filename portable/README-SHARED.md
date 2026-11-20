EquipMap Shared for Windows 11 x64 — shared-folder preview

Extract the ENTIRE ZIP into one shared folder. Every PC opens the SAME
EquipMap-Shared.exe from that folder. Keep _internal beside the EXE.
All users need read/write access to the shared folder and permission to run
the unsigned EXE. No Python, Node, Docker, database installer, administrator
rights, dedicated host, or incoming network port is required on those PCs.

The first person chooses the shared admin account password (any non-empty
length). Later users use the same accounts. Additional accounts can be created
through the existing user-management screen. Each PC has its own localhost
browser address and its own launcher. Stop and exit closes only that PC's app.

WHERE DATA LIVES
The authoritative records, account/password hashes, signing key, floorplans,
photos, manuals and audit history are in the EquipMap Data folder beside the
EXE. Preserve that ENTIRE folder. It is not tied to a Windows username.
All clients must point to the same shared folder, not independent copied EXEs.
Do not use OneDrive/Dropbox/cloud-sync folders as a substitute for a shared
filesystem: those do not provide a common Windows file-locking authority.
Windows Offline Files must not cache this shared data folder for offline writes.

Each Windows user also gets a disposable local cache under
%LOCALAPPDATA%\EquipMap Shared Cache. It contains a copy of the business data,
but is never the only saved copy. Stop the app before removing its local cache;
the next launch rebuilds it from the shared folder. Do not remove caches while
the app is running. Host profile/disk-protection policies apply to these copies.

HOW SIMULTANEOUS USE WORKS
Each PC opens SQLite ONLY in its local cache. No active SQLite database,
database lock file or database journal is opened directly over the network.
The shared folder holds closed immutable database snapshots and file blobs.
Windows byte-range locks and revision checks coordinate publishing a completed
snapshot. Success is returned only after publishing to the shared folder.
Conflicting simultaneous writes return an explicit error; reload and retry.
Ordinary sequential edits to the same record still follow the existing app's
last-save behavior: this edition does not merge field-by-field edits.
If the share is unavailable, saves fail instead of accepting private local data.
There is no offline editing queue. A PC need not remain on to serve others.

BACKUPS AND UPDATES
Stop all clients, then copy the entire EquipMap Data folder to an approved
backup destination. Restore the entire folder with all clients stopped.
Replace only the EXE, _internal and documentation when updating; preserve
EquipMap Data. Do not edit/delete shared-settings.json, current.json,
coordination.lock, revisions or blobs individually. Old snapshots/blobs are
retained for recovery; deleting a file from the current app does not erase its
older backup copies. This preview does not reclaim old shared snapshots.
Snapshot size and network latency determine save cost; this is intended for
evaluation with a small facility dataset, not an unbounded high-traffic server.

SECURITY AND VALIDATION LIMITS
Two independent local processes were tested against a common folder, including
concurrent writes, shared uploads, audit undo, loss of folder access and recovery
after deleting both local caches. Real SMB/NAS behavior has NOT been tested.
The intended share must support coherent reads, Windows byte-range locks,
atomic file replacement and durable flushes. Its actual behavior must be
qualified before using this build for live facility data.
Windows or corporate policy may block running an unsigned EXE from a share.
This package does not bypass those policies or require disabling protections.
Anyone who can read/write the raw shared data can copy or alter it outside the
app; app roles do not replace filesystem access control. Data is not encrypted
by this application. Use approved folder rights and storage/backup protection.
External ChatGPT and push integrations are unavailable in this edition.

This is a separate storage format from the local PostgreSQL edition. Existing
local/hosted records are NOT automatically migrated or synchronized.

BUILD MACHINE ONLY
Use the Python 3.12 portable build environment and install aiosqlite==0.22.1
in addition to the existing backend/build requirements. Run
portable/build.py --shared. Build output is portable/dist/EquipMap-Shared.
Source-level two-process check: portable/shared_smoke_test.py --source.
Packaged two-process check: portable/shared_smoke_test.py.
