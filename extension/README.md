# Paper Lantern Importer MVP

This Chrome extension imports PDFs into the local Paper Lantern server.

## Use

1. Start Paper Lantern from the project root:

   ```powershell
   python server.py
   ```

2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked and choose this `extension` folder.
5. Use the toolbar popup to import the current PDF/arXiv page, or right-click a PDF link and choose Import PDF to Paper Lantern.

The extension expects the server at `http://127.0.0.1:8000` by default. You can change the address in the popup.
