import subprocess

from pydantic import BaseModel

# No vision model is available (checked: this Groq account only has
# text/audio models, no llama-vision/scout/maverick) — so "seeing the
# screen" means reading real text content via Windows UI Automation, the
# same technique already proven working for verifying Notepad's content
# earlier, walked across the whole focused window instead of one control.
# Shelling out to PowerShell's System.Windows.Automation costs nothing new
# to bundle (PowerShell ships with Windows) versus adding OCR (needs the
# Tesseract binary, heavy to bundle into a portable exe) or a COM wrapper
# library just for this one feature.
_UIA_SCRIPT = r"""
param([long]$Hwnd)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
if (-not $root) { exit }
$walker = [System.Windows.Automation.TreeWalker]::ContentViewWalker
$script:visited = 0
$script:seen = New-Object 'System.Collections.Generic.HashSet[string]'
function Collect($el, $depth) {
    if ($depth -gt 40 -or $script:visited -gt 600) { return }
    $script:visited++
    try {
        $name = $el.Current.Name
        if ($name -and $name.Trim().Length -gt 1 -and $script:seen.Add($name)) { Write-Output $name }
    } catch {}
    try {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $val = $vp.Current.Value
        if ($val -and $val.Trim().Length -gt 1 -and $script:seen.Add($val)) { Write-Output $val }
    } catch {}
    $child = $walker.GetFirstChild($el)
    while ($child) {
        Collect $child ($depth + 1)
        $child = $walker.GetNextSibling($child)
    }
}
Collect $root 0
"""

MAX_SCREEN_TEXT_CHARS = 6000


class ReadScreenTextArgs(BaseModel):
    pass


def read_screen_text(_: ReadScreenTextArgs) -> dict:
    """Real text content of whatever window currently has focus — not a
    picture of the screen (no vision model available), but the actual
    visible text pulled via Windows accessibility, so NOVA can know what
    you're looking at/writing without you having to describe it."""
    try:
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
    except Exception:
        return {"status": "error", "message": "Couldn't identify the focused window."}
    if not hwnd:
        return {"status": "error", "message": "No focused window found."}

    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _UIA_SCRIPT, "-Hwnd", str(hwnd)],
            capture_output=True,
            text=True,
            timeout=8,
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Reading the screen took too long — try again."}

    text = "\n".join(line.strip() for line in result.stdout.splitlines() if line.strip())
    if not text:
        return {
            "status": "error",
            "message": "Couldn't read any text from the focused window — it may not expose "
            "accessible text (common for browsers/games/images).",
        }
    return {"status": "ok", "content": text[:MAX_SCREEN_TEXT_CHARS]}
