#!/usr/bin/env python3
import sys
import asyncio
import argparse
import zlib
from datetime import datetime

# Dependency auto-installer
try:
    import bleak
    from bleak import BleakClient, BleakScanner
except ImportError:
    import subprocess
    print("Required package (bleak) is missing. Installing...")
    cmds = [
        [sys.executable, "-m", "pip", "install", "--user", "--break-system-packages", "bleak"],
        [sys.executable, "-m", "pip", "install", "--user", "bleak"],
        [sys.executable, "-m", "pip", "install", "--break-system-packages", "bleak"],
        [sys.executable, "-m", "pip", "install", "bleak"],
    ]
    success = False
    for cmd in cmds:
        try:
            print(f"Trying: {' '.join(cmd)}")
            subprocess.run(cmd, check=True)
            success = True
            break
        except Exception:
            continue
    if success:
        try:
            import site
            if hasattr(site, "getusersitepackages"):
                sys.path.append(site.getusersitepackages())
        except Exception:
            pass
        import bleak
        from bleak import BleakClient, BleakScanner
        print("Installation successful!")
    else:
        print("Failed to install dependencies.")
        sys.exit(1)

# BLE UUIDs & Constants
UUID_WRITE = "0000fa02-0000-1000-8000-00805f9b34fb"
UUID_NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb"

# Native type-4 route definitions
NATIVE_TYPE4_ROUTE_MARKER = 0x65
NATIVE_TYPE4_CHUNK_SIZE = 509

# Handshake packets
HANDSHAKE_SECOND = bytes.fromhex("04 00 05 80")

# ACKs expected
ACK_STAGE_ONE = bytes.fromhex("0C 00 01 80 81 06 32 00 00 01 00 01")
ACK_STAGE_ONE_ALT = bytes.fromhex("0B 00 01 80 83 06 32 00 00 01 00")  # ACT1025 variant
ACK_STAGE_TWO = bytes.fromhex("08 00 05 80 0B 03 07 02")
ACK_STAGE_TWO_ALT = bytes.fromhex("08 00 05 80 0E 03 07 01")  # ACT1025 variant
ACK_STAGE_THREE = bytes.fromhex("05 00 02 00 03")

# Inline iPixel native glyph map (8x10 glyphs for A-Z and space)
GLYPHS_8X10 = {
    " ": bytes((0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)),
    "A": bytes((0x1C, 0x36, 0x63, 0x63, 0x63, 0x7F, 0x63, 0x63, 0x63, 0x63)),
    "B": bytes((0xFC, 0x66, 0x66, 0x66, 0x7C, 0x66, 0x66, 0x66, 0x66, 0xFC)),
    "C": bytes((0x3C, 0x66, 0x63, 0x60, 0x60, 0x60, 0x60, 0x63, 0x66, 0x3C)),
    "D": bytes((0x3E, 0x66, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x66, 0x3E)),
    "E": bytes((0x7F, 0x60, 0x60, 0x60, 0x7E, 0x60, 0x60, 0x60, 0x60, 0x7F)),
    "F": bytes((0x7F, 0x60, 0x60, 0x60, 0x7E, 0x60, 0x60, 0x60, 0x60, 0x60)),
    "G": bytes((0x3C, 0x66, 0x63, 0x60, 0x60, 0x6F, 0x63, 0x63, 0x66, 0x3C)),
    "H": bytes((0x63, 0x63, 0x63, 0x63, 0x7F, 0x63, 0x63, 0x63, 0x63, 0x63)),
    "I": bytes((0x3E, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x3E)),
    "J": bytes((0x1F, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x66, 0x66, 0x3C)),
    "K": bytes((0x63, 0x66, 0x6C, 0x78, 0x70, 0x78, 0x6C, 0x66, 0x63, 0x63)),
    "L": bytes((0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x7F)),
    "M": bytes((0x63, 0x77, 0x7F, 0x7F, 0x6B, 0x63, 0x63, 0x63, 0x63, 0x63)),
    "N": bytes((0x63, 0x73, 0x7B, 0x7F, 0x6F, 0x67, 0x63, 0x63, 0x63, 0x63)),
    "O": bytes((0x3E, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x3E)),
    "P": bytes((0x3F, 0x66, 0x66, 0x66, 0x3E, 0x60, 0x60, 0x60, 0x60, 0x60)),
    "Q": bytes((0x3E, 0x63, 0x63, 0x63, 0x63, 0x63, 0x6B, 0x67, 0x3E, 0x03)),
    "R": bytes((0x3F, 0x66, 0x66, 0x66, 0x3E, 0x78, 0x6C, 0x66, 0x63, 0x63)),
    "S": bytes((0x3E, 0x63, 0x60, 0x60, 0x3E, 0x03, 0x03, 0x03, 0x63, 0x3E)),
    "T": bytes((0x7F, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C)),
    "U": bytes((0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x3E)),
    "V": bytes((0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x63, 0x36, 0x1C, 0x08)),
    "W": bytes((0x63, 0x63, 0x63, 0x63, 0x63, 0x6B, 0x7F, 0x7F, 0x77, 0x63)),
    "X": bytes((0x63, 0x63, 0x36, 0x1C, 0x08, 0x1C, 0x36, 0x63, 0x63, 0x63)),
    "Y": bytes((0x63, 0x63, 0x63, 0x36, 0x1C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C)),
    "Z": bytes((0x7F, 0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0x60, 0x60, 0x7F),)
}

