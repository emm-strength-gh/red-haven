Add-Type -AssemblyName System.Drawing

# Kaboom Critters app icons: a round orange critter holding a lit bomb on a purple sky.
$destination = Join-Path $PSScriptRoot '..\public'
function New-Color($r, $g, $b) { [System.Drawing.Color]::FromArgb($r, $g, $b) }

foreach ($size in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.ScaleTransform($size / 512.0, $size / 512.0)

    $sky = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::new(0, 512), (New-Color 74 42 168), (New-Color 255 92 170))
    $g.FillRectangle($sky, 0, 0, 512, 512)

    $island = [System.Drawing.SolidBrush]::new((New-Color 63 207 90))
    $soil = [System.Drawing.SolidBrush]::new((New-Color 154 92 52))
    $g.FillEllipse($soil, 40, 360, 432, 220)
    $g.FillEllipse($island, 40, 352, 432, 70)

    $body = [System.Drawing.SolidBrush]::new((New-Color 255 138 31))
    $belly = [System.Drawing.SolidBrush]::new((New-Color 255 214 150))
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $ink = [System.Drawing.SolidBrush]::new((New-Color 27 18 53))
    $cheek = [System.Drawing.SolidBrush]::new((New-Color 255 110 150))
    $g.FillEllipse($body, 116, 150, 230, 230)
    $g.FillEllipse($belly, 166, 260, 130, 110)
    $g.FillEllipse($white, 160, 196, 62, 70)
    $g.FillEllipse($white, 236, 196, 62, 70)
    $g.FillEllipse($ink, 184, 216, 30, 36)
    $g.FillEllipse($ink, 258, 216, 30, 36)
    $g.FillEllipse($white, 192, 220, 10, 10)
    $g.FillEllipse($white, 266, 220, 10, 10)
    $g.FillEllipse($cheek, 146, 268, 34, 20)
    $g.FillEllipse($cheek, 284, 268, 34, 20)
    $g.FillPie($ink, 205, 262, 56, 44, 0, 180)

    $bomb = [System.Drawing.SolidBrush]::new((New-Color 40 30 70))
    $shine = [System.Drawing.SolidBrush]::new((New-Color 120 100 190))
    $g.FillEllipse($bomb, 318, 236, 120, 120)
    $g.FillEllipse($shine, 342, 256, 30, 24)
    $g.FillRectangle($bomb, 362, 218, 34, 26)
    $fuse = [System.Drawing.Pen]::new((New-Color 255 214 150), 9)
    $g.DrawBezier($fuse, 380, 220, 386, 190, 410, 186, 418, 162)
    $spark = [System.Drawing.SolidBrush]::new((New-Color 255 210 58))
    $points = @()
    for ($i = 0; $i -lt 16; $i++) {
        $a = $i * [Math]::PI / 8
        $r = if ($i % 2 -eq 0) { 40 } else { 16 }
        $points += [System.Drawing.PointF]::new(420 + $r * [Math]::Cos($a), 152 + $r * [Math]::Sin($a))
    }
    $g.FillPolygon($spark, [System.Drawing.PointF[]]$points)

    $g.Dispose()
    $bitmap.Save((Join-Path $destination "critters-icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    foreach ($o in @($sky, $island, $soil, $body, $belly, $white, $ink, $cheek, $bomb, $shine, $fuse, $spark)) { $o.Dispose() }
}
