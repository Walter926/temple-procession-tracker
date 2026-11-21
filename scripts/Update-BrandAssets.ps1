param(
  [Parameter(Mandatory = $true)][string]$SourceDocument
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$brandDirectory = Join-Path $projectRoot 'assets/branding'
[void][System.IO.Directory]::CreateDirectory($brandDirectory)
$sourceImage = Join-Path $brandDirectory 'temple-icon.png'
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SourceDocument).Path)
try {
  $imageEntry = $archive.GetEntry('word/media/image1.png')
  if ($null -eq $imageEntry) { throw 'The document does not contain word/media/image1.png.' }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($imageEntry, $sourceImage, $true)
} finally { $archive.Dispose() }

$source = [System.Drawing.Image]::FromFile($sourceImage)
try {
  $targets = @{
    'admin_dashboard/public/favicon.png' = 64
    'admin_dashboard/public/temple-icon.png' = 256
    'mobile_app/temple_procession_tracker_app/web/favicon.png' = 32
    'mobile_app/temple_procession_tracker_app/web/icons/Icon-192.png' = 192
    'mobile_app/temple_procession_tracker_app/web/icons/Icon-512.png' = 512
    'mobile_app/temple_procession_tracker_app/web/icons/Icon-maskable-192.png' = 192
    'mobile_app/temple_procession_tracker_app/web/icons/Icon-maskable-512.png' = 512
  }
  $densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
  foreach ($density in $densities.Keys) {
    $targets["mobile_app/temple_procession_tracker_app/android/app/src/main/res/mipmap-$density/ic_launcher.png"] = $densities[$density]
  }
  foreach ($relativePath in $targets.Keys) {
    $targetPath = Join-Path $projectRoot $relativePath
    [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $targetPath))
    $size = $targets[$relativePath]
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, $size, $size)
      $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    Write-Output "$relativePath ($size x $size)"
  }
} finally { $source.Dispose() }
