import os
import xml.etree.ElementTree as ET
import subprocess

model = os.getenv("ATEM_MODEL", "ATEM Television Studio HD")
print(f"Setting up ATEM Simulator for model: {model}")

# Parse default_config.xml
tree = ET.parse("default_config.xml")
root = tree.getroot()

# Update product attribute
root.set("product", model)

# If it's an ATEM Mini / Pro, limit the inputs to 4
if "Mini" in model and "Extreme" not in model:
    # Find the Inputs tag under Settings
    inputs_elem = root.find(".//Settings/Inputs")
    if inputs_elem is not None:
        # Keep only inputs with ID 1, 2, 3, 4
        to_remove = []
        for inp in inputs_elem.findall("Input"):
            if int(inp.get("id")) > 4:
                to_remove.append(inp)
        for inp in to_remove:
            inputs_elem.remove(inp)
            
    # Also adjust MixEffectBlocks/MixEffectBlock Program/Preview inputs if they are out of range
    for me in root.findall(".//MixEffectBlocks/MixEffectBlock"):
        prog = me.find("Program")
        if prog is not None and int(prog.get("input")) > 4:
            prog.set("input", "1")
        prev = me.find("Preview")
        if prev is not None and int(prev.get("input")) > 4:
            prev.set("input", "2")

# Write back to default_config.xml
tree.write("default_config.xml", encoding="UTF-8", xml_declaration=True)

# Start the original server
subprocess.run(["python", "atem_server.py"])
