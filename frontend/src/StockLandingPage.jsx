import React,{useState} from 'react';
import App from './App.jsx';
import StockLandingGuide from './StockLandingGuide.jsx';

export default function StockLandingPage({symbol,onNavigateStock}){
  const [analysisRequested,setAnalysisRequested]=useState(false);
  // No detail App/effects are mounted before this explicit user action.
  // Repeated clicks only set the same state; App retains its in-flight dedupe.
  if(analysisRequested)return <App routeSymbol={symbol} onNavigateStock={onNavigateStock}/>;
  return <StockLandingGuide symbol={symbol} onLoad={()=>setAnalysisRequested(true)}/>;
}