class AckWatcher:
    def __init__(self) -> None:
        self.stage_one = asyncio.Event()
        self.stage_two = asyncio.Event()
        self.stage_three = asyncio.Event()

    def reset(self) -> None:
        self.stage_one.clear()
        self.stage_two.clear()
        self.stage_three.clear()

    def handler(self, _sender: int, data: bytearray) -> None:
        payload = bytes(data)
        print(f"Received notification: {payload.hex().upper()}")
        
        # Stage 1 ACK matching (ignoring dynamic time bytes)
        is_stage_one = (
            (len(payload) == 11 and payload.startswith(b"\x0B\x00\x01\x80\x83") and payload.endswith(b"\x00\x00\x01\x00")) or
            (len(payload) == 12 and payload.startswith(b"\x0C\x00\x01\x80\x81") and payload.endswith(b"\x00\x00\x01\x00\x01"))
        )
        
        # Stage 2 ACK matching
        is_stage_two = (len(payload) == 8 and payload.startswith(b"\x08\x00\x05\x80"))
        
        if is_stage_one:
            self.stage_one.set()
        elif is_stage_two:
            self.stage_two.set()
        elif payload == ACK_STAGE_THREE:
            self.stage_three.set()

def reverse_bits_byte(value: int) -> int:
    value &= 0xFF
    out = 0
    for _ in range(8):
        out = (out << 1) | (value & 1)
        value >>= 1
    return out

def glyph_for_char(ch: str) -> bytes:
    key = ch.upper()
    if key not in GLYPHS_8X10:
        key = " "
    raw = GLYPHS_8X10[key]
    return bytes(reverse_bits_byte(b) for b in raw)

def build_text_record_body(
    text: str,
    fg_color: tuple[int, int, int] = (255, 0, 0),
    bg_color: tuple[int, int, int] = (0, 0, 0),
    effect_code: int = 1,
) -> bytes:
    text = text or " "
    body = bytearray()
    body.extend(
        (
            len(text) & 0xFF,
            0x00,
            0x01,
            0x01,
            effect_code & 0xFF,
            0x50,
            0x00,
        )
    )
    body.extend(fg_color)
    body.extend(bg_color)
    body.extend((0x00, 0x00))
    body.extend(fg_color)
    body.extend(bg_color)

    glyphs = [glyph_for_char(ch) for ch in text]
    body.extend(glyphs[0])
    body.extend(b"\x00" * (4 if len(glyphs) > 1 else 3))

    for idx, glyph in enumerate(glyphs[1:], start=1):
        body.extend(fg_color)
        body.extend(bg_color)
        body.extend(glyph)
        body.extend(b"\x00" * (4 if idx < len(glyphs) - 1 else 3))
    return bytes(body)

def build_a1_payload(
    text: str,
    fg_color: tuple[int, int, int] = (255, 0, 0),
    bg_color: tuple[int, int, int] = (0, 0, 0),
    effect_code: int = 1,
) -> bytes:
    total_data = build_text_record_body(
        text,
        fg_color=fg_color,
        bg_color=bg_color,
        effect_code=effect_code,
    )
    packet = bytearray()
    packet.extend((len(total_data) + 15).to_bytes(2, "little"))
    packet.extend(b"\x00\x01")
    packet.append(0x00)
    packet.extend(len(total_data).to_bytes(4, "little"))
    packet.extend((zlib.crc32(total_data) & 0xFFFFFFFF).to_bytes(4, "little"))
    packet.extend((0x00, NATIVE_TYPE4_ROUTE_MARKER))
    packet.extend(total_data)
    return bytes(packet)

def build_handshake() -> bytes:
    now = datetime.now()
    return bytes((0x08, 0x00, 0x01, 0x80, now.hour & 0xFF, now.minute & 0xFF, now.second & 0xFF, 0x00))

async def find_device() -> str:
    print("Scanning for Bluetooth LED panel (BK_LIGHT, LED_BLE_*, BJ_LED)...")
    devices = await BleakScanner.discover(timeout=6.0)
    for d in devices:
        name = d.name or ""
        if name.startswith("LED_BLE_") or "BK_LIGHT" in name.upper() or name.startswith("BJ_LED"):
            print(f"Discovered device: {d.name} [{d.address}]")
            return d.address
    return None

