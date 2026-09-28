param([string]$Start = '')
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 writes the OEM code page by default; Vietnamese folder names need UTF-8.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
# The modern "Select folder" dialog (IFileOpenDialog). WinForms FolderBrowserDialog on .NET Framework is the old tree box.
# GUIDs and member order must match the COM vtable; members after GetResult are omitted on purpose.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCo {}
[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem parent);
  void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
}
[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr owner);
  void SetFileTypes(uint c, IntPtr specs); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
  void Advise(IntPtr sink, out uint cookie); void Unadvise(uint cookie);
  void SetOptions(uint fos); void GetOptions(out uint fos);
  void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si);
  void GetFolder(out IShellItem si); void GetCurrentSelection(out IShellItem si);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n); void GetFileName(out IntPtr n);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
  void GetResult(out IShellItem si);
}
public static class FolderPicker {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);
  public static string Pick(string start, IntPtr owner) {
    var d = (IFileDialog)new FileOpenDialogCo();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
    if (!string.IsNullOrEmpty(start) && System.IO.Directory.Exists(start)) {
      IShellItem f; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out f); d.SetFolder(f);
    }
    int hr = d.Show(owner);
    if (hr == unchecked((int)0x800704C7)) return null; // ERROR_CANCELLED
    Marshal.ThrowExceptionForHR(hr);
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p; // SIGDN_FILESYSPATH
  }
}
'@
# A hidden process's first ShowWindow gets SW_HIDE (what hid Explorer). This invisible top-most owner absorbs it,
# and the dialog it owns opens above the browser.
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0; StartPosition = 'CenterScreen'; Width = 1; Height = 1 }
$owner.Show()
try { $path = [FolderPicker]::Pick($Start, $owner.Handle) } finally { $owner.Close() }
if ($path) { [Console]::Out.Write($path) }
