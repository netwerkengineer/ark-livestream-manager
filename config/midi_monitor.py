import mido
import time

def monitor_midi():
    print("--- MIDI Monitor Starting ---")
    print("Available inputs:", mido.get_input_names())
    
    port_name = "IAC Driver Playback-Transit"
    
    try:
        with mido.open_input(port_name) as inport:
            print(f"Listening on '{port_name}'... (Press Ctrl+C to stop)")
            for msg in inport:
                print(f"[{time.strftime('%H:%M:%S')}] {msg}")
    except IOError:
        print(f"ERROR: Could not find MIDI port '{port_name}'.")
        print("Please ensure the IAC Driver is online and correctly named in Audio MIDI Setup.")

if __name__ == "__main__":
    monitor_midi()