async def wait_for_ack(event: asyncio.Event, label: str, timeout: float = 4.0) -> None:
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
        print(f"ACK {label} success")
    except asyncio.TimeoutError:
        print(f"ACK {label} timeout")
        raise

async def main() -> None:
    parser = argparse.ArgumentParser(description="ACT1025 Native Hardware Text Scrolling Controller")
    parser.add_argument("--status", choices=["active", "inactive"], required=True, help="Stream status (active=ON AIR, inactive=OFFLINE)")
    parser.add_argument("--mac", help="MAC address of the BK-Light LED panel (optional)")
    parser.add_argument("--text", help="Custom text to display")
    parser.add_argument("--color", help="Custom text color (RGB as R,G,B or hex as #RRGGBB)")
    args = parser.parse_args()

    mac = args.mac
    if not mac:
        mac = await find_device()
        if not mac:
            print("No compatible Bluetooth LED panel discovered.")
            sys.exit(1)

    print(f"Target LED Panel address: {mac}")
    watcher = AckWatcher()

    # Configure text and color based on status
    if args.status == "active":
        # LIVESTREAM ON AIR: Red, scrolling
        text = args.text if args.text else "LIVESTREAM ON AIR"
        fg_color = (255, 0, 0)
    else:
        # LIVESTREAM OFFLINE: Green, scrolling
        text = args.text if args.text else "LIVESTREAM OFFLINE"
        fg_color = (0, 255, 0)

    if args.color:
        try:
            cleaned_color = args.color.strip()
            if cleaned_color.startswith("#"):
                hex_val = cleaned_color.lstrip("#")
                fg_color = tuple(int(hex_val[i:i+2], 16) for i in (0, 2, 4))
            elif "," in cleaned_color:
                fg_color = tuple(int(c.strip()) for c in cleaned_color.split(","))
        except Exception as e:
            print(f"Warning: Failed to parse custom color '{args.color}', using default status color. Error: {e}")

    # 1 = scroll-left
    payload = build_a1_payload(text, fg_color=fg_color, bg_color=(0, 0, 0), effect_code=1)
    
    # Split payload into chunks if necessary
    chunks = [payload[i:i+NATIVE_TYPE4_CHUNK_SIZE] for i in range(0, len(payload), NATIVE_TYPE4_CHUNK_SIZE)]
    print(f"Constructed native payload of {len(payload)} bytes ({len(chunks)} chunks).")

    attempt = 0
    max_retries = 3
    interval = 0.06 # 60ms gap between packets

    while attempt < max_retries:
        attempt += 1
        try:
            print(f"Connecting to panel (attempt {attempt}/{max_retries})...")
            async with BleakClient(mac) as client:
                if not client.is_connected:
                    raise ConnectionError("GATT connection failed")

                print("Connected! Subscribing to notifications...")
                await client.start_notify(UUID_NOTIFY, watcher.handler)
                
                # Handshake Stage 1
                watcher.reset()
                print("Sending Handshake Stage 1...")
                await client.write_gatt_char(UUID_WRITE, build_handshake(), response=False)
                await wait_for_ack(watcher.stage_one, "STAGE_ONE")
                await asyncio.sleep(interval)

                # Handshake Stage 2
                try:
                    watcher.reset()
                    print("Sending Handshake Stage 2...")
                    await client.write_gatt_char(UUID_WRITE, HANDSHAKE_SECOND, response=False)
                    await wait_for_ack(watcher.stage_two, "STAGE_TWO", timeout=2.0)
                except Exception:
                    print("Handshake Stage 2 skipped/ignored (expected for some models)")
                await asyncio.sleep(interval)

                # Send route confirmation headers
                print("Sending route confirmation...")
                await client.write_gatt_char(UUID_WRITE, bytes.fromhex("05 00 12 80 07"), response=False)
                await asyncio.sleep(interval)
                await client.write_gatt_char(UUID_WRITE, bytes.fromhex("07 00 08 80 01 00 03"), response=False)
                await asyncio.sleep(interval)

                # Transmit payload chunks
                print("Sending text payload chunks...")
                for idx, chunk in enumerate(chunks, 1):
                    print(f"Writing chunk {idx}/{len(chunks)}...")
                    await client.write_gatt_char(UUID_WRITE, chunk, response=False)
                    await asyncio.sleep(interval)

                print("Finished transmitting payload. Closing BLE connection.")
                await client.stop_notify(UUID_NOTIFY)
                print("[SUCCESS] Successfully updated LED panel text!")
                return
        except Exception as e:
            print(f"Error during BLE communication: {e}")
            if attempt < max_retries:
                print("Retrying in 2.0s...")
                await asyncio.sleep(2.0)
            else:
                print("[ERROR] Failed to update LED panel after maximum retries.")
                sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Cancelled by user.")
