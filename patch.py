
import sys
path = "/volume1/docker/ark-livestream-manager/src/lib/obsManager.ts"
with open(path, "r") as f:
    data = f.read()
data = data.replace("${remoteUser}@[${remoteHost}]:${remoteScriptPath}", "${remoteUser}@${remoteHost}:${remoteScriptPath}")
with open(path, "w") as f:
    f.write(data)

