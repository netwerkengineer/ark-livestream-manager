#!/usr/bin/env python3
import xml.etree.ElementTree as ET
import os

def crc16_ccitt(data, init=0xffff, poly=0x1021, refin=True, refout=True, xorout=0xffff):
    crc = init
    for b in data:
        if refin:
            b = int(format(b, "08b")[::-1], 2)
        crc ^= (b << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ poly
            else:
                crc <<= 1
            crc &= 0xffff
    if refout:
        crc = int(format(crc, "016b")[::-1], 2)
    return crc ^ xorout

def get_osc_channel(path):
    return crc16_ccitt(path.encode('utf-8'))

def patch_project():
    project_path = "/Volumes/OWC-DISK/scripts/antigravity/livestream-manager/config/ark_church_lighting.qxw"
    if not os.path.exists(project_path):
        print(f"Error: {project_path} does not exist.")
        return

    # Register namespace to prevent ns0 prefix in output
    ns = "http://www.qlcplus.org/Workspace"
    ET.register_namespace("", ns)
    ns_prefix = f"{{{ns}}}"

    # Parse XML
    tree = ET.parse(project_path)
    root = tree.getroot()

    engine = root.find(f"{ns_prefix}Engine")
    if engine is None:
        print("Error: Engine tag not found.")
        return

    # Remove existing additions (if rerun)
    for f in list(engine.findall(f"{ns_prefix}Function")):
        fid = int(f.get("ID"))
        if 100 <= fid <= 137:
            engine.remove(f)

    # 1. Add KLS Spot functions
    colors = [
        ("Red", (255, 0, 0)),
        ("Green", (0, 255, 0)),
        ("Blue", (0, 0, 255)),
        ("Amber", (255, 100, 0)),
        ("Magenta", (255, 0, 255)),
        ("Cyan", (0, 255, 255)),
        ("UV", (100, 0, 255)),
        ("White", (255, 255, 255))
    ]

    # Eurolite KLS-200 DMX channels for Spots 1-4:
    # Spot 1: R=3, G=4, B=5
    # Spot 2: R=6, G=7, B=8
    # Spot 3: R=9, G=10, B=11
    # Spot 4: R=12, G=13, B=14
    # All require: Mode (0) = 0, Master Dimmer (1) = 255, Strobe (2) = 0
    spot_channels = {
        1: (3, 4, 5),
        2: (6, 7, 8),
        3: (9, 10, 11),
        4: (12, 13, 14)
    }

    inserted_funcs = 0
    # Insert new functions before Monitor tag
    monitor_node = engine.find(f"{ns_prefix}Monitor")
    monitor_idx = list(engine).index(monitor_node)

    for spot_num, channels in spot_channels.items():
        start_id = 100 + (spot_num - 1) * 10
        for offset, (color_name, rgb) in enumerate(colors):
            func_id = start_id + offset
            func_name = f"KLS Spot {spot_num}: {color_name}"

            # Create Function element in namespace
            f_elem = ET.Element(f"{ns_prefix}Function", ID=str(func_id), Type="Scene", Name=func_name)
            speed_elem = ET.SubElement(f_elem, f"{ns_prefix}Speed", FadeIn="0", FadeOut="0", Duration="0")
            
            # Fixture ID 19 and 20 (KLS Bar 1 and Bar 2)
            for fix_id in ["19", "20"]:
                val_str = f"0,0,1,255,2,0,{channels[0]},{rgb[0]},{channels[1]},{rgb[1]},{channels[2]},{rgb[2]}"
                fix_val = ET.Element(f"{ns_prefix}FixtureVal", ID=fix_id)
                fix_val.text = val_str
                f_elem.append(fix_val)

            engine.insert(monitor_idx, f_elem)
            monitor_idx += 1
            inserted_funcs += 1

    print(f"Added {inserted_funcs} color functions for KLS individual spots.")

    # 2. Add Virtual Console Widgets
    vc = root.find(f"{ns_prefix}VirtualConsole")
    if vc is None:
        print("Error: VirtualConsole tag not found.")
        return

    main_frame = vc.find(f"{ns_prefix}Frame")
    if main_frame is None:
        print("Error: Main Frame not found in VirtualConsole.")
        return

    # Clean existing additions
    for f in list(main_frame.findall(f"{ns_prefix}Frame")):
        fid = int(f.get("ID", 0))
        if 100 <= fid <= 130:
            main_frame.remove(f)
    for sd in list(main_frame.findall(f"{ns_prefix}SpeedDial")):
        sd_id = int(sd.get("ID", 0))
        if sd_id == 99:
            main_frame.remove(sd)

    # Add KLS Spot frames & buttons
    # Coordinates layout:
    # Spot 1: X=730, Y=10
    # Spot 2: X=730, Y=250
    # Spot 3: X=1140, Y=10
    # Spot 4: X=1140, Y=250
    spot_coords = {
        1: (730, 10),
        2: (730, 250),
        3: (1140, 10),
        4: (1140, 250)
    }

    for spot_num, coords in spot_coords.items():
        frame_id = 100 + (spot_num - 1) * 10
        frame_elem = ET.Element(f"{ns_prefix}Frame", Caption=f"Color Picker (KLS Spot {spot_num})", ID=str(frame_id))
        
        appearance = ET.SubElement(frame_elem, f"{ns_prefix}Appearance")
        ET.SubElement(appearance, f"{ns_prefix}FrameStyle").text = "Sunken"
        ET.SubElement(appearance, f"{ns_prefix}ForegroundColor").text = "Default"
        ET.SubElement(appearance, f"{ns_prefix}BackgroundColor").text = "Default"
        ET.SubElement(appearance, f"{ns_prefix}BackgroundImage").text = "None"
        ET.SubElement(appearance, f"{ns_prefix}Font").text = "Default"

        ET.SubElement(frame_elem, f"{ns_prefix}WindowState", Visible="True", X=str(coords[0]), Y=str(coords[1]), Width="400", Height="230")
        ET.SubElement(frame_elem, f"{ns_prefix}AllowChildren").text = "True"
        ET.SubElement(frame_elem, f"{ns_prefix}AllowResize").text = "True"
        ET.SubElement(frame_elem, f"{ns_prefix}ShowHeader").text = "True"
        ET.SubElement(frame_elem, f"{ns_prefix}ShowEnableButton").text = "True"
        ET.SubElement(frame_elem, f"{ns_prefix}Collapsed").text = "False"
        ET.SubElement(frame_elem, f"{ns_prefix}Disabled").text = "False"

        # Add buttons inside frame
        start_id = 100 + (spot_num - 1) * 10
        for offset, (color_name, _) in enumerate(colors):
            func_id = start_id + offset
            btn_id = start_id + offset + 1 # e.g. 101 for scene 100
            
            # Position: Row 1 (offset 0-3), Row 2 (offset 4-7)
            row = offset // 4
            col = offset % 4
            btn_x = 10 + col * 90
            btn_y = 40 + row * 90

            btn_elem = ET.Element(f"{ns_prefix}Button", Caption=color_name.upper(), ID=str(btn_id), Icon="")
            ET.SubElement(btn_elem, f"{ns_prefix}WindowState", Visible="True", X=str(btn_x), Y=str(btn_y), Width="80", Height="80")
            
            btn_app = ET.SubElement(btn_elem, f"{ns_prefix}Appearance")
            ET.SubElement(btn_app, f"{ns_prefix}FrameStyle").text = "None"
            ET.SubElement(btn_app, f"{ns_prefix}ForegroundColor").text = "Default"
            ET.SubElement(btn_app, f"{ns_prefix}BackgroundColor").text = "Default"
            ET.SubElement(btn_app, f"{ns_prefix}BackgroundImage").text = "None"
            ET.SubElement(btn_app, f"{ns_prefix}Font").text = "Default"

            ET.SubElement(btn_elem, f"{ns_prefix}Function", ID=str(func_id))
            ET.SubElement(btn_elem, f"{ns_prefix}Action").text = "Toggle"
            ET.SubElement(btn_elem, f"{ns_prefix}Intensity", Adjust="False").text = "100"
            
            # OSC input channel hash
            osc_path = f"/ark/light/scene/{func_id}"
            channel_hash = get_osc_channel(osc_path)
            ET.SubElement(btn_elem, f"{ns_prefix}Input", Universe="1", Channel=str(channel_hash))

            frame_elem.append(btn_elem)

        main_frame.append(frame_elem)

    print("Added Virtual Console frames and buttons for KLS individual spots.")

    # 3. Add SpeedDial
    sd_elem = ET.Element(f"{ns_prefix}SpeedDial", Caption="Color Fade Speed", ID="99")
    sd_app = ET.SubElement(sd_elem, f"{ns_prefix}Appearance")
    ET.SubElement(sd_app, f"{ns_prefix}FrameStyle").text = "Sunken"
    ET.SubElement(sd_app, f"{ns_prefix}ForegroundColor").text = "Default"
    ET.SubElement(sd_app, f"{ns_prefix}BackgroundColor").text = "Default"
    ET.SubElement(sd_app, f"{ns_prefix}BackgroundImage").text = "None"
    ET.SubElement(sd_app, f"{ns_prefix}Font").text = "Default"

    ET.SubElement(sd_elem, f"{ns_prefix}WindowState", Visible="True", X="730", Y="490", Width="200", Height="175")
    ET.SubElement(sd_elem, f"{ns_prefix}Visibility").text = "43"

    # Add functions to speed dial
    all_color_scene_ids = (
        list(range(10, 18)) +
        list(range(30, 38)) +
        list(range(40, 48)) +
        list(range(50, 58)) +
        list(range(60, 68)) +
        list(range(100, 108)) +
        list(range(110, 118)) +
        list(range(120, 128)) +
        list(range(130, 138))
    )

    for sid in all_color_scene_ids:
        ET.SubElement(sd_elem, f"{ns_prefix}Function", FadeIn="1", FadeOut="1", Duration="0").text = str(sid)

    # Input for absolute speed value
    abs_val = ET.SubElement(sd_elem, f"{ns_prefix}AbsoluteValue", Minimum="0", Maximum="10000")
    ET.SubElement(abs_val, f"{ns_prefix}Input", Universe="1", Channel="30906")

    # Current value time setting
    ET.SubElement(sd_elem, f"{ns_prefix}Time").text = "0"

    main_frame.append(sd_elem)
    print("Added Virtual Console Speed Dial (ID 99) for color fading.")

    # Save XML
    tree.write(project_path, encoding="UTF-8", xml_declaration=True)
    print("✓ Successfully saved patched QLC+ project file.")

if __name__ == "__main__":
    patch_project()
