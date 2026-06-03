import sys
import re
import argparse

def main():
    parser = argparse.ArgumentParser(description="Configure QLC+ project universes for Home (Unicast) or Church (Broadcast) environments.")
    parser.add_argument("--mode", choices=["church", "home"], required=True, help="Target environment mode: 'church' (Broadcast) or 'home' (Unicast)")
    parser.add_argument("--ip", default="192.168.2.250", help="IP address of the QLC+ host interface (e.g. NAS or LXC IP)")
    parser.add_argument("--unicast", default="192.168.40.100", help="Unicast target IP address (only used in 'home' mode)")
    args = parser.parse_args()

    file_path = "/Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/ark_church_lighting.qxw"

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading project file: {e}")
        sys.exit(1)

    # Reconstruct the InputOutputMap block depending on the mode
    if args.mode == "church":
        print(f"Configuring project for CHURCH (Broadcast on interface {args.ip})...")
        new_map = f"""  <InputOutputMap>
   <BeatGenerator BeatType="Disabled" BPM="0"/>
   <NetworkServer Type="Native" AutoStart="False" Name="" Password=""/>
   <Universe Name="Universe 1" ID="0" Passthrough="True">
    <Input Plugin="ArtNet" UID="{args.ip}" Line="1"/>
    <Output Plugin="ArtNet" UID="{args.ip}" Line="1"/>
   </Universe>
   <Universe Name="Universe 2" ID="1">
    <Input Plugin="OSC" UID="{args.ip}" Line="1"/>
   </Universe>
   <Universe Name="Universe 3" ID="2"/>
   <Universe Name="Universe 4" ID="3"/>
  </InputOutputMap>"""
    else:
        print(f"Configuring project for HOME (Unicast to {args.unicast} on interface {args.ip})...")
        new_map = f"""  <InputOutputMap>
   <BeatGenerator BeatType="Disabled" BPM="0"/>
   <NetworkServer Type="Native" AutoStart="False" Name="" Password=""/>
   <Universe Name="Universe 1" ID="0" Passthrough="True">
    <Input Plugin="ArtNet" UID="{args.ip}" Line="9"/>
    <Output Plugin="ArtNet" UID="{args.ip}" Line="9">
     <PluginParameters outputIP="{args.unicast}"/>
    </Output>
   </Universe>
   <Universe Name="Universe 2" ID="1">
    <Input Plugin="OSC" UID="{args.ip}" Line="9"/>
   </Universe>
   <Universe Name="Universe 3" ID="2"/>
   <Universe Name="Universe 4" ID="3"/>
  </InputOutputMap>"""

    # Replace InputOutputMap block
    pattern = r"<InputOutputMap>.*?<\/InputOutputMap>"
    updated_content, count = re.subn(pattern, new_map, content, flags=re.DOTALL)
    
    if count == 0:
        print("Error: Could not locate <InputOutputMap> block in the project file.")
        sys.exit(1)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(updated_content)
        print("✓ Project file updated successfully!")
    except Exception as e:
        print(f"Error writing project file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
