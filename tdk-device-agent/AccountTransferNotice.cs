internal sealed class AccountTransferNotice
{
    public string StoreName { get; set; } = "";
    public ReceiptLogo? ReceiptLogo { get; set; }
    public int TotalAmount { get; set; }
    public string BankName { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string AccountHolder { get; set; } = "";

    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(StoreName) || StoreName.Length > 255 ||
            TotalAmount < 0 || TotalAmount > 999_999_999 ||
            new[] { BankName, AccountNumber, AccountHolder }.Any(value =>
                string.IsNullOrWhiteSpace(value) || value.Length > 100 || value.Contains('\r') || value.Contains('\n')))
            return "계좌이체 안내서 내용을 확인해 주세요.";
        return null;
    }
}
