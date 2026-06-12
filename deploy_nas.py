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
    config['NAS_IP'] = get_input("NAS IP-adres", last_config.get('NAS_IP', "192.168.2.250"))
    config['NAS_USER'] = get_input("NAS Gebruikersnaam", last_config.get('NAS_USER', "jeffrey")) # Aanname op basis van directory naam
    config['NAS_PASS'] = getpass.getpass(f"NAS Wachtwoord voor {config['NAS_USER']}: ")
    
    config['SSH_KEY'] = get_input("Pad naar SSH Sleutel (Indien aanwezig, anders 'nee')", last_config.get('SSH_KEY', "nee"))
    if config['SSH_KEY'] is None or config['SSH_KEY'].lower() in ["nee", "none", "leeg", ""]:
        config['SSH_KEY'] = None
    elif not os.path.exists(config['SSH_KEY']):
        print(f"Waarschuwing: SSH Sleutel niet gevonden op {config['SSH_KEY']}. Wachtwoord wordt gebruikt.")
        config['SSH_KEY'] = None

    config['LOCAL_APP_PATH'] = BASE_DIR
    config['REMOTE_APP_PATH'] = get_input("Doelpad op de NAS", last_config.get('REMOTE_APP_PATH', "/volume1/docker/ark-livestream-manager"))
    
    default_emulators = "ja" if last_config.get('DEPLOY_EMULATORS', False) else "nee"
    deploy_emulators_input = get_input("Wil je de X32 & ATEM Emulators ook installeren? (ja/nee)", default_emulators)
    config['DEPLOY_EMULATORS'] = deploy_emulators_input.lower() in ["ja", "yes", "j", "y", "true"]
    
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

