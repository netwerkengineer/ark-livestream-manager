import asyncio
import websockets

async def test():
    try:
        async with websockets.connect("ws://127.0.0.1:9999/qlcplusWS") as ws:
            print("Connected to QLC+ WebSocket!")
            await ws.send("QLC+API|getWidgetStatus|53")
            res = await asyncio.wait_for(ws.recv(), timeout=2.0)
            print("Response:", res)
    except Exception as e:
        print("Failed:", e)

asyncio.run(test())
