Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$rentalCanvas = New-Object System.Drawing.Bitmap(2500, 843)
$rentalGraphics = [System.Drawing.Graphics]::FromImage($rentalCanvas)
$rentalGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$rentalGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$rentalDark = [System.Drawing.ColorTranslator]::FromHtml('#123E36')
$rentalGreen = [System.Drawing.ColorTranslator]::FromHtml('#16875C')
$rentalMint = [System.Drawing.ColorTranslator]::FromHtml('#EAF5EC')
$rentalWhite = [System.Drawing.Color]::White
$rentalGraphics.Clear($rentalMint)
$rentalBrushDark = New-Object System.Drawing.SolidBrush($rentalDark)
$rentalBrushGreen = New-Object System.Drawing.SolidBrush($rentalGreen)
$rentalBrushWhite = New-Object System.Drawing.SolidBrush($rentalWhite)
$rentalGraphics.FillRectangle($rentalBrushDark, 0, 0, 1250, 843)
$rentalFontBrand = New-Object System.Drawing.Font('Yu Gothic', 35, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$rentalFontMain = New-Object System.Drawing.Font('Yu Gothic', 80, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$rentalFontSub = New-Object System.Drawing.Font('Yu Gothic', 39, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$rentalFormat = New-Object System.Drawing.StringFormat
$rentalFormat.Alignment = [System.Drawing.StringAlignment]::Center
$rentalGraphics.DrawString('賃貸の神', $rentalFontBrand, $rentalBrushWhite, [System.Drawing.RectangleF]::new(0, 65, 1250, 60), $rentalFormat)
$rentalGraphics.DrawString('賃貸の神', $rentalFontBrand, $rentalBrushDark, [System.Drawing.RectangleF]::new(1250, 65, 1250, 60), $rentalFormat)

# Left: house outline with a plus symbol.
$rentalPenWhite = New-Object System.Drawing.Pen($rentalWhite, 13)
$rentalPenGreen = New-Object System.Drawing.Pen($rentalGreen, 13)
foreach ($rentalPen in @($rentalPenWhite, $rentalPenGreen)) {
  $rentalPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $rentalPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $rentalPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
}
$rentalGraphics.DrawLines($rentalPenWhite, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(505, 290), [System.Drawing.PointF]::new(625, 185), [System.Drawing.PointF]::new(745, 290)))
$rentalGraphics.DrawLines($rentalPenWhite, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(530, 280), [System.Drawing.PointF]::new(530, 390),
  [System.Drawing.PointF]::new(720, 390), [System.Drawing.PointF]::new(720, 280)))
$rentalGraphics.DrawLine($rentalPenWhite, 625, 286, 625, 352)
$rentalGraphics.DrawLine($rentalPenWhite, 592, 319, 658, 319)
# Right: stacked estimate sheets.
$rentalGraphics.DrawRectangle($rentalPenGreen, 1778, 205, 172, 195)
$rentalGraphics.DrawRectangle($rentalPenGreen, 1803, 180, 172, 195)
$rentalGraphics.FillRectangle([System.Drawing.SolidBrush]::new($rentalMint), 1811, 188, 156, 179)
foreach ($rentalY in @(240, 280, 320)) { $rentalGraphics.DrawLine($rentalPenGreen, 1840, $rentalY, 1938, $rentalY) }
$rentalGraphics.DrawString('見積を依頼する', $rentalFontMain, $rentalBrushWhite, [System.Drawing.RectangleF]::new(0, 458, 1250, 125), $rentalFormat)
$rentalGraphics.DrawString('物件URLからかんたん依頼', $rentalFontSub, $rentalBrushWhite, [System.Drawing.RectangleF]::new(0, 603, 1250, 80), $rentalFormat)
$rentalGraphics.DrawString('概算見積を見る', $rentalFontMain, $rentalBrushDark, [System.Drawing.RectangleF]::new(1250, 458, 1250, 125), $rentalFormat)
$rentalGraphics.DrawString('届いた見積をまとめて確認', $rentalFontSub, $rentalBrushGreen, [System.Drawing.RectangleF]::new(1250, 603, 1250, 80), $rentalFormat)
foreach ($rentalX in @(625, 1875)) {
  $rentalArrowPen = if ($rentalX -eq 625) { $rentalPenWhite } else { $rentalPenGreen }
  $rentalGraphics.DrawLine($rentalArrowPen, ($rentalX - 35), 740, ($rentalX + 35), 740)
  $rentalGraphics.DrawLine($rentalArrowPen, ($rentalX + 13), 718, ($rentalX + 35), 740)
  $rentalGraphics.DrawLine($rentalArrowPen, ($rentalX + 13), 762, ($rentalX + 35), 740)
}
$rentalOutput = Join-Path $PSScriptRoot 'rental-rich-menu.png'
$rentalCanvas.Save($rentalOutput, [System.Drawing.Imaging.ImageFormat]::Png)
$rentalGraphics.Dispose()
$rentalCanvas.Dispose()
Write-Output $rentalOutput
