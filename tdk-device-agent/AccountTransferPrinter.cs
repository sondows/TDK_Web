using System.Runtime.InteropServices;

internal static partial class PrinterTest
{
    public static uint PrintAccountTransfer(string printerName, AccountTransferNotice notice)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("영수증 프린터는 Windows에서만 사용할 수 있습니다.");
        var raster = RenderAccountTransfer(notice);
        return SendToWindowsPrinter(printerName, BuildPrintCommand(raster), "TDK POS account transfer notice");
    }

    // The browser preview is local HTML; only actual printing renders printer dots.
    private static byte[] RenderAccountTransfer(AccountTransferNotice notice)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("영수증 미리보기는 Windows Device Agent에서만 사용할 수 있습니다.");
        const int height = 1000;
        var dc = Native.CreateCompatibleDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) throw LastError("인쇄 이미지 컨텍스트 생성");
        IntPtr bitmap = IntPtr.Zero, oldBitmap = IntPtr.Zero, bodyFont = IntPtr.Zero, titleFont = IntPtr.Zero, amountFont = IntPtr.Zero, accountFont = IntPtr.Zero, oldFont = IntPtr.Zero;
        try
        {
            var info = new BitmapInfo {
                Header = new BitmapInfoHeader {
                    Size = (uint)Marshal.SizeOf<BitmapInfoHeader>(), Width = Width, Height = -height,
                    Planes = 1, BitCount = 32, Compression = 0, SizeImage = Width * height * 4
                }
            };
            bitmap = Native.CreateDIBSection(dc, ref info, 0, out var pixels, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || pixels == IntPtr.Zero) throw LastError("인쇄 이미지 생성");
            oldBitmap = Native.SelectObject(dc, bitmap);
            if (oldBitmap == IntPtr.Zero) throw LastError("인쇄 이미지 선택");
            var image = new byte[Width * height * 4];
            Array.Fill(image, (byte)255);
            var hasLogo = TryDrawLogo(notice.ReceiptLogo, image, out var logoHeight);
            Marshal.Copy(image, 0, pixels, image.Length);
            bodyFont = CreateFont(ReceiptFontSize, 500);
            titleFont = CreateFont(32, 700);
            amountFont = CreateFont(34, 700);
            oldFont = Native.SelectObject(dc, bodyFont);
            if (oldFont == IntPtr.Zero) throw LastError("한글 글꼴 선택");
            Native.SetBkMode(dc, 1);
            Native.SetTextColor(dc, 0);

            var y = hasLogo ? logoHeight : DrawStoreName(dc, notice.StoreName);
            y += 28; // Blank line below the logo or store name.
            Native.SelectObject(dc, titleFont);
            Draw(dc, Width / 2, y, "계좌이체 입금안내", true);
            y += 68; // Title and one blank line.
            Native.SelectObject(dc, bodyFont);
            y = DrawSeparator(dc, y);
            Native.SelectObject(dc, amountFont);
            var amount = $"{Money(notice.TotalAmount)}원";
            var label = "총 결제금액";
            if (TextWidth(dc, label) + TextWidth(dc, amount) + 24 > Right - Left)
                throw new InvalidOperationException("총 결제금액이 인쇄 폭을 초과합니다.");
            Draw(dc, Left, y, label, false);
            DrawRight(dc, AmountRight, y, amount);
            y += 44;
            Native.SelectObject(dc, bodyFont);
            y = DrawSeparator(dc, y);
            y += 31; // One blank line above the account details.
            var accountName = $"{notice.BankName}({notice.AccountHolder})";
            Native.SelectObject(dc, amountFont);
            if (TextWidth(dc, accountName) + TextWidth(dc, notice.AccountNumber) + TextWidth(dc, " ") > AmountRight - Left)
            {
                for (var size = 32; size >= ReceiptFontSize; size -= 2)
                {
                    var candidate = CreateFont(size, 700);
                    Native.SelectObject(dc, candidate);
                    if (accountFont != IntPtr.Zero) Native.DeleteObject(accountFont);
                    accountFont = candidate;
                    if (TextWidth(dc, accountName) + TextWidth(dc, notice.AccountNumber) + TextWidth(dc, " ") <= AmountRight - Left) break;
                }
            }
            var accountLineHeight = accountFont == IntPtr.Zero ? 42 : 34;
            if (TextWidth(dc, accountName) + TextWidth(dc, notice.AccountNumber) + TextWidth(dc, " ") <= AmountRight - Left)
            {
                Draw(dc, Left, y, accountName, false);
                DrawRight(dc, AmountRight, y, notice.AccountNumber);
                y += accountLineHeight;
            }
            else
            {
                y = DrawWrapped(dc, Left, y, accountName, Right - Left, accountLineHeight);
                y = DrawWrappedRight(dc, AmountRight, y, notice.AccountNumber, AmountRight - Left, accountLineHeight);
            }
            Native.SelectObject(dc, bodyFont);
            y = DrawSeparator(dc, y + 31); // One blank line below the account details.
            y += 18;
            Draw(dc, Width / 2, y, "입금 후 직원에게 알려주세요.", true);
            var outputHeight = y + 58; // Leave one blank line after the instruction.
            if (outputHeight > height) throw new InvalidOperationException("계좌이체 안내서가 인쇄 가능한 길이를 초과했습니다.");
            if (!Native.GdiFlush()) throw LastError("영수증 이미지 완성");
            Marshal.Copy(pixels, image, 0, image.Length);
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
            if (bodyFont != IntPtr.Zero) Native.DeleteObject(bodyFont);
            if (titleFont != IntPtr.Zero) Native.DeleteObject(titleFont);
            if (amountFont != IntPtr.Zero) Native.DeleteObject(amountFont);
            if (accountFont != IntPtr.Zero) Native.DeleteObject(accountFont);
            if (oldBitmap != IntPtr.Zero) Native.SelectObject(dc, oldBitmap);
            if (bitmap != IntPtr.Zero) Native.DeleteObject(bitmap);
            Native.DeleteDC(dc);
        }
    }

    private static int DrawWrappedRight(IntPtr dc, int right, int y, string text, int maxWidth, int lineHeight)
    {
        var line = new System.Text.StringBuilder();
        foreach (var rune in text.EnumerateRunes())
        {
            var candidate = line.ToString() + rune;
            if (TextWidth(dc, candidate) > maxWidth && line.Length > 0)
            {
                DrawRight(dc, right, y, line.ToString());
                y += lineHeight;
                line.Clear();
            }
            line.Append(rune.ToString());
        }
        if (line.Length > 0)
        {
            DrawRight(dc, right, y, line.ToString());
            y += lineHeight;
        }
        return y;
    }
}
