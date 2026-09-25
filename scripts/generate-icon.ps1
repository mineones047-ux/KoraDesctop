# Generates build-assets/icon.ico (multi-size, PNG-compressed) and icon.png
# for the Kora app icon (ROADMAP Phase 0: "app icon").
# Pure PowerShell + System.Drawing - no external tools required. Re-run with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-icon.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'build-assets'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-KoraBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, [int]($size * 0.02))
  $inner = $size - 2 * $pad
  $radius = [int]($size * 0.22)
  $d = $radius * 2
  $right = $pad + $inner
  $bottom = $pad + $inner
  $rect = New-Object System.Drawing.Rectangle($pad, $pad, $inner, $inner)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($right - $d, $bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $plate = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 12, 12, 14))
  $g.FillPath($plate, $path)
  $accent = [System.Drawing.Color]::FromArgb(255, 224, 80, 66)
  $penWidth = [Math]::Max(1.0, [float]($size * 0.035))
  $pen = New-Object System.Drawing.Pen($accent, $penWidth)
  $g.DrawPath($pen, $path)

  $fontSize = [float]($size * 0.58)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textBrush = New-Object System.Drawing.SolidBrush($accent)
  $textRect = New-Object System.Drawing.RectangleF(0, 0, [float]$size, [float]($size * 0.98))
  $g.DrawString('K', $font, $textBrush, $textRect, $fmt)

  $g.Dispose()
  return $bmp
}

function ConvertTo-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @{}
foreach ($s in $sizes) {
  $bmp = New-KoraBitmap $s
  $pngs[$s] = ConvertTo-PngBytes $bmp
  if ($s -eq 256) { $bmp.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
  $data = $pngs[$s]
  if ($s -ge 256) { $dim = 0 } else { $dim = $s }
  $writer.Write([Byte]$dim)
  $writer.Write([Byte]$dim)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$data.Length)
  $writer.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($s in $sizes) { $writer.Write($pngs[$s]) }
$writer.Flush()

$icoPath = Join-Path $outDir 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $stream.ToArray())
$writer.Dispose(); $stream.Dispose()

Write-Host "icon.ico: $((Get-Item $icoPath).Length) bytes ($($sizes -join ', ') px)"
Write-Host "icon.png: $((Get-Item (Join-Path $outDir 'icon.png')).Length) bytes (256 px)"
