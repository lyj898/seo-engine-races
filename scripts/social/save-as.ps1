# Completes the Windows "Save As" dialog a browser opens for a download (for
# example Gemini's "Download video", which asks where to save), so a clip can be
# saved while driving the browser remotely.
#
#   powershell -File scripts/social/save-as.ps1 -Path "G:\My Drive\runsea-social\gemini\clip.mp4"
#
# Click the page's download button first; this waits up to -Wait seconds for the
# dialog, types the full path into its File name box and presses Save.
param([Parameter(Mandatory = $true)][string]$Path, [int]$Wait = 20)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SaveAsW32 {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
}
'@
$A = [System.Windows.Automation.AutomationElement]; $T = [System.Windows.Automation.TreeScope]; $all = [System.Windows.Automation.Condition]::TrueCondition
$browsers = 'brave', 'chrome', 'msedge'

New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
$dlg = $null
for ($i = 0; $i -lt $Wait -and -not $dlg; $i++) {
  foreach ($w in $A::RootElement.FindAll($T::Children, $all)) {
    $proc = (Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName
    if ($browsers -notcontains $proc) { continue }
    # The dialog is a child window of the browser; its title is "wants to save" or "Save As".
    $d = $w.FindAll($T::Children, $all) | Where-Object { $_.Current.ClassName -eq '#32770' -or $_.Current.Name -match 'wants to save|Save As' }
    if ($d) { $dlg = @($d)[0]; break }
  }
  if (-not $dlg) { Start-Sleep -Seconds 1 }
}
if (-not $dlg) { Write-Error 'No Save As dialog found'; exit 1 }

$items = $dlg.FindAll($T::Descendants, $all)
$edit = $items | Where-Object { $_.Current.ClassName -eq 'Edit' -and $_.Current.AutomationId -eq '1001' } | Select-Object -First 1
$save = $items | Where-Object { $_.Current.ClassName -eq 'Button' -and $_.Current.Name -eq 'Save' } | Select-Object -First 1
# The dialog's controls are plain Win32 windows: WM_SETTEXT the name, BM_CLICK Save.
[SaveAsW32]::SendMessage([IntPtr]$edit.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $Path) | Out-Null
[SaveAsW32]::SendMessage([IntPtr]$save.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null

for ($i = 0; $i -lt 60; $i++) {
  if ((Test-Path $Path) -and (Get-Item $Path).Length -gt 0) { "saved $Path ($((Get-Item $Path).Length) bytes)"; exit 0 }
  Start-Sleep -Seconds 1
}
Write-Error "Save pressed but $Path did not appear"; exit 1
