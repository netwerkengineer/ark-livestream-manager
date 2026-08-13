# Development Scripts

Deze map bevat verschillende hulpscripts voor development, testing en patching.

## Patch Scripts

Scripts om code-wijzigingen automatisch toe te passen:

- **patch_headers.js** - Voegt HTTP headers toe aan API routes (zoals X-Accel-Buffering voor nginx)
- **patch_route.js** - Past routing code aan
- **patch_sse_auth.js** - Past Server-Sent Events authenticatie aan
- **patch_websocket.py** - Patcht WebSocket configuratie
- **patch_ws_error.js** - Past WebSocket error handling aan

## Test Scripts

Scripts om externe diensten en functionaliteit te testen:

- **test_ws.py** - Test QLC+ WebSocket verbinding en API calls
- **test_ws.js** - JavaScript variant van WebSocket test
- **test_webdav.js** - Test WebDAV connectiviteit
- **test_parser.js** - Test parsing functionaliteit

## Scratch Scripts

Experimentele scripts en one-off utilities:

- **scratch_patch_qlc.py** - QLC+ XML file patching met CRC16-CCITT berekening voor Enttec DMX USB Pro firmware

## Gebruik

Deze scripts zijn bedoeld voor development en debugging. Ze worden **niet** gebruikt in productie.

Voorbeelden:
```bash
# Test QLC+ WebSocket verbinding
python3 scripts/test_ws.py

# Patch headers in API routes
node scripts/patch_headers.js
```
