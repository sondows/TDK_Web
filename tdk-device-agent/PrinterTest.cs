using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

internal static class PrinterTest
{
    // SRP-350III: 80 mm paper, 72 mm printable area at 180 dpi (7 dots/mm).
    private const int Width = 504;
    private const int BytesPerRow = Width / 8;
    private const int Left = 8;
    private const int Right = Width - Left;
    private const int AmountRight = Width - 16;
    private const int NameWidth = 216;
    private const int UnitRight = 312;
    private const int QuantityRight = 380;
    private const int ReceiptFontSize = 24;

    public static uint Print(string printerName) => PrintCore(printerName, new SaleReceipt
    {
        CheckoutId = 1,
        StoreInfo = new() { StoreName = "PRINT TEST", Address = "PRINT TEST", Phone = "0", BusinessNumber = "TEST" },
        ReceiptNumber = "TEST-0001",
        TableLabel = "3T",
        OrderedAt = "2026-09-26 15:32",
        Items =
        [
            new() { ItemName = "흑돼지김치찌개", UnitPrice = 10_000, Qty = 2, Amount = 20_000 },
            new() { ItemName = "계란말이", UnitPrice = 4_000, Qty = 1, Amount = 4_000 },
            new() { ItemName = "소주", UnitPrice = 5_000, Qty = 1, Amount = 5_000 }
        ],
        SubtotalAmount = 29_000,
        DiscountAmount = 2_000,
        TotalAmount = 27_000,
        Payments =
        [
            new() { Method = "카드", Amount = 20_000 },
            new() { Method = "현금", Amount = 7_000 }
        ]
    });

    public static uint Print(string printerName, SaleReceipt receipt) => PrintCore(printerName, receipt);

    private static uint PrintCore(string printerName, SaleReceipt receipt)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("이 프린터 테스트는 Windows에서만 사용할 수 있습니다.");

