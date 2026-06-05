#!/bin/bash
set -e

echo "=== Starting QLC+ (Headless, Operate Mode) ==="
echo "Project File: /QLC/ark_church_lighting.qxw"

# Start QLC+ with:
# -w (enable Web interface on port 9999)
# -n (nogui - hide graphical interface)
# -p (operate mode - load the virtual console in active state)
# -o (open workspace file)
exec qlcplus -w -n -p -o /QLC/ark_church_lighting.qxw
