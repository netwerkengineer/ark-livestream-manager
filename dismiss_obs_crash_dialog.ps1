# Watches for OBS Studio's "OBS Studio crash gedetecteerd" dialog (shown
# after any unclean shutdown, e.g. a forced remote shutdown/reboot outside
# anyone's control) and clicks "Starten in normale modus" automatically.
#
# Left alone, this dialog blocks OBS from finishing startup at all - no
# scenes, no WebSocket server, nothing - until a human physically dismisses
# it. That's a real problem for an unattended/remote-tested setup where
# nobody is sitting at the machine to click it. "Starten in normale modus"
# (not "veilige modus") is the only correct choice: safe mode disables
# WebSockets, which this whole app's OBS integration depends on.
#
# OBS is a Qt application - its buttons are custom-painted, not native
# Win32 child windows, so plain EnumChildWindows/GetWindowText finds
# nothing. UI Automation (the accessibility framework screen readers use)
# is what actually sees into Qt's widget tree, so that's what this uses
# instead of raw Win32 messages.
#
# Matches on the dialog's window title and the target button's name - both
# are Dutch-locale strings from OBS's own UI, so this only works while the
# machine's OBS install stays on a Dutch locale. If OBS's dialog wording
# ever changes (a future OBS version), this silently stops matching and
# just times out doing nothing - it never clicks the wrong button.
#
# Must run inside the real interactive desktop session (not a plain SSH
# session, which Windows isolates into a non-interactive Session 0 that
# cannot see or click windows in the logged-on session) - triggered via
# the "DismissOBSCrashDialog" scheduled task, same pattern as "StartOBS".

param(
    [int]$TimeoutSeconds = 30,
    [int]$PollIntervalMs = 1000,
    [switch]$Diagnose
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Find-DialogElement($titleSubstring) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
    )
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    foreach ($w in $windows) {
        if ($w.Current.Name -like "*$titleSubstring*") {
            return $w
        }
    }
    return $null
}

$elapsed = 0
$dialog = $null
while ($elapsed -lt ($TimeoutSeconds * 1000)) {
    $dialog = Find-DialogElement "crash gedetecteerd"
    if ($dialog -ne $null) { break }
    Start-Sleep -Milliseconds $PollIntervalMs
    $elapsed += $PollIntervalMs
}

if ($dialog -eq $null) {
    Write-Output "No crash dialog appeared within timeout - OBS started normally."
    exit 0
}

$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
)
$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)

if ($Diagnose) {
    Write-Output "DIAGNOSE: Found dialog '$($dialog.Current.Name)'. Buttons:"
    foreach ($b in $buttons) {
        Write-Output "  Name='$($b.Current.Name)' AutomationId='$($b.Current.AutomationId)'"
    }
    exit 0
}

$target = $null
foreach ($b in $buttons) {
    if ($b.Current.Name -like "*Starten in normale modus*") {
        $target = $b
        break
    }
}

if ($target) {
    $invokePattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invokePattern.Invoke()
    Write-Output "DISMISSED: Invoked 'Starten in normale modus' via UI Automation."
    exit 0
} else {
    Write-Output "WARNING: Found crash dialog but not the expected button - leaving it alone."
    exit 1
}
