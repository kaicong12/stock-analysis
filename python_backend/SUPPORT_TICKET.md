Subject: get_financial_unusual / get_derivative_unusual return err_code -12301 (empty retMsg) for several documented analysis_dimensions

Hello moomoo API support,

I'm hitting a reproducible error on the anomaly ("异动") quote APIs. Several
documented `analysis_dimensions` always return `err_code = -12301` with an
EMPTY `retMsg`, so I can't tell whether it's a missing entitlement, an invalid
parameter, or a server-side bug. Sibling dimensions on the same call succeed,
which rules out connectivity/login.

ENVIRONMENT
- SDK: moomoo-api 10.04.6408 (Python)
- OpenD server_ver: 1006, endpoint 127.0.0.1:11111
- get_global_state: qot_logined = True, trd_logined = True
- Call params: time_range = 30, language_id = 2
- Tested symbols: US.NVDA and HK.00700

WHAT I OBSERVE
Calling ONE dimension at a time, the following return
`{"err_code": -12301, "retMsg": "", "time_range": "", "content": ""}` with
ret = RET_OK, on BOTH US.NVDA and HK.00700:

  get_financial_unusual (FAIL with -12301):
    - funds_flow
    - short_sell_number
    - short_sell_ratio
    - short_sell_number_and_ratio
  get_financial_unusual (WORK, err_code 0 or 1):
    - funds_distribution
    - funds_broker

  get_derivative_unusual (FAIL with -12301):
    - option_volatility
    - option_volume_price
    - option_sentiment
    - option_comprehensive
    - warrant_ratio, warrant_price_distribution  (fail on HK.00700)
  get_derivative_unusual (WORK, err_code 0):
    - option_unusual

Because at least one dimension in the default set returns -12301, a FULL SCAN
(omitting analysis_dimensions, which the SDK docstring describes as "默认全部"
/ scan all) also fails entirely with -12301 for both functions.

EXAMPLE EXACT RESPONSES
  get_financial_unusual("US.NVDA", time_range=30, analysis_dimensions=["funds_broker"], language_id=2)
    -> ret=0, {"err_code": 1, "retMsg": "资金面异动无异常", "time_range": "近30个自然日", "content": ""}

  get_financial_unusual("US.NVDA", time_range=30, analysis_dimensions=["funds_flow"], language_id=2)
    -> ret=0, {"err_code": -12301, "retMsg": "", "time_range": "", "content": ""}

  get_derivative_unusual("US.NVDA", time_range=30, analysis_dimensions=["option_unusual"], language_id=2)
    -> ret=0, {"err_code": 0, "retMsg": "success", "time_range": "近30个自然日", "content": "Unusual Large Options Trades: ..."}

  get_derivative_unusual("US.NVDA", time_range=30, analysis_dimensions=["option_sentiment"], language_id=2)
    -> ret=0, {"err_code": -12301, "retMsg": "", "time_range": "", "content": ""}

QUESTIONS
1. What does err_code -12301 mean? It is not documented and retMsg is empty.
2. Do funds_flow / short_sell_* / option_volatility / option_volume_price /
   option_sentiment / option_comprehensive require a separate market-data
   entitlement on my account? If so, which package, for US and for HK?
3. If it is an entitlement issue, can the API please return a descriptive
   retMsg instead of an empty string, so callers can handle it gracefully?

I have a standalone reproduction script and a JSON dump of every call/response
that I can attach on request.

Thank you,
Kai Cong (account email: kaicong12@gmail.com)