        var raster = RenderReceipt(receipt);
        var command = BuildPrintCommand(raster);
        return SendToWindowsPrinter(printerName, command, $"TDK POS receipt {receipt.CheckoutId}");
    }

    private static byte[] BuildPrintCommand(byte[] receiptRaster)
    {
        var cutOffset = 2 + 8 + receiptRaster.Length;
        var command = new byte[cutOffset + 4 + 3];
        command[0] = 0x1b; // ESC @: initialize printer state.
        command[1] = 0x40;
        WriteRasterCommand(command, 2, receiptRaster);
        // One LF after the last payment, then the existing three feeds before GS V 1.
        command[cutOffset] = 0x0a;
        command[cutOffset + 1] = 0x0a;
        command[cutOffset + 2] = 0x0a;
        command[cutOffset + 3] = 0x0a;
        command[cutOffset + 4] = 0x1d;
        command[cutOffset + 5] = 0x56;
        command[cutOffset + 6] = 0x01;
        return command;
    }

    private static void WriteRasterCommand(byte[] command, int offset, byte[] raster)
    {
        var height = raster.Length / BytesPerRow;
        command[offset] = 0x1d; // GS v 0: monochrome raster at normal scale.
        command[offset + 1] = 0x76;
        command[offset + 2] = 0x30;
        command[offset + 3] = 0;
        command[offset + 4] = (byte)BytesPerRow;
        command[offset + 6] = (byte)(height & 0xff);
        command[offset + 7] = (byte)(height >> 8);
        Buffer.BlockCopy(raster, 0, command, offset + 8, raster.Length);
    }

    private static byte[] RenderReceipt(SaleReceipt receipt)
    {
        var height = Math.Min(12_000, 700 + receipt.Items.Count * 150 + receipt.Payments.Count * 100 + receipt.StoreInfo!.StoreName.Length * 30);
        var dc = Native.CreateCompatibleDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) throw LastError("인쇄 이미지 컨텍스트 생성");

        IntPtr bitmap = IntPtr.Zero;
        IntPtr oldBitmap = IntPtr.Zero;
        IntPtr bodyFont = IntPtr.Zero;
        IntPtr emphasisFont = IntPtr.Zero;
        IntPtr oldFont = IntPtr.Zero;

        try
        {
            var info = new BitmapInfo
            {
                Header = new BitmapInfoHeader
                {
                    Size = (uint)Marshal.SizeOf<BitmapInfoHeader>(),
                    Width = Width,
                    Height = -height, // top-down image
                    Planes = 1,
                    BitCount = 32,
                    Compression = 0,
                    SizeImage = Width * height * 4
                }
            };
            bitmap = Native.CreateDIBSection(dc, ref info, 0, out var pixels, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || pixels == IntPtr.Zero)
                throw LastError("인쇄 이미지 생성");

            oldBitmap = Native.SelectObject(dc, bitmap);
            if (oldBitmap == IntPtr.Zero) throw LastError("인쇄 이미지 선택");

            // White paper, black text. Unicode GDI rendering avoids printer code-page issues.
            var image = new byte[Width * height * 4];
            Array.Fill(image, (byte)255);
            var hasLogo = TryDrawLogo(receipt.ReceiptLogo, image, out var logoHeight);
            Marshal.Copy(image, 0, pixels, image.Length);

            bodyFont = CreateFont(ReceiptFontSize, 500);
            emphasisFont = CreateFont(ReceiptFontSize, 700);
            oldFont = Native.SelectObject(dc, bodyFont);
            if (oldFont == IntPtr.Zero) throw LastError("한글 글꼴 선택");

            Native.SetBkMode(dc, 1); // TRANSPARENT
            Native.SetTextColor(dc, 0); // black

            // Keep the existing clear strip below the last payment row.
            var outputHeight = DrawSaleReceipt(dc, receipt, bodyFont, emphasisFont, hasLogo ? logoHeight : null) + 12;
            if (outputHeight > height)
                throw new InvalidOperationException("영수증 내용이 인쇄 가능한 길이를 초과했습니다.");

            if (!Native.GdiFlush()) throw LastError("영수증 이미지 완성");
            Marshal.Copy(pixels, image, 0, image.Length);
            var raster = new byte[BytesPerRow * outputHeight];
            for (var y = 0; y < outputHeight; y++)
            for (var x = 0; x < Width; x++)
            {
                var pixel = (y * Width + x) * 4;
                if (image[pixel] < 128 && image[pixel + 1] < 128 && image[pixel + 2] < 128)
                    raster[y * BytesPerRow + x / 8] |= (byte)(0x80 >> (x % 8));
            }
            return raster;
        }
        finally
        {
            if (oldFont != IntPtr.Zero) Native.SelectObject(dc, oldFont);
            if (bodyFont != IntPtr.Zero) Native.DeleteObject(bodyFont);
            if (emphasisFont != IntPtr.Zero) Native.DeleteObject(emphasisFont);
            if (oldBitmap != IntPtr.Zero) Native.SelectObject(dc, oldBitmap);
            if (bitmap != IntPtr.Zero) Native.DeleteObject(bitmap);
            Native.DeleteDC(dc);
        }
    }

    private static IntPtr CreateFont(int size, int weight)
    {
        var font = Native.CreateFontW(-size, 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 3, 0, "Malgun Gothic");
        if (font == IntPtr.Zero) throw LastError("한글 글꼴 생성");
        return font;
    }

    private static int DrawSaleReceipt(IntPtr dc, SaleReceipt receipt, IntPtr bodyFont, IntPtr emphasisFont, int? logoHeight)
    {
        Native.SelectObject(dc, bodyFont);
        var y = logoHeight ?? DrawStoreName(dc, receipt.StoreInfo!.StoreName);
        if (receipt.IsReprint)
        {
            Draw(dc, Width / 2, y, "[재출력]", true);
            y += 28;
        }
        y += 28; // One empty text row before the business information.

        var store = receipt.StoreInfo ?? throw new InvalidOperationException("매장정보가 없습니다.");
        var restaurant = $"{store.Address} (T.{store.Phone})";
        DrawTwoColumns(dc, y, restaurant, store.BusinessNumber);
        y += 28;

        var printedAt = DateTime.Now.ToString("yyyy/MM/dd HH:mm", CultureInfo.InvariantCulture);
        DrawThreeColumns(dc, y, printedAt, $"RNO.{receipt.CheckoutId}", $"TNO : {receipt.TableLabel}");
        y += 28;
        y = DrawSeparator(dc, y);

        Draw(dc, Left, y, "상품명", false);
        DrawRight(dc, UnitRight, y, "단가");
        DrawRight(dc, QuantityRight, y, "수량");
        DrawRight(dc, AmountRight, y, "금액");
        y += 28;
        y = DrawSeparator(dc, y);

        foreach (var item in receipt.Items)
        {
            var rowTop = y;
            y = DrawWrapped(dc, Left, y, item.ItemName, NameWidth, 31);
            DrawRight(dc, UnitRight, rowTop, Money(item.UnitPrice));
            DrawRight(dc, QuantityRight, rowTop, item.Qty.ToString());
            DrawRight(dc, AmountRight, rowTop, Money(item.Amount));
        }
        y = DrawSeparator(dc, y);

        Native.SelectObject(dc, emphasisFont);
        DrawAmount(dc, y, "받을금액", receipt.TotalAmount);
        y += 32;

        Native.SelectObject(dc, bodyFont);
        foreach (var payment in receipt.Payments)
        {
            var rowTop = y;
            y = DrawWrapped(dc, Left, y, payment.Method, 240, 31);
            DrawRight(dc, AmountRight, rowTop, Money(payment.Amount));
        }
        return y;
    }

    private static int TextWidth(IntPtr dc, string text)
    {
        if (!Native.GetTextExtentPoint32W(dc, text, text.Length, out var size))
            throw LastError("영수증 글자 폭 측정");
        return size.Width;
    }

    private static bool TryDrawLogo(ReceiptLogo? logo, byte[] image, out int height)
    {
        height = 0;
        if (logo is null || logo.Width is <= 0 or > 480 || logo.Height is <= 0 or > 120 ||
            string.IsNullOrEmpty(logo.PixelsBase64) || logo.PixelsBase64.Length > 100_000) return false;
        byte[] grey;
        try
        {
            grey = Convert.FromBase64String(logo.PixelsBase64);
        }
        catch (FormatException) { return false; }
        if (grey.Length != logo.Width * logo.Height) return false;
        var left = (Width - logo.Width) / 2;
        for (var y = 0; y < logo.Height; y++)
        for (var x = 0; x < logo.Width; x++)
        {
            var pixel = (y * Width + left + x) * 4;
            var shade = grey[y * logo.Width + x];
            image[pixel] = shade;
            image[pixel + 1] = shade;
            image[pixel + 2] = shade;
        }
        height = logo.Height;
        return true;
    }

    private static int DrawStoreName(IntPtr dc, string storeName)
    {
        var font = CreateFont(40, 700);
        var previous = Native.SelectObject(dc, font);
        try
        {
            var line = new StringBuilder();
            var y = 0;
            foreach (var rune in storeName.EnumerateRunes())
            {
                var candidate = line.ToString() + rune;
                if (line.Length > 0 && TextWidth(dc, candidate) > Width - 16)
                {
                    Draw(dc, Width / 2, y, line.ToString(), true);
                    y += 48;
                    line.Clear();
                }
                line.Append(rune.ToString());
            }
            if (line.Length > 0)
            {
                Draw(dc, Width / 2, y, line.ToString(), true);
                y += 48;
            }
            return y;
        }
        finally
        {
            Native.SelectObject(dc, previous);
            Native.DeleteObject(font);
        }
    }

    private static void DrawTwoColumns(IntPtr dc, int y, string left, string right)
    {
        if (TextWidth(dc, left) + TextWidth(dc, right) + TextWidth(dc, " ") > Right - Left)
            throw new InvalidOperationException("매장 주소, 전화번호, 사업자번호가 한 줄 폭을 초과합니다.");
        Draw(dc, Left, y, left, false);
        DrawRight(dc, Right, y, right);
    }

    private static void DrawThreeColumns(IntPtr dc, int y, string left, string middle, string right)
    {
        var freeWidth = Right - Left - TextWidth(dc, left) - TextWidth(dc, middle) - TextWidth(dc, right);
        if (freeWidth < 2 * TextWidth(dc, " "))
            throw new InvalidOperationException("거래정보가 한 줄 폭을 초과합니다.");
        Draw(dc, Left, y, left, false);
        Draw(dc, Left + TextWidth(dc, left) + freeWidth / 2, y, middle, false);
        DrawRight(dc, Right, y, right);
    }

    private static int DrawWrapped(IntPtr dc, int x, int y, string text, int maxWidth, int lineHeight)
    {
        var line = new StringBuilder();
        foreach (var rune in text.EnumerateRunes())
        {
            var candidate = line.ToString() + rune;
            if (!Native.GetTextExtentPoint32W(dc, candidate, candidate.Length, out var size))
                throw LastError("영수증 글자 폭 측정");
            if (line.Length > 0 && size.Width > maxWidth)
            {
                Draw(dc, x, y, line.ToString(), false);
                y += lineHeight;
                line.Clear();
            }
            line.Append(rune.ToString());
        }
        if (line.Length > 0)
        {
            Draw(dc, x, y, line.ToString(), false);
            y += lineHeight;
        }
        return y;
    }

    private static void DrawAmount(IntPtr dc, int y, string label, int amount)
    {
        Draw(dc, Left, y, label, false);
        DrawRight(dc, AmountRight, y, Money(amount));
    }

    private static string Money(int amount) => amount.ToString("N0", CultureInfo.InvariantCulture);

    private static void DrawRight(IntPtr dc, int x, int y, string text)
    {
        Native.SetTextAlign(dc, 2); // TA_RIGHT | TA_TOP
        if (!Native.TextOutW(dc, x, y, text, text.Length))
            throw LastError("영수증 금액 그리기");
    }

    private static int DrawSeparator(IntPtr dc, int y)
    {
        var dashWidth = TextWidth(dc, "-");
        if (dashWidth <= 0) throw new InvalidOperationException("영수증 구분 문자 폭을 측정할 수 없습니다.");
        Draw(dc, Left, y, new string('-', (Right - Left) / dashWidth), false);
        return y + 28;
    }

    private static void Draw(IntPtr dc, int x, int y, string text, bool centered)
    {
        Native.SetTextAlign(dc, centered ? 6u : 0u); // TA_CENTER or TA_LEFT, both TA_TOP
        if (!Native.TextOutW(dc, x, y, text, text.Length))
            throw LastError("영수증 글자 그리기");
    }

    private static uint SendToWindowsPrinter(string printerName, byte[] command, string documentName)
    {
        if (!Native.OpenPrinterW(printerName, out var printer, IntPtr.Zero))
            throw LastError($"프린터 '{printerName}' 열기");

        try
        {
            // Use status only when the Windows spooler reports a definite fault.
            if (Native.GetPrinterW(printer, 6, out var status, sizeof(uint), out _))
            {
                if ((status & 0x00000080) != 0 || (status & 0x00001000) != 0)
                    throw new InvalidOperationException("프린터가 오프라인이거나 사용할 수 없습니다.");
                if ((status & 0x00000010) != 0 || (status & 0x00000040) != 0)
                    throw new InvalidOperationException("프린터에 용지가 없거나 용지 문제가 있습니다.");
                if ((status & 0x00000008) != 0 || (status & 0x00400000) != 0)
                    throw new InvalidOperationException("프린터 용지가 걸렸거나 덮개가 열려 있습니다.");
                if ((status & 0x00000001) != 0)
                    throw new InvalidOperationException("Windows 인쇄 대기열이 일시 중지되었습니다.");
            }
            var document = new DocInfo1
            {
                DocumentName = documentName,
                DataType = "RAW"
            };
            var jobId = Native.StartDocPrinterW(printer, 1, ref document);
            if (jobId == 0) throw LastError("인쇄 작업 시작");

            try
            {
                if (!Native.StartPagePrinter(printer)) throw LastError("인쇄 페이지 시작");
                try
                {
                    if (!Native.WritePrinter(printer, command, (uint)command.Length, out var written))
                        throw LastError("프린터 데이터 전송");
                    if (written != command.Length)
                        throw new InvalidOperationException($"프린터 데이터가 일부만 전송되었습니다 ({written}/{command.Length} 바이트).");
                }
                finally
                {
                    if (!Native.EndPagePrinter(printer)) throw LastError("인쇄 페이지 종료");
                }
            }
            finally
            {
                if (!Native.EndDocPrinter(printer)) throw LastError("인쇄 작업 종료");
            }
            return jobId;
        }
        finally
        {
            Native.ClosePrinter(printer);
        }
    }

    private static Win32Exception LastError(string operation)
    {
        var error = Marshal.GetLastWin32Error();
        return new Win32Exception(error, $"{operation} 실패: {new Win32Exception(error).Message}");
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName;
        public IntPtr OutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public uint Size;
        public int Width;
        public int Height;
        public ushort Planes;
        public ushort BitCount;
        public uint Compression;
        public int SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public uint ClrUsed;
        public uint ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfo
    {
        public BitmapInfoHeader Header;
        public uint Color0;
    }

    private static class Native
    {
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateFontW(int height, int width, int escapement, int orientation, int weight,
            uint italic, uint underline, uint strikeOut, uint charSet, uint outputPrecision,
            uint clipPrecision, uint quality, uint pitchAndFamily, string faceName);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern int SetBkMode(IntPtr dc, int mode);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern uint SetTextColor(IntPtr dc, uint color);
        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern uint SetTextAlign(IntPtr dc, uint align);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetTextExtentPoint32W(IntPtr dc, string text, int length, out TextSize size);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool TextOutW(IntPtr dc, int x, int y, string text, int length);
        [DllImport("gdi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GdiFlush();
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool OpenPrinterW(string name, out IntPtr printer, IntPtr defaults);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetPrinterW(IntPtr printer, uint level, out uint status, uint bufferSize, out uint needed);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint StartDocPrinterW(IntPtr printer, uint level, ref DocInfo1 info);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool StartPagePrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool WritePrinter(IntPtr printer, byte[] data, uint count, out uint written);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EndPagePrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EndDocPrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ClosePrinter(IntPtr printer);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TextSize
    {
        public int Width;
        public int Height;
    }
}
