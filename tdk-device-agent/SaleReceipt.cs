internal sealed class SaleReceipt
{
    public StoreInfo? StoreInfo { get; set; }
    public ReceiptLogo? ReceiptLogo { get; set; }
    public long CheckoutId { get; set; }
    public string? ReceiptNumber { get; set; }
    public bool IsReprint { get; set; }
    public string? StatusLabel { get; set; }
    public string TableLabel { get; set; } = "";
    public string OrderedAt { get; set; } = "";
    public List<SaleReceiptItem> Items { get; set; } = [];
    public int SubtotalAmount { get; set; }
    public int DiscountAmount { get; set; }
    public List<SaleReceiptDiscount> Discounts { get; set; } = [];
    public int CancelledAmount { get; set; }
    public int TotalAmount { get; set; }
    public int RemainingAmount { get; set; }
    public List<SaleReceiptPayment> Payments { get; set; } = [];

    public string? Validate()
    {
        if (StoreInfo is null || string.IsNullOrWhiteSpace(StoreInfo.StoreName) || string.IsNullOrWhiteSpace(StoreInfo.Address) ||
            string.IsNullOrWhiteSpace(StoreInfo.Phone) || string.IsNullOrWhiteSpace(StoreInfo.BusinessNumber) ||
            StoreInfo.StoreName.Length > 255 || StoreInfo.Address.Length > 255 || StoreInfo.Phone.Length > 255 || StoreInfo.BusinessNumber.Length > 255)
            return "상호명, 매장 주소, 전화번호 또는 사업자번호가 설정되지 않았습니다.";
        if (CheckoutId <= 0 || string.IsNullOrWhiteSpace(TableLabel) || TableLabel.Length > 100 || StatusLabel?.Length > 40 ||
            !System.Text.RegularExpressions.Regex.IsMatch(OrderedAt ?? "", @"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$"))
            return "거래번호, 테이블 또는 주문일시가 올바르지 않습니다.";
        if (Items is null || Items.Count is < 1 or > 50 ||
            Items.Any(item => item is null || string.IsNullOrWhiteSpace(item.ItemName) || item.ItemName.Length > 100 ||
                item.UnitPrice < 0 || item.Qty <= 0 || item.Amount < 0))
            return "영수증 메뉴 정보가 올바르지 않습니다.";
        if (Payments is null || Payments.Count is < 1 or > 30 ||
            Payments.Any(payment => payment is null || string.IsNullOrWhiteSpace(payment.Method) || payment.Method.Length > 40 ||
                payment.Amount < 0 || payment.ApprovalNo?.Length > 100 ||
                payment.CashReceived is < 0 || payment.CashChange is < 0))
            return "영수증 결제 정보가 올바르지 않습니다.";
        if (Discounts is null || Discounts.Count > 50 ||
            Discounts.Any(discount => discount is null || string.IsNullOrWhiteSpace(discount.Label) || discount.Label.Length > 100 || discount.Amount <= 0) ||
            Discounts.Sum(discount => (long)discount.Amount) > DiscountAmount)
            return "영수증 할인 정보가 올바르지 않습니다.";
        if (SubtotalAmount < 0 || DiscountAmount < 0 || CancelledAmount < 0 || TotalAmount < 0 || RemainingAmount < 0 ||
            Payments.Sum(payment => (long)payment.Amount) + RemainingAmount != TotalAmount)
            return "영수증 금액 정보가 올바르지 않습니다.";
        return null;
    }
}

internal sealed class ReceiptLogo
{
    public int Width { get; set; }
    public int Height { get; set; }
    public string PixelsBase64 { get; set; } = "";
}

internal sealed class StoreInfo
{
    public string StoreName { get; set; } = "";
    public string BusinessNumber { get; set; } = "";
    public string Representative { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Address { get; set; } = "";
}

internal sealed class SaleReceiptDiscount
{
    public string Label { get; set; } = "";
    public int Amount { get; set; }
}

internal sealed class SaleReceiptItem
{
    public string ItemName { get; set; } = "";
    public int UnitPrice { get; set; }
    public int Qty { get; set; }
    public int Amount { get; set; }
}

internal sealed class SaleReceiptPayment
{
    public string Method { get; set; } = "";
    public int Amount { get; set; }
    public string? ApprovalNo { get; set; }
    public int? CashReceived { get; set; }
    public int? CashChange { get; set; }
}
