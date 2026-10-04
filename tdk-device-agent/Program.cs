var builder = WebApplication.CreateBuilder(args);
// Windows Event Log writes can fail for a normal POS user and must not hide API errors.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
// Production must never listen on a LAN interface. Development launch profiles
// already use localhost and retain their existing HTTP/HTTPS ports.
if (!builder.Environment.IsDevelopment())
    builder.WebHost.UseUrls("http://127.0.0.1:5168");
var app = builder.Build();

var drawerGate = new SemaphoreSlim(1, 1);
var lastDrawerOpen = 0L;
var allowedOrigins = app.Configuration.GetSection("CashDrawer:AllowedOrigins").Get<string[]>() ?? [];

app.Use(async (context, next) =>
{
    if (!context.Request.Path.Equals("/cash-drawer/open", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var origin = context.Request.Headers.Origin.ToString();
    if (origin.Length > 0)
    {
        if (!allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { ok = false, error = "허용되지 않은 POS Origin입니다." });
            return;
        }
        context.Response.Headers.AccessControlAllowOrigin = origin;
        context.Response.Headers.Vary = "Origin";
    }

    context.Response.Headers.CacheControl = "no-store";
    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.Headers.AccessControlAllowMethods = "POST";
        context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
        context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }
    await next();
});

app.MapGet("/", () => "Hello World!");

app.MapPost("/api/printer/test", (IConfiguration configuration, ILogger<Program> logger) =>
{
    var printerName = configuration["Printer:Name"];
    if (string.IsNullOrWhiteSpace(printerName))
    {
        return Results.Json(new { success = false, error = "Printer:Name 설정이 비어 있습니다." }, statusCode: 500);
    }

    try
    {
        var jobId = PrinterTest.Print(printerName);
        return Results.Ok(new
        {
            success = true,
            printerName,
            jobId,
            message = "Windows 인쇄 대기열에 테스트 영수증과 절단 명령을 전달했습니다."
        });
    }
    catch (Exception exception)
    {
        logger.LogError(exception, "테스트 영수증 출력 실패: {PrinterName}", printerName);
        var statusCode = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1801 } ? 404 : 500;
        return Results.Json(new
        {
            success = false,
            printerName,
            error = exception.Message
        }, statusCode: statusCode);
    }
});

app.MapPost("/api/printer/receipt", (SaleReceipt receipt, IConfiguration configuration, ILogger<Program> logger) =>
{
    var error = receipt.Validate();
    if (error is not null)
        return Results.Json(new { success = false, error }, statusCode: 400);

    var printerName = configuration["Printer:Name"];
    if (string.IsNullOrWhiteSpace(printerName))
        return Results.Json(new { success = false, error = "Printer:Name 설정이 비어 있습니다." }, statusCode: 500);

    try
    {
        var jobId = PrinterTest.Print(printerName, receipt);
        return Results.Ok(new { success = true, printerName, jobId,
            message = "Windows 인쇄 대기열에 영수증과 절단 명령을 전달했습니다." });
    }
    catch (Exception exception)
    {
        logger.LogError(exception, "판매 영수증 출력 실패: {PrinterName}, checkout {CheckoutId}", printerName, receipt.CheckoutId);
        var statusCode = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1801 } ? 404 : 500;
        return Results.Json(new { success = false, printerName, error = exception.Message }, statusCode: statusCode);
    }
});

app.MapPost("/cash-drawer/open", async (IConfiguration configuration, ILogger<Program> logger) =>
{
    var printerName = configuration["Printer:Name"]?.Trim();
    if (string.IsNullOrEmpty(printerName))
        return Results.Json(new { ok = false, error = "설정된 프린터가 없습니다. Printer:Name을 확인해주세요." }, statusCode: 503);

    if (!await drawerGate.WaitAsync(0))
        return Results.Json(new { ok = false, error = "금고 열기 요청이 이미 처리 중입니다." }, statusCode: 429);
    try
    {
        if (Environment.TickCount64 - lastDrawerOpen < 1500)
            return Results.Json(new { ok = false, error = "잠시 후 다시 시도해주세요." }, statusCode: 429);

        PrinterTest.OpenCashDrawer(printerName);
        lastDrawerOpen = Environment.TickCount64;
        logger.LogInformation("Cash drawer command queued on configured printer {PrinterName}", printerName);
        return Results.Ok(new { ok = true });
    }
    catch (Exception exception)
    {
        logger.LogError(exception, "Cash drawer open failed on configured printer {PrinterName}", printerName);
        var statusCode = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1801 } ? 404 : 503;
        return Results.Json(new { ok = false, error = exception.Message }, statusCode: statusCode);
    }
    finally
    {
        drawerGate.Release();
    }
});

app.Run();
