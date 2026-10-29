Add-Type -AssemblyName System.Drawing

$destination = Join-Path $PSScriptRoot '..\public'
foreach ($size in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $scale = $size / 512.0
    $graphics.ScaleTransform($scale, $scale)

    $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 51, 60))
    $planet = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(226, 120, 76))
    $planetShade = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(190, 87, 63))
    $habitat = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 229, 176))
    $window = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(65, 192, 186))
    $graphics.FillRectangle($background, 0, 0, 512, 512)
    $graphics.FillEllipse($planet, 72, 72, 368, 368)
    $graphics.FillEllipse($planetShade, 98, 190, 315, 220)
    $graphics.FillPolygon($habitat, [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new(128, 319),
        [System.Drawing.Point]::new(256, 142),
        [System.Drawing.Point]::new(384, 319),
        [System.Drawing.Point]::new(256, 380)
    ))
    $graphics.FillEllipse($window, 215, 268, 82, 82)
    $graphics.Dispose()
    $bitmap.Save((Join-Path $destination "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    foreach ($brush in @($background, $planet, $planetShade, $habitat, $window)) { $brush.Dispose() }
}
