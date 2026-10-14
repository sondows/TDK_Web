using System.Reflection;
using System.Text.Json;

const int width = 504;
var outputDirectory = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "TDKReceiptPreview");
Directory.CreateDirectory(outputDirectory);
var render = typeof(PrinterTest).GetMethod("RenderReceipt", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new InvalidOperationException("RenderReceipt not found");
var buildCommand = typeof(PrinterTest).GetMethod("BuildPrintCommand", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new InvalidOperationException("BuildPrintCommand not found");

SaleReceipt Sample(string tableLabel = "2T", bool reprint = false)
{
    return new SaleReceipt
    {
        StoreInfo = new StoreInfo { StoreName = "탑동김치찌개", Address = "제주시 탑동로 21", Phone = "725-7557", BusinessNumber = "590-08-00080" },
        CheckoutId = 20,
        TableLabel = tableLabel,
        OrderedAt = "2026-09-27 09:47",
        IsReprint = reprint,
        Items =
        [
            new() { ItemName = "흑돼지김치찌개", UnitPrice = 10_000, Qty = 2, Amount = 20_000 },
            new() { ItemName = "계란말이", UnitPrice = 4_000, Qty = 1, Amount = 4_000 },
        ],
        SubtotalAmount = 24_000,
        TotalAmount = 24_000,
        Payments = [new() { Method = "카드", Amount = 24_000 }],
    };
}

var first = Sample();
var reprint = Sample(reprint: true);
var cash = Sample(); cash.Payments = [new() { Method = "현금", Amount = 24_000 }];
var card = Sample();
var mixed = Sample(); mixed.Payments = [new() { Method = "카드", Amount = 20_000 }, new() { Method = "현금", Amount = 4_000 }];
var mixedReversed = Sample(); mixedReversed.Payments = [new() { Method = "현금", Amount = 4_000 }, new() { Method = "카드", Amount = 20_000 }];
var manyItems = Sample(); manyItems.Items.Add(new() { ItemName = "아주 긴 상품명은 상품 열에서만 다음 줄로 이어져야 합니다", UnitPrice = 5_000, Qty = 1, Amount = 5_000 }); manyItems.SubtotalAmount = 29_000; manyItems.TotalAmount = 29_000; manyItems.Payments = [new() { Method = "현금", Amount = 29_000 }];
var group = Sample("2T+3T", reprint: true);
var logoPixels = Enumerable.Repeat((byte)255, 80 * 30).ToArray();
for (var y = 4; y < 26; y++)
for (var x = 4; x < 76; x++) logoPixels[y * 80 + x] = 0;
var logo = new ReceiptLogo { Width = 80, Height = 30, PixelsBase64 = Convert.ToBase64String(logoPixels) };
var withLogo = Sample(); withLogo.ReceiptLogo = logo;
var logoReprint = Sample(reprint: true); logoReprint.ReceiptLogo = logo;
var invalidLogo = Sample(); invalidLogo.ReceiptLogo = new ReceiptLogo { Width = 80, Height = 30, PixelsBase64 = "invalid" };
var customerConfirmation = Sample();
customerConfirmation.ReceiptLogo = logo;
customerConfirmation.StoreInfo!.Representative = "손창호";
customerConfirmation.Payments =
[
    new() { PaymentId = 122, Method = "현금", Amount = 10_000 },
    new() { PaymentId = 123, Method = "고객결제", Amount = 10_000 },
];
customerConfirmation.RemainingAmount = 4_000;
customerConfirmation.CustomerConfirmation = new CustomerPaymentConfirmation
{
    PaymentId = 123,
    CustomerName = "제주해변공연장",
    Amount = 10_000,
    BalanceAfterPayment = -184_000,
    BarcodeValue = "P3F",
};

var cases = new (string Name, SaleReceipt Receipt)[]
{
    ("first", first), ("reprint", reprint), ("cash", cash), ("card", card),
    ("mixed", mixed), ("mixed-reversed", mixedReversed), ("many-items", manyItems), ("group-tables", group),
    ("with-logo", withLogo), ("logo-reprint", logoReprint), ("invalid-logo-fallback", invalidLogo),
    ("customer-confirmation", customerConfirmation),
};

foreach (var (name, receipt) in cases)
{
    var validation = receipt.Validate();
    if (validation is not null) throw new InvalidOperationException($"{name}: {validation}");
    byte[] raster;
    try { raster = (byte[])render.Invoke(null, [receipt])!; }
    catch (TargetInvocationException exception) { throw new InvalidOperationException(name, exception.InnerException); }
    if (raster.Length == 0 || raster.Length % (width / 8) != 0)
        throw new InvalidOperationException($"{name}: raster dimensions are invalid");
    var path = Path.Combine(outputDirectory, $"{name}.bmp");
    WriteBitmap(path, raster, width);
    Console.WriteLine($"{name}: OK ({raster.Length / (width / 8)} px)");
}

foreach (var (name, receipt) in cases)
{
    var raster = (byte[])render.Invoke(null, [receipt])!;
    var command = (byte[])buildCommand.Invoke(null, [raster, receipt.CustomerConfirmation?.BarcodeValue])!;
    var cutOffset = 2 + 8 + raster.Length;
    if (command[0] != 0x1b || command[1] != 0x40 || command[2] != 0x1d || command[3] != 0x76)
        throw new InvalidOperationException($"{name}: command prefix is invalid");
    if (receipt.CustomerConfirmation is null &&
        (command.Length != cutOffset + 7 ||
         !command.AsSpan(cutOffset, 7).SequenceEqual(new byte[] { 0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x01 })))
        throw new InvalidOperationException($"{name}: data remains after the cut or command order is invalid");
    if (receipt.CustomerConfirmation is not null &&
        (command.AsSpan(cutOffset).IndexOf(new byte[] { 0x1d, 0x6b, 0x45, 0x03, (byte)'P', (byte)'3', (byte)'F' }) < 0 ||
         !command.AsSpan(command.Length - 3).SequenceEqual(new byte[] { 0x1d, 0x56, 0x01 })))
        throw new InvalidOperationException($"{name}: Code 39 barcode or final cut is missing");
}
var textRaster = (byte[])render.Invoke(null, [first])!;
var invalidRaster = (byte[])render.Invoke(null, [invalidLogo])!;
if (!textRaster.AsSpan(0, 48 * (width / 8)).SequenceEqual(invalidRaster.AsSpan(0, 48 * (width / 8))))
    throw new InvalidOperationException("Invalid logo did not fall back to the store name");
Console.WriteLine("logo fallback and cut-final command order OK");

if (args.Length > 1)
{
    var buildDocument = typeof(PrinterTest).GetMethod("BuildDocumentCommand", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException("BuildDocumentCommand not found");
    var renderDocument = typeof(PrinterTest).GetMethod("RenderDocumentSegment", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException("RenderDocumentSegment not found");
    var fixtures = Directory.GetFiles(args[1], "*.json");
    if (fixtures.Length == 0) throw new InvalidOperationException("No web PrintDocument fixtures were found");
    foreach (var file in fixtures)
    {
        var document = JsonSerializer.Deserialize<PosPrintDocument>(File.ReadAllText(file), new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException($"{file}: invalid document JSON");
        if (document.Validate() is { } validation) throw new InvalidOperationException($"{file}: {validation}");
        var command = (byte[])buildDocument.Invoke(null, [document])!;
        if (command.Length < 20 || command[0] != 0x1b || command[1] != 0x40 ||
            !command.AsSpan(command.Length - 3).SequenceEqual(new byte[] { 0x1d, 0x56, 0x01 }))
            throw new InvalidOperationException($"{file}: initialization or final cut missing");
        var barcode = document.Commands.FirstOrDefault(item => item.Type == "barcode");
        if (barcode is not null && command.AsSpan().IndexOf(new byte[] { 0x1d, 0x6b, 0x49, (byte)(barcode.Value!.Length + 2), (byte)'{', (byte)'B' }) < 0)
            throw new InvalidOperationException($"{file}: native Code 128 barcode command missing");
        if (barcode is not null && command.AsSpan().IndexOf(new byte[] { 0x1d, 0x48, barcode.ShowHri == false ? (byte)0x00 : (byte)0x02 }) < 0)
            throw new InvalidOperationException($"{file}: barcode HRI setting missing");
        var firstSegment = document.Commands.TakeWhile(item => item.Type is not ("barcode" or "cut")).ToList();
        var raster = (byte[])renderDocument.Invoke(null, [firstSegment])!;
        WriteBitmap(Path.Combine(outputDirectory, $"document-{Path.GetFileNameWithoutExtension(file)}.bmp"), raster, width);
    }
    var bad = new PosPrintDocument { Commands = [new() { Type = "raw", Value = "1B40" }, new() { Type = "cut" }] };
    if (bad.Validate() is null) throw new InvalidOperationException("Untrusted RAW printer bytes were accepted");
    bad.Commands[0].Type = "barcode";
    bad.Commands[0].Value = "010-1234-5678";
    if (bad.Validate() is null) throw new InvalidOperationException("Phone-shaped barcode value was accepted");
    if (OperatingSystem.IsWindows())
    {
        var sample = JsonSerializer.Deserialize<PosPrintDocument>(File.ReadAllText(fixtures[0]), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        try { PrinterTest.PrintDocument("TDK POS nonexistent printer 3f32c70a-04a8-4c47-b8ae-60cd34f18ac0", sample); throw new InvalidOperationException("Missing Printer.Name was accepted"); }
        catch (System.ComponentModel.Win32Exception) { }
    }
    Console.WriteLine($"{fixtures.Length} browser documents rendered; barcode, cut, invalid commands, missing printer OK");
}

var notice = new AccountTransferNotice
{
    StoreName = "탑동김치찌개",
    ReceiptLogo = logo,
    TotalAmount = 9_999_999,
    BankName = "신한은행",
    AccountHolder = "손창호",
    AccountNumber = "010-6690-5475",
};
if (notice.Validate() is { } noticeError) throw new InvalidOperationException(noticeError);
var noticeRender = typeof(PrinterTest).GetMethod("RenderAccountTransfer", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new InvalidOperationException("RenderAccountTransfer not found");
var noticeRaster = (byte[])noticeRender.Invoke(null, [notice])!;
WriteBitmap(Path.Combine(outputDirectory, "account-transfer-notice.bmp"), noticeRaster, width);
notice.ReceiptLogo = null;
var textNoticeRaster = (byte[])noticeRender.Invoke(null, [notice])!;
if (textNoticeRaster.Length == 0 || textNoticeRaster.Length % (width / 8) != 0)
    throw new InvalidOperationException("Account transfer text fallback raster is invalid");
WriteBitmap(Path.Combine(outputDirectory, "account-transfer-no-logo.bmp"), textNoticeRaster, width);
Console.WriteLine($"account transfer notice: OK ({noticeRaster.Length / (width / 8)} px)");

static void WriteBitmap(string path, byte[] raster, int width)
{
    var height = raster.Length / (width / 8);
    var stride = (width * 3 + 3) & ~3;
    using var stream = File.Create(path);
    using var writer = new BinaryWriter(stream);
    writer.Write((ushort)0x4D42);
    writer.Write(54 + stride * height);
    writer.Write(0);
    writer.Write(54);
    writer.Write(40);
    writer.Write(width);
    writer.Write(height);
    writer.Write((ushort)1);
    writer.Write((ushort)24);
    writer.Write(0);
    writer.Write(stride * height);
    writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(0);
    for (var y = height - 1; y >= 0; y--)
    {
        for (var x = 0; x < width; x++)
        {
            var ink = (raster[y * (width / 8) + x / 8] & (0x80 >> (x % 8))) != 0;
            var color = (byte)(ink ? 0 : 255);
            writer.Write(color); writer.Write(color); writer.Write(color);
        }
        for (var pad = width * 3; pad < stride; pad++) writer.Write((byte)0);
    }
}
