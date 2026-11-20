# Equipment documents and manuals

Open an existing equipment pin, then select **Documents & manuals** in its drawer. The separate modal lists reference files without expanding the drawer. Editors can add and remove files; other users can view them under the same read-access policy as equipment photos.

Supported files: PDF, text, Word, Excel and PowerPoint, up to 25 MB each. **Open** uses a new browser tab; unsupported browser formats download for the device's associated application. No third-party viewer service receives the file.

The equipment_documents table is created by the normal backend startup table initialization. Files are stored in uploads/equipment-documents and must be included with database/upload backups. Files are online-only and excluded from the public-media cleanup inventory. Removing a reference retains the physical file, matching the existing conservative upload-retention behavior. Document actions are recorded in audit history and do not support undo.

Validation: backend/test_equipment_documents.py covers the API with an isolated SQLite database. frontend/tests/documents-browser.cjs exercises the production build using the local photo fixture and mocked document endpoints at 1440, 1024 and 390 pixels.
