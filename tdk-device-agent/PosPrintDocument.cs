using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// Business-specific receipt composition lives in TDK-POS. Only validated
// printer-independent drawing commands are accepted here.
internal sealed class PosPrintDocument
{
    public List<PosPrintCommand> Commands { get; set; } = [];

    public string? Validate()
    {
        if (Commands is null || Commands.Count is < 1 or > 250 || Commands[^1]?.Type != "cut" ||
            Commands.Count(command => command?.Type == "cut") != 1)
            return "인쇄 문서의 명령 수 또는 용지 절단 위치가 올바르지 않습니다.";
        foreach (var command in Commands)
        {
            if (command is null) return "인쇄 명령이 비어 있습니다.";
            if (command.Type is "text" or "row")
            {
                if (command.Size is < 12 or > 48) return "인쇄 글자 크기가 올바르지 않습니다.";
                if (command.Type == "text" && (!ValidText(command.Value) || !ValidAlign(command.Align)))
                    return "인쇄 문구 또는 정렬이 올바르지 않습니다.";
                if (command.Type == "row")
                {
                    if (command.Cells is { Count: > 0 } cells)
                    {
                        if (cells.Count is < 2 or > 4 || cells.Sum(cell => cell?.Width ?? 0) != 100 ||
                            cells.Any(cell => cell is null || cell.Width is < 10 or > 80 || !ValidText(cell.Value) || !ValidAlign(cell.Align)))
                            return "인쇄 열 구성이 올바르지 않습니다.";
                    }
                    else if ((!ValidText(command.Left) && !ValidText(command.Right)) ||
                             (command.Left is not null && !ValidText(command.Left)) ||
                             (command.Right is not null && !ValidText(command.Right)))
                        return "인쇄 행의 내용이 올바르지 않습니다.";
                }
            }
            else if (command.Type == "logo")
            {
                var logo = command.Logo;
                if (logo is null || logo.Width is < 1 or > 480 || logo.Height is < 1 or > 120 ||
                    logo.PixelsBase64 is null || logo.PixelsBase64.Length > 100_000)
                    return "영수증 로고 정보가 올바르지 않습니다.";
                try { if (Convert.FromBase64String(logo.PixelsBase64).Length != logo.Width * logo.Height) return "영수증 로고 크기가 올바르지 않습니다."; }
                catch (FormatException) { return "영수증 로고 데이터가 올바르지 않습니다."; }
            }
            else if (command.Type == "feed")
            {
                if (command.Lines is null or < 0 or > 8 || !double.IsFinite(command.Lines.Value))
                    return "용지 여백이 올바르지 않습니다.";
            }
            else if (command.Type == "barcode")
            {
                if (!Regex.IsMatch(command.Value ?? "", @"\A[A-Z][A-Z0-9-]{2,31}\z")) return "바코드 값이 올바르지 않습니다.";
            }
            else if (command.Type is not ("line" or "cut")) return "지원하지 않는 인쇄 명령입니다.";
        }
        return null;
    }

    private static bool ValidText(string? value) => value is { Length: > 0 and <= 255 } &&
        !value.Any(char.IsControl);
    private static bool ValidAlign(string? align) => align is "left" or "center" or "right";
}

internal sealed class PosPrintCommand
{
    public string Type { get; set; } = "";
    public string? Value { get; set; }
    public bool? ShowHri { get; set; }
    public string? Align { get; set; }
    public int Size { get; set; } = 24;
    public bool Bold { get; set; }
    public string? Left { get; set; }
    public string? Right { get; set; }
    public List<PosPrintCell>? Cells { get; set; }
    public double? Lines { get; set; }
    public ReceiptLogo? Logo { get; set; }
}

internal sealed class PosPrintCell
{
    public string Value { get; set; } = "";
    public int Width { get; set; }
    public string Align { get; set; } = "left";
}

internal static partial class PrinterTest
{
    public static uint PrintDocument(string printerName, PosPrintDocument document)
    {
        if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("영수증 프린터는 Windows에서만 사용할 수 있습니다.");
        if (document.Validate() is { } error) throw new InvalidOperationException(error);
        return SendToWindowsPrinter(printerName, BuildDocumentCommand(document), "TDK POS print document");
    }

