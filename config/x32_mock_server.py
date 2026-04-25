import socket
import time
import struct

# Verbeterde X32 Mock Server voor Companion 4.x
# Zorgt voor correcte OSC-padding (viervoud van 4 bytes)

PORT = 10023
BUFFER_SIZE = 1024

def osc_string(s):
    """Hulpmiddel om een string om te zetten naar OSC-formaat met correcte padding."""
    s_bytes = s.encode('utf-8') + b'\x00'
    while len(s_bytes) % 4 != 0:
        s_bytes += b'\x00'
    return s_bytes

def start_x32_mock():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(('0.0.0.0', PORT))
        print(f"--- X32 Mock Server v2 active on 0.0.0.0:{PORT} ---")
        
        while True:
            data, addr = sock.recvfrom(BUFFER_SIZE)
            msg = data.decode('utf-8', errors='ignore')
            
            if "/xinfo" in msg:
                print(f"[{time.strftime('%H:%M:%S')}] Handshake /xinfo van {addr}")
                
                # Antwoord: /xinfo ,ssss IP NAME MODEL VERSION
                # Elk deel moet perfect op 4 bytes uitkomen
                resp = osc_string("/xinfo")
                resp += osc_string(",ssss")
                resp += osc_string("127.0.0.1")
                resp += osc_string("ARK-MIXER")
                resp += osc_string("X32-MOCK")
                resp += osc_string("4.06")
                
                sock.sendto(resp, addr)
                
            elif "/xremote" in msg:
                # Companion stuurt dit elke paar seconden om de verbinding 'warm' te houden
                pass
                
            elif data:
                # Toon andere commando's (zoals mute/unmute) in de terminal
                clean_msg = data.split(b'\x00')[0].decode('utf-8', errors='ignore')
                print(f"[{time.strftime('%H:%M:%S')}] Commando ontvangen: {clean_msg}")

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        sock.close()

if __name__ == "__main__":
    start_x32_mock()
