import pty
import os
import subprocess
import select
import time
import getpass
import json
import termios
import sys
import atexit
import re

# PADEN DETECTIE
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, ".deploy_config.json")
# SSH Mux Socket (Tijdelijk bestand op de Mac schijf)
SSH_MUX_SOCKET_DIR = "/tmp"
global_ssh_mux_socket = None

def load_config():
    """Laadt de laatste succesvolle configuratie."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_config(config):
    """Slaat de configuratie op voor de volgende keer."""
    try:
        config_to_save = config.copy()
        if 'NAS_PASS' in config_to_save:
            del config_to_save['NAS_PASS']
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config_to_save, f, indent=4)
    except:
        pass

def cleanup_ssh_mux():
    """Ruimt de SSH multiplexing socket op."""
    if global_ssh_mux_socket and os.path.exists(global_ssh_mux_socket):
        subprocess.run(["ssh", "-O", "exit", "-S", global_ssh_mux_socket, "dummy"], capture_output=True)
        try: os.remove(global_ssh_mux_socket)
        except: pass

atexit.register(cleanup_ssh_mux)

def get_input(prompt, default):
    value = input(f"{prompt} [{default}]: ").strip()
    return value if value else default

def setup_environment():
    last_config = load_config()
    print("\n--- ARK CHURCH LIVESTREAM MANAGER DEPLOYMENT SETUP ---")
    config = {}
    config['NAS_IP'] = get_input("NAS SSH IP-adres (voor deployment)", last_config.get('NAS_IP', "10.8.0.1"))

    config['NAS_LAN_IP'] = get_input("Lokaal IP-adres van de NAS in de kerk (voor QLC+)", last_config.get('NAS_LAN_IP', "192.168.2.250"))
    config['NAS_USER'] = get_input("NAS Gebruikersnaam", last_config.get('NAS_USER', "jeffrey")) # Aanname op basis van directory naam
    config['NAS_PASS'] = getpass.getpass(f"NAS Wachtwoord voor {config['NAS_USER']}: ")
    
    config['SSH_KEY'] = get_input("Pad naar SSH Sleutel (Indien aanwezig, anders 'nee')", last_config.get('SSH_KEY', "nee"))
    if config['SSH_KEY'] is None or config['SSH_KEY'].lower() in ["nee", "none", "leeg", ""]:
        config['SSH_KEY'] = None
    elif not os.path.exists(config['SSH_KEY']):
        print(f"Waarschuwing: SSH Sleutel niet gevonden op {config['SSH_KEY']}. Wachtwoord wordt gebruikt.")
        config['SSH_KEY'] = None

    # QLC+ universe network mode selection
    config['QLC_MODE'] = get_input("QLC+ Netwerk Mode (1 = Kerk/Broadcast, 2 = Thuis/Unicast)", last_config.get('QLC_MODE', "1"))
    if config['QLC_MODE'] == "2":
        config['QLC_UNICAST_IP'] = get_input("ArtNet Unicast Doel IP-adres", last_config.get('QLC_UNICAST_IP', "192.168.40.100"))
    else:
        config['QLC_UNICAST_IP'] = ""

    config['LOCAL_APP_PATH'] = BASE_DIR
    config['REMOTE_APP_PATH'] = get_input("Doelpad op de NAS", last_config.get('REMOTE_APP_PATH', "/volume1/docker/ark-livestream-manager"))
    config['LOCAL_TEMP_ARCHIVE'] = os.path.join(BASE_DIR, "deploy.tar.gz")
    config['REMOTE_TEMP_ARCHIVE'] = f"{config['REMOTE_APP_PATH']}/deploy.tar.gz"
    return config

def run_with_pty(cmd, description, nas_pass, socket_path):
    print(f"\n>>> NAS: {description} ...")
    master, slave = pty.openpty()
    
    # Echo UIT (Privacy)
    attr = termios.tcgetattr(slave)
    attr[3] = attr[3] & ~termios.ECHO
    termios.tcsetattr(slave, termios.TCSANOW, attr)
    
    is_shell = isinstance(cmd, str)
    def set_controlling_tty(): os.login_tty(slave)
    proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, close_fds=True, shell=is_shell, preexec_fn=set_controlling_tty)
    os.close(slave)
    
    last_sent_time = 0
    start_time = time.time()

    while proc.poll() is None:
        r, w, e = select.select([master], [], [], 0.5)
        if r:
            try:
                data = os.read(master, 2048).decode(errors='ignore')
                print(data, end="")
                
                # Check voor password prompt
                if ("password" in data.lower() or "wachtwoord" in data.lower()) and (time.time() - last_sent_time > 0.5):
                    time.sleep(0.3)
                    os.write(master, (nas_pass + "\n").encode())
                    last_sent_time = time.time()
                    print(f"\n[Systeem: Wachtwoord herkend en veilig verzonden]")
            except:
                break
        
        if time.time() - start_time > 1200:
            print("\nTimeout bereikt.")
            proc.terminate()
            break
            
    proc.wait()
    return proc.returncode == 0

def update_qlc_project(app_path, mode, host_ip, unicast_ip):
    """Prepare the QLC+ project file for deployment.

    For NAS deployment (mode 1/Church), the InputOutputMap is stripped to
    clean entries because the entrypoint.sh auto-detects the correct Line
    indexes at container startup by querying QLC+'s web config page.

    For Home/Proxmox deployment (mode 2), we keep hardcoded Line indexes
    since the -o flag works correctly on non-Synology systems.
    """
    file_path = os.path.join(app_path, "config", "ark_church_lighting.qxw")
    if not os.path.exists(file_path):
        print(f"⚠️ Projectbestand niet gevonden op: {file_path}. Overslaan van QLC+ configuratie.")
        return

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        if mode == "1":
            # Church/NAS mode: strip universe mappings.
            # The entrypoint.sh will auto-detect the correct Line indexes
            # at runtime by parsing QLC+'s web config page.
            print(f"Configuring project for CHURCH (auto-detect mode)...")
            new_map = """  <InputOutputMap>
   <BeatGenerator BeatType="Disabled" BPM="0"/>
   <NetworkServer Type="Native" AutoStart="False" Name="" Password=""/>
   <Universe Name="Universe 1" ID="0" Passthrough="True"/>
   <Universe Name="Universe 2" ID="1"/>
   <Universe Name="Universe 3" ID="2"/>
   <Universe Name="Universe 4" ID="3"/>
  </InputOutputMap>"""
        else:
            # Home/Proxmox mode: hardcode Line indexes (the -o flag works here)
            print(f"Configuring project for HOME (Unicast to {unicast_ip} on interface {host_ip})...")
            new_map = f"""  <InputOutputMap>
   <BeatGenerator BeatType="Disabled" BPM="0"/>
   <NetworkServer Type="Native" AutoStart="False" Name="" Password=""/>
   <Universe Name="Universe 1" ID="0" Passthrough="True">
    <Input Plugin="ArtNet" UID="{host_ip}" Line="9"/>
    <Output Plugin="ArtNet" UID="{host_ip}" Line="9">
     <PluginParameters outputIP="{unicast_ip}"/>
    </Output>
   </Universe>
   <Universe Name="Universe 2" ID="1">
    <Input Plugin="OSC" UID="{host_ip}" Line="9"/>
   </Universe>
   <Universe Name="Universe 3" ID="2"/>
   <Universe Name="Universe 4" ID="3"/>
  </InputOutputMap>"""

        pattern = r"<InputOutputMap>.*?<\/InputOutputMap>"
        updated_content, count = re.subn(pattern, new_map, content, flags=re.DOTALL)
        
        if count > 0:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(updated_content)
            print("✓ QLC+ projectbestand succesvol geconfigureerd.")
        else:
            print("⚠️ Kon <InputOutputMap> niet vinden in projectbestand.")
    except Exception as e:
        print(f"❌ Fout bij het aanpassen van projectbestand: {e}")

def deploy():
    print("==================================================")
    print("    ARK CHURCH LIVESTREAM MANAGER DEPLOYMENT v1.0")
    print("==================================================")

    config = setup_environment()
    if not config: return

    # Update QLC+ project file based on selection
    update_qlc_project(config['LOCAL_APP_PATH'], config['QLC_MODE'], config['NAS_LAN_IP'], config['QLC_UNICAST_IP'])

    global global_ssh_mux_socket
    global_ssh_mux_socket = os.path.join(SSH_MUX_SOCKET_DIR, f"ark_mux_{config['NAS_IP'].replace('.', '_')}")

    ssh_base_list = ["ssh", "-tt", "-o", "StrictHostKeyChecking=no", "-o", "ControlMaster=auto", "-o", "ControlPath=" + global_ssh_mux_socket, "-o", "ControlPersist=10m"]
    if config['SSH_KEY']: ssh_base_list += ["-i", config['SSH_KEY']]

    # 1. SSH MASTER START
    master_cmd = ssh_base_list + [f"{config['NAS_USER']}@{config['NAS_IP']}", "exit"]
    run_with_pty(master_cmd, "Beveiligde tunnel openen naar NAS", config['NAS_PASS'], global_ssh_mux_socket)

    # 2. LOKAAL INPAKKEN
    print(f"\n>>> Lokaal: Project inpakken (exclusief node_modules en build data) ...")
    tar_cmd = ["tar", "--format=ustar", "--no-xattrs", "--exclude", "._*", "--exclude", ".DS_Store", "--exclude", "node_modules", "--exclude", ".next", "--exclude", "data", "--exclude", ".git", "--exclude", "deploy.tar.gz", "-czf", config['LOCAL_TEMP_ARCHIVE'], "-C", config['LOCAL_APP_PATH'], "."]
    env = os.environ.copy()
    env["COPYFILE_DISABLE"] = "1"
    subprocess.check_call(tar_cmd, env=env)

    # 3. NAS MAP VOORBEREIDEN
    ssh_p = f"ssh -S {global_ssh_mux_socket}"
    # We maken zowel de app-map, de data-map, companion-data als de Media-map aan
    media_path = "/volume1/Beamer/FreeShow/Media"
    prep_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/companion-data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/config/qlcplus/config && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {media_path} && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {config['REMOTE_APP_PATH']} && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {media_path}\""
    run_with_pty(prep_cmd, "Mappen checken en aanmaken op de NAS", config['NAS_PASS'], global_ssh_mux_socket)


    # 4. OVERZETTEN NAAR NAS
    inject_cmd = f"cat {config['LOCAL_TEMP_ARCHIVE']} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {config['REMOTE_TEMP_ARCHIVE']}\""
    subprocess.check_call(inject_cmd, shell=True)
    print("✓ Project succesvol overgebracht naar de NAS.")

    # 4.5 COMPANION IMAGE CHECK & SYNC (Stage 1: Pull, Stage 2: Transfer)
    print(f"\n>>> NAS: Controleren of Companion image (v4.3.4) aanwezig is ...")
    D_PATH = "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    check_img_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker images -q companion-nas-v4-3-4:latest\""
    img_exists = subprocess.check_output(check_img_cmd, shell=True).decode().strip()
    
    if not img_exists:
        print("⚠️ Companion v4.3.4 image niet gevonden op NAS.")
        
        # POGING 1: Direct pull op de NAS (Snelste)
        print(">>> NAS: Poging om image direct te downloaden van GitHub (Stage 1)...")
        pull_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker pull ghcr.io/bitfocus/companion/companion:v4.3.4 && sudo -S docker tag ghcr.io/bitfocus/companion/companion:v4.3.4 companion-nas-v4-3-4:latest\""
        try:
            run_with_pty(pull_cmd, "Direct pull op de NAS", config['NAS_PASS'], global_ssh_mux_socket)
            print("✓ Companion v4.3.4 image succesvol gedownload op de NAS.")
        except Exception as e:
            print(f"❌ Direct pull mislukt (mogelijk geen internet op NAS).")
            
            # POGING 2: Transfer vanaf Mac (Backup)
            print(">>> Lokaal: Bezig met voorbereiden en versturen vanaf Mac (Stage 2 - dit duurt even)...")
            local_tar = os.path.join(BASE_DIR, "companion_nas_v4_3_4.tar")
            remote_tar = f"{config['REMOTE_APP_PATH']}/companion_nas_v4_3_4.tar"
            
            # Wrapper build op Mac om Docker Save bug te omzeilen
            build_cmd = "echo 'FROM ghcr.io/bitfocus/companion/companion:v4.3.4' | docker build --platform linux/amd64 -t companion-nas-v4-3-4:latest -"
            subprocess.check_call(build_cmd, shell=True)
            subprocess.check_call(["docker", "save", "companion-nas-v4-3-4:latest", "-o", local_tar])
            
            # Versturen naar NAS
            send_img_cmd = f"cat {local_tar} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {remote_tar}\""
            subprocess.check_call(send_img_cmd, shell=True)
            
            # Inladen op NAS
            load_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker load -i {remote_tar} && rm {remote_tar}\""
            run_with_pty(load_cmd, "Companion v4.3.4 image inladen op de NAS", config['NAS_PASS'], global_ssh_mux_socket)
            
            # Opruimen lokaal
            if os.path.exists(local_tar): os.remove(local_tar)
            print("✓ Companion v4.3.4 image succesvol overgebracht vanaf Mac.")
    else:
        print("✓ Companion v4.3.4 image is al aanwezig op de NAS.")

    # 5. UITPAKKEN & DOCKER START
    D_PATH = "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    sudo_p = f"echo '{config['NAS_PASS']}' | sudo -S env {D_PATH}"
    
    deploy_cmd = (
        f"export {D_PATH} && "
        f"cd {config['REMOTE_APP_PATH']} && "
        f"{sudo_p} tar -xzf {config['REMOTE_TEMP_ARCHIVE']} -C {config['REMOTE_APP_PATH']} && "
        f"{sudo_p} rm -f {config['REMOTE_TEMP_ARCHIVE']} && "
        f"{sudo_p} chown -R {config['NAS_USER']}:users {config['REMOTE_APP_PATH']} && "
        f"{sudo_p} chmod -R 777 {config['REMOTE_APP_PATH']} && "
        f"({sudo_p} docker compose up -d --build || {sudo_p} docker-compose up -d --build) && "
        f"{sudo_p} docker image prune -f"
    )
    
    final_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"{deploy_cmd}\""
    if not run_with_pty(final_cmd, "Project uitpakken en Docker bouwen/herstarten", config['NAS_PASS'], global_ssh_mux_socket):
        print("\n❌ Fout tijdens deployment op de NAS.")
    else:
        print("\n✅ ARK CHURCH LIVESTREAM MANAGER IS LIVE OP JE NAS!")
        print(f"Lokaal netwerk link: http://{config['NAS_LAN_IP']}:3005")
        print(f"Via VPN/SSH link:    http://{config['NAS_IP']}:3005")
        save_config(config)


    cleanup_ssh_mux()
    try: os.remove(config['LOCAL_TEMP_ARCHIVE'])
    except: pass

if __name__ == "__main__":
    deploy()
