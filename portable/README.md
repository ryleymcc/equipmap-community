EquipMap Portable for Windows 11 x64

Extract the ENTIRE ZIP into a folder your account can read, then double-click
EquipMap.exe. Keep the _internal folder beside the EXE. No installation,
administrator rights, Windows service, Node.js, Python, or Docker is needed on
the destination PC. Use an existing Edge or Chrome browser.

On first launch, choose a password of any non-empty length. Sign in to the
browser as admin with that password. This is a new, empty, independent database;
it does not connect to your hosted EquipMap or copy its records automatically.

Leave the launcher open while using EquipMap. Click Stop and exit when finished.
Closing the browser alone leaves the local server running. Run the EXE again to
restart later; your data and local browser origin are preserved.

DATA AND BACKUPS
All mutable data is stored under %LOCALAPPDATA%\EquipMap Portable, including
database, uploads, and settings/signing keys. Keep
this folder private to your Windows account. It is not application-encrypted;
Windows account permissions and facility disk-protection policies apply.
To back up, Stop and exit, then copy the ENTIRE data folder to an approved backup
location. Restore the entire folder with EquipMap stopped, using the same
PostgreSQL major version (15). Backups include credentials and must be protected.
Replacing the application folder does not delete your data. Do not delete or
edit settings.json: it contains the local database password and signing key.

NETWORK AND FACILITY POLICY
The web server and PostgreSQL bind only to 127.0.0.1 on user-level ports. There
are no firewall changes, startup tasks, registry installation, auto-updaters, or
telemetry in this edition. Fonts, PDF workers and English room OCR are bundled.
Local work remains available with no internet. ChatGPT connections and
remote push notifications are not supported in this offline edition. The local
app is single-user/single-process; rate limits are kept in that process.

This build is unsigned. A facility using WDAC, AppLocker, Smart App Control or
other application control may need IT to approve the EXE and bundled PostgreSQL
and OCR executables. This package does not bypass corporate policies. Do not
disable protection to run it. A signed/allowlisted release is a separate step.

TROUBLESHOOTING
The launcher reports startup failures. Logs are in the data folder's logs
subfolder. A port conflict is reported instead of silently moving the database
or changing the browser origin. Only one instance may use a given data folder.
After a power interruption PostgreSQL performs its normal crash recovery.

BUILD MACHINE ONLY
Create a Python 3.12 venv in portable/build-env. Install backend/requirements.txt
and PyInstaller 6.20.0 (or the recorded portable/requirements.lock.txt).
Install frontend dependencies using the existing frontend lock file.
Run portable/prepare.py to download and unpack redistributables, then run
portable/build.py. The destination PC never runs these build scripts or
downloads dependencies. Output includes dependency versions and SHA256 hashes.

Run portable/smoke_test.py against the finished local package.
