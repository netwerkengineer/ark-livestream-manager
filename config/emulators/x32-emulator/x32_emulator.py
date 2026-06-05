import socket
import sys

# Native OSC encoder/decoder (zero external dependencies)
def make_osc_string(s):
    b = s.encode('utf-8')
    pad = 4 - (len(b) % 4)
    if pad == 0:
        pad = 4
    return b + (b'\x00' * pad)

def make_osc_message(path, args):
    packet = make_osc_string(path)
    type_tag = ',' + ('s' * len(args))
    packet += make_osc_string(type_tag)
    for arg in args:
        packet += make_osc_string(arg)
    return packet

def parse_osc(data):
    path_end = data.find(b'\x00')
    if path_end == -1:
        return None, []
    path = data[:path_end].decode('utf-8', errors='ignore')
    
    idx = (path_end // 4 + 1) * 4
    if idx >= len(data):
        return path, []
        
    if data[idx:idx+1] == b',':
        tag_end = data.find(b'\x00', idx)
        if tag_end == -1:
            return path, []
        tags = data[idx+1:tag_end].decode('utf-8', errors='ignore')
        idx = (tag_end // 4 + 1) * 4
    else:
        tags = ""
        
    args = []
    for tag in tags:
        if idx >= len(data):
            break
        if tag == 's':
            arg_end = data.find(b'\x00', idx)
            if arg_end == -1:
                break
            args.append(data[idx:arg_end].decode('utf-8', errors='ignore'))
            idx = (arg_end // 4 + 1) * 4
        elif tag == 'i':
            if idx + 4 > len(data):
                break
            val = int.from_bytes(data[idx:idx+4], byteorder='big', signed=True)
            args.append(val)
            idx += 4
        elif tag == 'f':
            if idx + 4 > len(data):
                break
            import struct
            val = struct.unpack('>f', data[idx:idx+4])[0]
            args.append(val)
            idx += 4
    return path, args

def main():
    port = 10023
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', port))
    print(f"=== Behringer X32 Emulator Listening on UDP port {port} ===", flush=True)
    
    while True:
        try:
            data, addr = sock.recvfrom(2048)
            path, args = parse_osc(data)
            if not path:
                continue
                
            # Log incoming command
            print(f"[X32 OSC Received] {path} from {addr[0]}:{addr[1]} | Args: {args}", flush=True)
            
            # Respond to /xinfo
            if path == "/xinfo":
                # Respond with IP, Console Name, Console Model, Firmware Version
                response = make_osc_message("/xinfo", ["192.168.2.222", "X32-Emulator", "X32", "4.06"])
                sock.sendto(response, addr)
                print(f"[X32 OSC Sent] /xinfo response to {addr[0]}:{addr[1]}", flush=True)
                
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr, flush=True)

if __name__ == '__main__':
    main()