    private static byte[] BuildDocumentCommand(PosPrintDocument document)
    {
        var output = new List<byte> { 0x1b, 0x40 }; // ESC @
        var segment = new List<PosPrintCommand>();
        void Flush()
        {
            if (segment.Count == 0) return;
            var raster = RenderDocumentSegment(segment);
            if (raster.Length > 0)
            {
                var bytes = new byte[8 + raster.Length];
                WriteRasterCommand(bytes, 0, raster);
                output.AddRange(bytes);
            }
            segment.Clear();
        }
        foreach (var command in document.Commands)
        {
            if (command.Type is not ("barcode" or "cut")) { segment.Add(command); continue; }
            Flush();
            if (command.Type == "barcode")
            {
                // GS k 73 is Code 128. The initial {B selects Code Set B for ASCII lookup codes.
                var value = Encoding.ASCII.GetBytes("{B" + command.Value!);
                output.AddRange([0x1b, 0x61, 0x01, 0x1d, 0x48, command.ShowHri == false ? (byte)0x00 : (byte)0x02, 0x1d, 0x77, 0x02, 0x1d, 0x68, 0x60]);
                output.AddRange([0x1d, 0x6b, 0x49, (byte)value.Length]);
                output.AddRange(value);
                output.AddRange([0x0a, 0x1b, 0x61, 0x00]);
            }
            else output.AddRange([0x1d, 0x56, 0x01]);
        }
        return output.ToArray();
    }

