'use strict';
// Preload for these tests: no credentials, providers, DB or external sockets.
const net=require('node:net');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const values=Array.isArray(args[0])?args[0]:args;
  const options=typeof values[0]==='object'?values[0]:{port:values[0],host:values[1]};
  if(options.host!=='127.0.0.1'||!Number.isInteger(Number(options.port))||Number(options.port)<=0)
    throw Error('EXTERNAL_NETWORK_FORBIDDEN');
  return connect.apply(this,args);
};
const Module=require('node:module'),load=Module._load;
Module._load=function(name,...rest){
  if(name==='dotenv'||name==='pg'||/kis(?:Auth|MarketData|AccountProbe|UnfilledProbe)(?:\.js)?$/.test(name))
    throw Error('REAL_PROVIDER_FORBIDDEN');
  return load.call(this,name,...rest);
};
const originalFetch=global.fetch;
global.fetch=(url,...args)=>{
  const target=new URL(url);
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw Error('EXTERNAL_NETWORK_FORBIDDEN');
  return originalFetch(url,...args);
};