def deploy():
    print("==================================================")
    print("    ARK CHURCH LIVESTREAM MANAGER DEPLOYMENT v1.0")
    print("==================================================")

    config = setup_environment()
    if not config: return

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
    freeshow_path = "/volume1/Beamer/FreeShow"
    prep_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/companion-data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Media && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Shows && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Config && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {config['REMOTE_APP_PATH']} && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {freeshow_path}\""
    run_with_pty(prep_cmd, "Mappen checken en aanmaken op de NAS", config['NAS_PASS'], global_ssh_mux_socket)

    # 4. OVERZETTEN NAAR NAS
    inject_cmd = f"cat {config['LOCAL_TEMP_ARCHIVE']} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {config['REMOTE_TEMP_ARCHIVE']}\""
    subprocess.check_call(inject_cmd, shell=True)
    print("✓ Project succesvol overgebracht naar de NAS.")

    # 4.5 COMPANION IMAGE CHECK & SYNC (Stage 1: Pull, Stage 2: Transfer)
    print(f"\n>>> NAS: Controleren of Companion image (v4.3.1) aanwezig is ...")
    D_PATH = "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    check_img_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker images -q companion-nas-v4:latest\""
    img_exists = subprocess.check_output(check_img_cmd, shell=True).decode().strip()
    
    if not img_exists:
        print("⚠️ Companion v4 image niet gevonden op NAS.")
        
        # POGING 1: Direct pull op de NAS (Snelste)
        print(">>> NAS: Poging om image direct te downloaden van GitHub (Stage 1)...")
        pull_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker pull ghcr.io/bitfocus/companion/companion:v4.3.1 && sudo -S docker tag ghcr.io/bitfocus/companion/companion:v4.3.1 companion-nas-v4:latest\""
        try:
            run_with_pty(pull_cmd, "Direct pull op de NAS", config['NAS_PASS'], global_ssh_mux_socket)
            print("✓ Companion v4 image succesvol gedownload op de NAS.")
        except Exception as e:
            print(f"❌ Direct pull mislukt (mogelijk geen internet op NAS).")
            
            # POGING 2: Transfer vanaf Mac (Backup)
            print(">>> Lokaal: Bezig met voorbereiden en versturen vanaf Mac (Stage 2 - dit duurt even)...")
            local_tar = os.path.join(BASE_DIR, "companion_nas_v4.tar")
            remote_tar = f"{config['REMOTE_APP_PATH']}/companion_nas_v4.tar"
            
            # Wrapper build op Mac om Docker Save bug te omzeilen
            build_cmd = "echo 'FROM ghcr.io/bitfocus/companion/companion:v4.3.1' | docker build --platform linux/amd64 -t companion-nas-v4:latest -"
            subprocess.check_call(build_cmd, shell=True)
            subprocess.check_call(["docker", "save", "companion-nas-v4:latest", "-o", local_tar])
            
            # Versturen naar NAS
            send_img_cmd = f"cat {local_tar} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {remote_tar}\""
            subprocess.check_call(send_img_cmd, shell=True)
            
            # Inladen op NAS
            load_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"export {D_PATH} && echo '{config['NAS_PASS']}' | sudo -S docker load -i {remote_tar} && rm {remote_tar}\""
            run_with_pty(load_cmd, "Companion v4 image inladen op de NAS", config['NAS_PASS'], global_ssh_mux_socket)
            
            # Opruimen lokaal
            if os.path.exists(local_tar): os.remove(local_tar)
            print("✓ Companion v4 image succesvol overgebracht vanaf Mac.")
    else:
        print("✓ Companion v4 image is al aanwezig op de NAS.")

    # 5. UITPAKKEN & DOCKER START
    D_PATH = "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    sudo_p = f"echo '{config['NAS_PASS']}' | sudo -S env {D_PATH}"
    
    # Detect home directory of NAS user to mount SSH keys
    print(f"\n>>> NAS: Home directory van {config['NAS_USER']} detecteren ...")
    ssh_p = f"ssh -S {global_ssh_mux_socket}"
    detect_home_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"echo ~\""
    try:
        user_home = subprocess.check_output(detect_home_cmd, shell=True).decode().strip()
        print(f"✓ Gevonden home directory: {user_home}")
    except Exception as e:
        user_home = f"/volume1/homes/{config['NAS_USER']}"
        print(f"⚠️ Kon home directory niet detecteren via SSH, fallback naar: {user_home}")

    services_to_deploy = "" if config.get('DEPLOY_EMULATORS') else "livestream-manager companion qlcplus tuya-control"
    cleanup_emulators = "" if config.get('DEPLOY_EMULATORS') else "(docker stop x32-emulator atem-emulator 2>/dev/null || true) && (docker rm -f x32-emulator atem-emulator 2>/dev/null || true) && "
    deploy_cmd = (
        f"export {D_PATH} && "
        f"cd {config['REMOTE_APP_PATH']} && "
        f"echo '{config['NAS_PASS']}' | sudo -S env {D_PATH} sh -c \""
        f"tar -xzf {config['REMOTE_TEMP_ARCHIVE']} -C {config['REMOTE_APP_PATH']} && "
        f"rm -f {config['REMOTE_TEMP_ARCHIVE']} && "
        f"sed -i 's|/mnt/data/Projects/Beamer/FreeShow|/volume1/Beamer/FreeShow|g' docker-compose.yml && "
        f"chown -R {config['NAS_USER']}:users {config['REMOTE_APP_PATH']} && "
        f"chmod -R 777 {config['REMOTE_APP_PATH']} && "
        f"(pkill -f tuya_http_server.py || true) && "
        f"{cleanup_emulators}"
        f"(env SSH_KEY_DIR={user_home}/.ssh docker compose up -d --build {services_to_deploy} || env SSH_KEY_DIR={user_home}/.ssh docker-compose up -d --build {services_to_deploy}) && "
        f"docker image prune -f"
        f"\""
    )
    
    final_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"{deploy_cmd}\""
    if not run_with_pty(final_cmd, "Project uitpakken en Docker bouwen/herstarten", config['NAS_PASS'], global_ssh_mux_socket):
        print("\n❌ Fout tijdens deployment op de NAS.")
    else:
        print("\n✅ ARK CHURCH LIVESTREAM MANAGER IS LIVE OP JE NAS!")
        print(f"Bezoek: http://{config['NAS_IP']}:3005")
        save_config(config)

    cleanup_ssh_mux()
    try: os.remove(config['LOCAL_TEMP_ARCHIVE'])
    except: pass

if __name__ == "__main__":
    deploy()
