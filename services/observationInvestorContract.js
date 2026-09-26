'use strict';
const SCOPE='kis-investor-daily-only';
const API_PATH='/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily';
const TR_ID='FHPTJ04160001';
const DOCUMENT='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/investor_trade_by_stock_daily.py';
const FIELD_DOCUMENT='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/chk_investor_trade_by_stock_daily.py';
const FIELDS=Object.freeze(['stck_bsop_date','frgn_ntby_qty','orgn_ntby_qty','frgn_shnu_vol','frgn_seln_vol','orgn_shnu_vol','orgn_seln_vol']);
const executionFor=(symbol,targetDate)=>({scope:SCOPE,symbol,targetDate,market:'J',kisInvestorMaxRequests:1,kisTokenMaxRequests:1});
module.exports={SCOPE,API_PATH,TR_ID,DOCUMENT,FIELD_DOCUMENT,FIELDS,executionFor};
