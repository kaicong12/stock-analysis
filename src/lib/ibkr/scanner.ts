import { ensureIserverBridge, ibkr } from "./client";

export interface ScannerRow {
  symbol: string;
  name: string;
  conid: number;
}

interface RawScannerResponse {
  contracts?: RawScannerContract[];
}

interface RawScannerContract {
  con_id?: number;
  conid?: number;
  symbol?: string;
  company_name?: string;
  companyName?: string;
  contract_description_1?: string;
}

// Caveat: the Client Portal gateway silently ignores `marketCapAbove1e6` even
// though the filter is listed under /iserver/scanner/params. We send it
// anyway in case a future gateway version honours it, and post-filter ETFs
// by name + leveraged-ETF symbol pattern since they come back tagged
// sec_type: "STK".
const SCANNER_BASE = {
  instrument: "STK",
  location: "STK.US.MAJOR",
};

export const VALID_SCAN_TYPES = ["HIGH_OPT_IMP_VOLAT_OVER_HIST", "HIGH_OPT_IMP_VOLAT"] as const;
export type ScanType = (typeof VALID_SCAN_TYPES)[number];
const DEFAULT_SCAN_TYPE: ScanType = "HIGH_OPT_IMP_VOLAT_OVER_HIST";

export interface ScannerOptions {
  size?: number;
  scanType?: ScanType;
  minPrice?: number;
  minOptVolume?: number;
}

const ETF_NAME_PATTERNS =
  /\b(ETF|ETN|PROSHARES|DIREXION|ISHARES|VANGUARD|SCHWAB|SPDR|INVESCO|FIDELITY|FRANKLIN|WISDOMTREE|VANECK|FIRST TRUST|INDEX FUND|TRUST|FUND)\b/i;
// 3x bull/bear leveraged-ETF tickers commonly slip through with no ETF marker
// in their company name (TQQQ, SOXL, SQQQ, SPXL...). Hard-coded suffix match.
const LEVERAGED_ETF_RE = /(3X|3XL|UPRO|TQQQ|SQQQ|SOXL|SOXS|SPXL|SPXS|UDOW|SDOW|TNA|TZA|FNGU|FNGD|YINN|YANG)$/i;

export async function runCreditSpreadScanner(options: ScannerOptions = {}): Promise<ScannerRow[]> {
  const {
    size = 50,
    scanType = DEFAULT_SCAN_TYPE,
    minPrice = 20,
    minOptVolume = 1_000,
  } = options;
  const safeScanType: ScanType = VALID_SCAN_TYPES.includes(scanType) ? scanType : DEFAULT_SCAN_TYPE;
  await ensureIserverBridge();
  const reqBody = {
    ...SCANNER_BASE,
    type: safeScanType,
    size: String(size),
    filter: [
      { code: "priceAbove", value: minPrice },
      { code: "volumeAbove", value: 500_000 },
      { code: "optVolumeAbove", value: minOptVolume },
      { code: "marketCapAbove1e6", value: 10_000 },
    ],
  };
  const body = JSON.stringify(reqBody);
  const res = await ibkr<RawScannerResponse>("/iserver/scanner/run", {
    method: "POST",
    body,
  });
  const contracts = res?.contracts ?? [];
  const rows: ScannerRow[] = [];
  for (const c of contracts) {
    const conid = c.con_id ?? c.conid;
    const symbol = c.symbol ?? "";
    if (!conid || !symbol) continue;
    const name = c.company_name ?? c.companyName ?? c.contract_description_1 ?? symbol;
    if (ETF_NAME_PATTERNS.test(name)) continue;
    if (LEVERAGED_ETF_RE.test(symbol)) continue;
    rows.push({ symbol, name, conid });
  }
  return rows;
}