    private static byte[] RenderDocumentSegment(List<PosPrintCommand> commands)
    {
        var height = Math.Min(12_000, 400 + commands.Count * 150 + commands.Sum(command => command.Value?.Length ?? 0) * 4);
        var dc = Native.CreateCompatibleDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) throw LastError("인쇄 이미지 컨텍스트 생성");
        IntPtr bitmap = IntPtr.Zero, oldBitmap = IntPtr.Zero, oldFont = IntPtr.Zero;
        var fonts = new Dictionary<(int Size, bool Bold), IntPtr>();
        try
        {
            var info = new BitmapInfo { Header = new BitmapInfoHeader {
                Size = (uint)Marshal.SizeOf<BitmapInfoHeader>(), Width = Width, Height = -height,
                Planes = 1, BitCount = 32, Compression = 0, SizeImage = Width * height * 4
            } };
            bitmap = Native.CreateDIBSection(dc, ref info, 0, out var pixels, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || pixels == IntPtr.Zero) throw LastError("인쇄 이미지 생성");
            oldBitmap = Native.SelectObject(dc, bitmap);
            if (oldBitmap == IntPtr.Zero) throw LastError("인쇄 이미지 선택");
            var image = new byte[Width * height * 4];
            Array.Fill(image, (byte)255);
            Marshal.Copy(image, 0, pixels, image.Length);
            Native.SetBkMode(dc, 1);
            Native.SetTextColor(dc, 0);
            void SelectFont(int size, bool bold)
            {
                var key = (size, bold);
                if (!fonts.TryGetValue(key, out var font))
                {
                    font = CreateFont(size, bold ? 700 : 500);
                    fonts.Add(key, font);
                }
                var previous = Native.SelectObject(dc, font);
                if (oldFont == IntPtr.Zero) oldFont = previous;
            }
            var logos = new List<(ReceiptLogo Logo, int Y)>();
            var y = 0;
            foreach (var command in commands)
            {
                if (command.Type == "logo")
                {
                    logos.Add((command.Logo!, y));
                    y += command.Logo!.Height;
                }
                else if (command.Type == "feed") y += (int)Math.Round(command.Lines!.Value * 28);
                else if (command.Type == "line")
                {
                    SelectFont(24, false);
                    y = DrawSeparator(dc, y);
                }
                else if (command.Type == "text")
                {
                    SelectFont(command.Size, command.Bold);
                    y = DrawDocumentText(dc, y, command.Value!, command.Align!, Left, Right - Left, command.Size + 8);
                }
                else if (command.Type == "row")
                {
                    SelectFont(command.Size, command.Bold);
                    y = DrawDocumentRow(dc, y, command);
                }
                if (y + 12 > height) throw new InvalidOperationException("인쇄 문서가 용지 길이 제한을 초과했습니다.");
            }
            if (!Native.GdiFlush()) throw LastError("인쇄 이미지 완성");
            Marshal.Copy(pixels, image, 0, image.Length);
            foreach (var (logo, top) in logos)
            {
                var grey = Convert.FromBase64String(logo.PixelsBase64);
                var left = (Width - logo.Width) / 2;
                for (var row = 0; row < logo.Height; row++)
                for (var x = 0; x < logo.Width; x++)
                {
                    var pixel = ((top + row) * Width + left + x) * 4;
                    image[pixel] = image[pixel + 1] = image[pixel + 2] = grey[row * logo.Width + x];
                }
            }
            var outputHeight = y + 12;
            var raster = new byte[BytesPerRow * outputHeight];
            for (var row = 0; row < outputHeight; row++)
            for (var x = 0; x < Width; x++)
            {
                var pixel = (row * Width + x) * 4;
                if (image[pixel] < 128 && image[pixel + 1] < 128 && image[pixel + 2] < 128)
                    raster[row * BytesPerRow + x / 8] |= (byte)(0x80 >> (x % 8));
            }
            return raster;
        }
        finally
        {
            if (oldFont != IntPtr.Zero) Native.SelectObject(dc, oldFont);
            foreach (var font in fonts.Values) Native.DeleteObject(font);
            if (oldBitmap != IntPtr.Zero) Native.SelectObject(dc, oldBitmap);
            if (bitmap != IntPtr.Zero) Native.DeleteObject(bitmap);
            Native.DeleteDC(dc);
        }
    }

    private static int DrawDocumentRow(IntPtr dc, int y, PosPrintCommand command)
    {
        var lineHeight = command.Size + 8;
        if (command.Cells is { Count: > 0 } cells)
        {
            var x = Left;
            var bottom = y + lineHeight;
            foreach (var cell in cells)
            {
                var width = (Right - Left) * cell.Width / 100;
                bottom = Math.Max(bottom, DrawDocumentText(dc, y, cell.Value, cell.Align, x, width, lineHeight));
                x += width;
            }
            return bottom;
        }
        var left = command.Left ?? "";
        var right = command.Right ?? "";
        var rightWidth = TextWidth(dc, right);
        var labelWidth = Right - Left - rightWidth - 16;
        if ((labelWidth < 100 || TextWidth(dc, left) > labelWidth) && command.Size > 24)
        {
            var smaller = CreateFont(command.Size - 2, command.Bold ? 700 : 500);
            var previous = Native.SelectObject(dc, smaller);
            try { return DrawDocumentRow(dc, y, new PosPrintCommand { Type = "row", Left = left, Right = right, Size = command.Size - 2, Bold = command.Bold }); }
            finally { Native.SelectObject(dc, previous); Native.DeleteObject(smaller); }
        }
        if (labelWidth < 40)
        {
            var afterLeft = DrawDocumentText(dc, y, left, "left", Left, Right - Left, lineHeight);
            return DrawDocumentText(dc, afterLeft, right, "right", Left, Right - Left, lineHeight);
        }
        var bottomLeft = DrawDocumentText(dc, y, left, "left", Left, labelWidth, lineHeight);
        var bottomRight = DrawDocumentText(dc, y, right, "right", Right - rightWidth, rightWidth, lineHeight);
        return Math.Max(bottomLeft, bottomRight);
    }

    private static int DrawDocumentText(IntPtr dc, int y, string value, string align, int x, int width, int lineHeight)
    {
        if (value.Length == 0) return y + lineHeight;
        var line = new StringBuilder();
        void DrawLine()
        {
            var valueToDraw = line.ToString();
            if (align == "center") Draw(dc, x + width / 2, y, valueToDraw, true);
            else if (align == "right") DrawRight(dc, x + width, y, valueToDraw);
            else Draw(dc, x, y, valueToDraw, false);
            y += lineHeight;
            line.Clear();
        }
        foreach (var rune in value.EnumerateRunes())
        {
            var candidate = line.ToString() + rune;
            if (line.Length > 0 && TextWidth(dc, candidate) > width) DrawLine();
            line.Append(rune.ToString());
        }
        if (line.Length > 0) DrawLine();
        return y;
    }
}
