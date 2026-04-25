import socket
import sys

def check_port(host, port, proto='tcp'):
    if proto == 'tcp':
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        try:
            s.connect((host, port))
            return True
        except:
            return False
        finally:
            s.close()
    else:
        # UDP is trickier, we just check if we can bind or send
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.sendto(b'', (host, port))
            return True
        except:
            return False
        finally:
            s.close()

services = [
    ("Bitfocus Companion", 8000, "tcp"),
    ("OBS WebSocket", 4455, "tcp"),
    ("X32-Edit (OSC)", 10023, "udp"),
    ("QLC+ (OSC)", 7700, "udp"),
    ("Livestream Manager", 3000, "tcp")
]

print("--- Broadcast Service Diagnostic ---")
for name, port, proto in services:
    status = "UP" if check_port("127.0.0.1", port, proto) else "DOWN"
    print(f"{name:<20} | Port {port:<5} | {proto.upper():<3} | {status}")
