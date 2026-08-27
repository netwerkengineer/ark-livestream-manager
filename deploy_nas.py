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
    
    print("\nSelecteer de onderdelen die je wilt deployen/updaten op de NAS:")
    
    default_livestream = "ja" if last_config.get('DEPLOY_LIVESTREAM', True) else "nee"
    config['DEPLOY_LIVESTREAM'] = get_input("1. Livestream Manager (Main App)? (ja/nee)", default_livestream).lower() in ["ja", "yes", "j", "y", "true"]
    
    default_companion = "ja" if last_config.get('DEPLOY_COMPANION', True) else "nee"
    config['DEPLOY_COMPANION'] = get_input("2. Companion (v5.0.4)? (ja/nee)", default_companion).lower() in ["ja", "yes", "j", "y", "true"]
    
    default_qlc = "ja" if last_config.get('DEPLOY_QLC', True) else "nee"
    config['DEPLOY_QLC'] = get_input("3. QLC+ (Lighting)? (ja/nee)", default_qlc).lower() in ["ja", "yes", "j", "y", "true"]
    
    default_tuya = "ja" if last_config.get('DEPLOY_TUYA', True) else "nee"
    config['DEPLOY_TUYA'] = get_input("4. Tuya Control? (ja/nee)", default_tuya).lower() in ["ja", "yes", "j", "y", "true"]
    
    default_emulators = "ja" if last_config.get('DEPLOY_EMULATORS', False) else "nee"
    config['DEPLOY_EMULATORS'] = get_input("5. X32 & ATEM Emulators? (ja/nee)", default_emulators).lower() in ["ja", "yes", "j", "y", "true"]
    
    if not (config['DEPLOY_LIVESTREAM'] or config['DEPLOY_COMPANION'] or config['DEPLOY_QLC'] or config['DEPLOY_TUYA'] or config['DEPLOY_EMULATORS']):
        print("\n❌ Fout: Je moet ten minste één onderdeel selecteren om te deployen!")
        sys.exit(1)
        
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
        
        if time.time() - start_time > 3600:
            print("\nTimeout bereikt.")
            proc.terminate()
            break
            
    proc.wait()
    
    # Read any remaining data from the PTY
    try:
        while True:
            r, w, e = select.select([master], [], [], 0.1)
            if not r:
                break
            data = os.read(master, 2048).decode(errors='ignore')
            if not data:
                break
            print(data, end="")
    except:
        pass

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
    tar_cmd = ["tar", "--format=ustar", "--no-xattrs", "--exclude", "._*", "--exclude", ".DS_Store", "--exclude", "node_modules", "--exclude", ".next", "--exclude", "data", "--exclude", "companion-data", "--exclude", "config/qlcplus/config", "--exclude", ".git", "--exclude", "deploy.tar.gz", "-czf", config['LOCAL_TEMP_ARCHIVE'], "-C", config['LOCAL_APP_PATH'], "."]
    env = os.environ.copy()
    env["COPYFILE_DISABLE"] = "1"
    subprocess.check_call(tar_cmd, env=env)

    # 3. NAS MAP VOORBEREIDEN
    ssh_p = f"ssh -S {global_ssh_mux_socket}"
    # We maken zowel de app-map, de data-map, companion-data als de Media-map aan
    freeshow_path = "/volume1/Beamer/FreeShow"
    prep_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {config['REMOTE_APP_PATH']}/companion-data && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Media && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Shows && echo '{config['NAS_PASS']}' | sudo -S mkdir -p {freeshow_path}/Config && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {config['REMOTE_APP_PATH']} && echo '{config['NAS_PASS']}' | sudo -S chmod -R 777 {freeshow_path}\""
    run_with_pty(prep_cmd, "Mappen checken en aanmaken op de NAS", config['NAS_PASS'], global_ssh_mux_socket)

    # Remote SSH key genereren indien niet aanwezig om container crash te voorkomen
    key_path = f"{config['REMOTE_APP_PATH']}/data/id_ed25519"
    key_gen_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"if [ ! -f {key_path} ]; then echo 'SSH sleutel aanmaken op de NAS...'; ssh-keygen -t ed25519 -f {key_path} -N '' -q && echo '{config['NAS_PASS']}' | sudo -S chown 1001:1001 {key_path}* && echo '{config['NAS_PASS']}' | sudo -S chmod 600 {key_path} && echo '{config['NAS_PASS']}' | sudo -S chmod 644 {key_path}.pub; fi\""
    run_with_pty(key_gen_cmd, "SSH sleutel controleren/genereren op de NAS", config['NAS_PASS'], global_ssh_mux_socket)

    # 4. OVERZETTEN NAAR NAS
    inject_cmd = f"cat {config['LOCAL_TEMP_ARCHIVE']} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {config['REMOTE_TEMP_ARCHIVE']}\""
    subprocess.check_call(inject_cmd, shell=True)
    print("✓ Project succesvol overgebracht naar de NAS.")

    # 4.1 FALLBACK TEMPLATE OVERZETTEN NAAR NAS
    print(">>> Lokaal: Fallback template.project overbrengen naar de NAS...")
    local_template = os.path.join(config['LOCAL_APP_PATH'], "data", "template.project")
    remote_template = f"{config['REMOTE_APP_PATH']}/data/template.project"
    send_template_cmd = f"cat {local_template} | {ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"cat > {remote_template}\""
    subprocess.check_call(send_template_cmd, shell=True)
    print("✓ Fallback template.project succesvol overgebracht naar de NAS.")

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

    services_list = []
    if config.get('DEPLOY_LIVESTREAM'):
        services_list.append("livestream-manager")
    if config.get('DEPLOY_COMPANION'):
        services_list.append("companion")
    if config.get('DEPLOY_QLC'):
        services_list.append("qlcplus")
    if config.get('DEPLOY_TUYA'):
        services_list.append("tuya-control")
    if config.get('DEPLOY_EMULATORS'):
        services_list.append("x32-emulator")
        services_list.append("atem-emulator")
        
    services_to_deploy = " ".join(services_list)
    cleanup_emulators = "" if config.get('DEPLOY_EMULATORS') else "(docker stop x32-emulator atem-emulator 2>/dev/null || true) && (docker rm -f x32-emulator atem-emulator 2>/dev/null || true) && "
    deploy_cmd = (
        f"export {D_PATH} && "
        f"echo '{config['NAS_PASS']}' | sudo -S env {D_PATH} sh -x -c '"
        f"cd {config['REMOTE_APP_PATH']} && "
        f"echo \"[DEBUG NAS] Start deployment script in $(pwd)\" && "
        f"tar -v -xzf {config['REMOTE_TEMP_ARCHIVE']} -C {config['REMOTE_APP_PATH']} && "
        f"echo \"[DEBUG NAS] Tar gelukt\" && "
        f"rm -f {config['REMOTE_TEMP_ARCHIVE']} && "
        f"sed -i \\\"s|/mnt/data/Projects/Beamer/FreeShow|/volume1/Beamer/FreeShow|g\\\" docker-compose.yml && "
        f"echo \"[DEBUG NAS] Sed gelukt\" && "
        f"chown -R {config['NAS_USER']}:users {config['REMOTE_APP_PATH']} && "
        f"chmod -R 777 {config['REMOTE_APP_PATH']} && "
        f"echo \"[DEBUG NAS] Permissies gelukt\" && "
        f"(pkill -f '[t]uya_http_server.py' || true) && "
        f"echo \"[DEBUG NAS] Oude Tuya server gestopt\" && "
        f"{cleanup_emulators}"
        f"(env COMPOSE_PARALLEL_LIMIT=1 SSH_KEY_DIR={user_home}/.ssh docker compose up -d --build {services_to_deploy} || env COMPOSE_PARALLEL_LIMIT=1 SSH_KEY_DIR={user_home}/.ssh docker-compose up -d --build {services_to_deploy}) && "
        f"echo \"[DEBUG NAS] Docker compose gelukt\" && "
        f"docker image prune -f"
        f" 2>&1'"
    )
    
    final_cmd = f"{ssh_p} {config['NAS_USER']}@{config['NAS_IP']} \"{deploy_cmd}\""
    print(f"\n[DEBUG] Running command:\n{final_cmd}\n")
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
