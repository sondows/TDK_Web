param([Parameter(Mandatory=$true)][string]$MdbPath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Jet/Access is 32-bit on the POS workstation. Open a disposable copy so the
# supplied MDB is never locked or modified by the ODBC driver.
$source = (Resolve-Path -LiteralPath $MdbPath).Path
$copy = Join-Path ([IO.Path]::GetTempPath()) ("legacy-sales-" + [guid]::NewGuid().ToString('N') + '.mdb')
Copy-Item -LiteralPath $source -Destination $copy
$connection = New-Object System.Data.Odbc.OdbcConnection
$connection.ConnectionString = "Driver={Microsoft Access Driver (*.mdb)};DBQ=$copy;ReadOnly=1;"

function Read-Rows([string]$query, [scriptblock]$visit) {
  $command = $connection.CreateCommand()
  $command.CommandText = $query
  $reader = $command.ExecuteReader()
  try { while ($reader.Read()) { & $visit $reader } }
  finally { $reader.Close(); $command.Dispose() }
}

$days = @{}
$saleDates = @{}
$saleDeleted = @{}
$groupDates = @{}
$crossDateGroups = @{}
$paymentTypes = @{}
$unmatchedPayments = 0

function Day([string]$date) {
  if (-not $days.ContainsKey($date)) {
    $days[$date] = [ordered]@{
      business_date=$date; sale_count=0; gross_sales=0L; discount_amount=0L;
      net_sales=0L; card_amount=0L; cash_amount=0L;
      bank_transfer_amount=0L; other_amount=0L;
      cancelled_count=0; cancelled_amount=0L
    }
  }
  return $days[$date]
}

try {
  $connection.Open()
  Read-Rows 'SELECT SaleCode, GroupCode, SaleTime, OrderAmt, DiscountAmt, DelKey FROM Sale' {
    param($r)
    $code = $r.GetString(0)
    $group = $r.GetString(1)
    $date = $r.GetDateTime(2).ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $saleDates[$code] = $date
    $deleted = $r.GetBoolean(5)
    $saleDeleted[$code] = $deleted
    if ($groupDates.ContainsKey($group) -and $groupDates[$group] -ne $date) { $crossDateGroups[$group] = $true }
    else { $groupDates[$group] = $date }
    $row = Day $date
    if ($deleted) {
      $row.cancelled_count++
      # Original order gross is the most stable amount on deleted Sale rows.
      $row.cancelled_amount += [long]$r.GetValue(3)
    } else {
      $row.sale_count++
      $row.gross_sales += [long]$r.GetValue(3)
      $row.discount_amount += [long]$r.GetValue(4)
    }
  }
  Read-Rows 'SELECT SaleCode, PayType, PayName, PayAmt, DelKey FROM Sale_Payment' {
    param($r)
    if ($r.GetBoolean(4)) { return }
    $code = $r.GetString(0)
    if (-not $saleDates.ContainsKey($code)) { $script:unmatchedPayments++; return }
    if ($saleDeleted[$code]) { return }
    $type = $r.GetString(1)
    $name = if ($r.IsDBNull(2)) { '' } else { $r.GetString(2) }
    $amount = [long]$r.GetValue(3)
    $row = Day $saleDates[$code]
    $key = "$type|$name"
    if (-not $paymentTypes.ContainsKey($key)) { $paymentTypes[$key] = [ordered]@{pay_type=$type;pay_name=$name;count=0;amount=0L} }
    $paymentTypes[$key].count++
    $paymentTypes[$key].amount += $amount
    switch ($type) {
      '02' { $row.card_amount += $amount }
      '01' { $row.cash_amount += $amount }
      '00' { $row.cash_amount += $amount } # PayAmt is already negative for change.
      '11' { $row.bank_transfer_amount += $amount }
      default { $row.other_amount += $amount }
    }
  }
  foreach ($row in $days.Values) { $row.net_sales = $row.gross_sales - $row.discount_amount }
  $orderedDays = @($days.Values | Sort-Object { $_['business_date'] })
  $result = [ordered]@{
    days=$orderedDays
    payment_types=@($paymentTypes.Values | Sort-Object { $_['pay_type'] }, { $_['pay_name'] })
    cross_date_group_count=$crossDateGroups.Count
    unmatched_payment_count=$unmatchedPayments
  }
  ConvertTo-Json -InputObject $result -Compress -Depth 5
}
finally {
  $connection.Close()
  $connection.Dispose()
  Remove-Item -LiteralPath $copy -ErrorAction SilentlyContinue
  $lockFile = [IO.Path]::ChangeExtension($copy, '.ldb')
  if (Test-Path -LiteralPath $lockFile) { Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue }
}
