'use strict';
// Browser-shaped primitives for read-only React VM fixtures. The fixtures keep
// effects disabled and fetch guarded; this does not boot a client or request data.
const {setTimeout,clearTimeout}=require('node:timers');
module.exports={setTimeout,clearTimeout,AbortController:globalThis.AbortController};
