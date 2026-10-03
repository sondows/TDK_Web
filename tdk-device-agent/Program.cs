var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

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

app.Run();
