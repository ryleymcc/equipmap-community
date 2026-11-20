# Windows Shared export

An administrator can prepare a Windows Shared download from Data Manager. The
export includes a copy of the database and its referenced uploads at the time of
the export. It preserves accounts and password hashes. It excludes refresh
tokens, revoked access tokens, and ChatGPT authorization and grant records.
Store and transport the exported archive as facility data.

Build the Shared template on Windows using the instructions in
[the portable README](../portable/README-SHARED.md). Copy the resulting
EquipMap-Shared-Windows-x64.zip into the backend data volume at
/app/data/portable/EquipMap-Shared-Windows-x64.zip. A self-managed backend can
set PORTABLE_TEMPLATE_PATH to a different path. Use a freshly built template
without any local account or facility data.

Exports expire after one hour. The Shared edition keeps its own records and
does not sync changes back to the server.
